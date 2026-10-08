import { PROJECT, ORIGIN, BUCKET, UUID, TICKET, digest, matchesMedia,
  validatedManifest, privateView } from './registration-security.mjs';
import {startApproval} from './registration-approval.mjs';
import destinations from './drive-destinations.json' with { type: 'json' };

export function createRegistrationHandler({ db, rules, env, fetcher = fetch }) {
  const cors = { 'Access-Control-Allow-Origin': ORIGIN, 'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store',
    'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff', 'Vary': 'Origin' };
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: cors });
  const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
  const checked = result => { if (result.error) fail(503, 'تعذر حفظ الطلب. أعد المحاولة.'); return result.data; };
  async function broker(req, action, connection, fields = {}) {
    const response = await fetcher('https://cast-admin-anas3719.vercel.app/api/registration-approval', {
      method:'POST',redirect:'error',signal:AbortSignal.timeout(115000),
      headers:{Origin:ORIGIN,Authorization:req.headers.get('authorization'),'Content-Type':'application/json'},
      body:JSON.stringify({action,connection,...fields}),
    });
    if (!response.ok) fail(503, 'تعذر التحقق من المجلدات أو نقل الملفات. الربط السابق محفوظ.');
    return response.json();
  }
  async function migrate(req, connection, offset = 0) {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) fail(400, 'الطلب غير صحيح.');
    const records = checked(await db.from('cast_registrations').select('id,category,drive_folder_id')
      .eq('status','approved').order('created_at').range(offset,offset+19));
    if (records.some(item => !item.drive_folder_id)) fail(409, 'أحد الملفات المعتمدة لم يكتمل نقله.');
    const result = await broker(req,'migrate',connection,{records:records.map(item => ({
      id:item.id,category:item.category,folderId:item.drive_folder_id,
    }))});
    return {migrated:result.migrated,nextOffset:records.length === 20 ? offset+20 : null};
  }

  async function owner(req) {
    const authorization = req.headers.get('authorization');
    if (!authorization || authorization.length > 8192) fail(401, 'سجّل الدخول بحساب GitHub.');
    const response = await fetcher('https://cast-admin-anas3719.vercel.app/api/registration-owner', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { Authorization: authorization, Origin: ORIGIN },
    });
    if (response.status === 401 || response.status === 403) fail(401, 'سجّل الدخول بحساب GitHub.');
    if (!response.ok || (await response.json()).authorized !== true) fail(503, 'خدمة الدخول غير متاحة مؤقتًا.');
  }

  async function ticket(body, req) {
    if (!UUID.test(body.id || '')) fail(400, 'معرف الطلب غير صحيح.');
    const raw = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.get('authorization') || '')?.[1];
    if (!raw) fail(401, 'صلاحية الطلب غير صحيحة.');
    const hash = await digest(raw);
    const record = checked(await db.from('cast_registrations').select('*').eq('id', body.id)
      .eq('submission_token_hash', hash).maybeSingle());
    if (!record || !['uploading', 'pending'].includes(record.status)
      || (record.status === 'uploading' && Date.parse(record.upload_expires_at) < Date.now())) {
      fail(401, 'انتهت صلاحية الطلب أو لم يعد قابلًا للرفع.');
    }
    return { record, hash };
  }

  async function filesFor(id) {
    return checked(await db.from('cast_registration_files').select('*').eq('registration_id', id).order('slot'));
  }

  async function preview(record) {
    const files = await filesFor(record.id);
    for (const file of files) {
      if (file.verified_at) {
        const result = checked(await db.storage.from(BUCKET).createSignedUrl(file.object_path, 300));
        file.url = result.signedUrl;
      }
    }
    const view=privateView(record, files);
    if (record.status==='approving') {
      const job=checked(await db.from('cast_approval_jobs').select('status,phase,error_code').eq('registration_id',record.id).maybeSingle());
      view.approval={status:job?.status || 'needs_grant',phase:job?.phase || 0,error:job?.error_code || null};
    }
    return view;
  }

  async function captcha(body) {
    if (!env('TURNSTILE_SECRET') || typeof body.challenge !== 'string' || body.challenge.length > 4096) {
      fail(503, 'التسجيل لم يُفتح بعد.');
    }
    const response = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: env('TURNSTILE_SECRET'), response: body.challenge,
        idempotency_key: body.id }),
    });
    if (!response.ok) fail(503, 'تعذر التحقق من الطلب.');
    const proof = await response.json();
    if (!proof.success || proof.hostname !== 'anas3719.github.io' || proof.action !== 'cast-register') {
      fail(400, 'أعد التحقق الأمني ثم حاول مرة أخرى.');
    }
  }

  return async req => {
    if (req.headers.get('origin') !== ORIGIN) return reply(403, { message: 'غير مسموح.' });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return reply(405, { message: 'غير مسموح.' });
    try {
      if (env('SUPABASE_URL') !== `https://${PROJECT}.supabase.co`) fail(503, 'إعداد المشروع غير صحيح.');
      // Bound the stream, not just a caller-supplied Content-Length header.
      const reader = req.body?.getReader();
      if (!reader) fail(400, 'الطلب غير صحيح.');
      let raw = '', size = 0;
      const decoder = new TextDecoder();
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 32768) { await reader.cancel(); fail(413, 'الطلب أكبر من الحد المسموح.'); }
        raw += decoder.decode(chunk.value, { stream: true });
      }
      raw += decoder.decode();
      let body;
      try { body = JSON.parse(raw); } catch { fail(400, 'الطلب غير صحيح.'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'الطلب غير صحيح.');
      if (body.action === 'availability') return reply(200, {
        open: env('REGISTRATION_OPEN') === 'true' && env('APPROVAL_PIPELINE_READY') === 'true'
          && Boolean(env('TURNSTILE_SECRET') && env('TURNSTILE_SITE_KEY')),
        siteKey: env('TURNSTILE_SITE_KEY') || '',
      });

      if (body.action === 'create') {
        if (env('REGISTRATION_OPEN') !== 'true' || env('APPROVAL_PIPELINE_READY') !== 'true') fail(503, 'التسجيل لم يُفتح بعد.');
        if (!UUID.test(body.id || '') || !TICKET.test(body.ticket || '')) fail(400, 'الطلب غير صحيح.');
        const validated = rules.validate(body.fields);
        if (!validated.valid) return reply(400, { message: 'راجع البيانات.', errors: validated.errors });
        let manifest;
        try { manifest = validatedManifest(body.files, rules, validated.works.mode); }
        catch { fail(400, 'أرفق صورة البروفايل ومن عملين إلى 10 أعمال صحيحة.'); }
        await captcha(body);
        // No raw IP, phone, signed URL or credentials enter logs or public outputs.
        const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
        const fingerprint = await digest(env('SUPABASE_SERVICE_ROLE_KEY') + ':' + ip);
        const result = await db.rpc('cast_reserve_registration', {
          request_id: body.id, ticket_hash: await digest(body.ticket), fingerprint,
          fields: { ...validated.profile, speaking: validated.profile.speaking === 'yes',
            whatsapp: validated.privateContact.whatsapp, worksMode: validated.works.mode, folderUrl: validated.works.folderUrl },
          files: manifest,
        });
        if (result.error?.code === 'P0002') fail(429, 'الاستقبال مشغول الآن. حاول لاحقًا.');
        checked(result);
        return reply(200, { id: body.id, status: 'uploading' });
      }

      if (['uploads', 'submit', 'receipt'].includes(body.action)) {
        const { record, hash } = await ticket(body, req);
        if (body.action === 'receipt') return reply(200, { id: record.id, status: record.status });
        if (body.action === 'uploads') {
          if (record.status !== 'uploading') fail(409, 'الطلب تم إرساله بالفعل.');
          const files = await filesFor(record.id);
          const slots = body.slots ?? files.map(file => file.slot);
          if (!Array.isArray(slots) || slots.length > 11 || new Set(slots).size !== slots.length
            || slots.some(slot => !Number.isInteger(slot) || !files.some(file => file.slot === slot))) {
            fail(400, 'قائمة المرفقات غير صحيحة.');
          }
          const uploads = [];
          for (const file of files.filter(file => slots.includes(file.slot))) {
            const data = checked(await db.storage.from(BUCKET).createSignedUploadUrl(file.object_path, { upsert: false }));
            uploads.push({ slot: file.slot, objectPath: file.object_path, token: data.token,
              type: file.mime_type, size: Number(file.declared_size) });
          }
          return reply(200, { endpoint: `https://${PROJECT}.storage.supabase.co/storage/v1/upload/resumable/sign`, bucket: BUCKET, uploads });
        }
        if (record.status === 'pending') return reply(200, { id: record.id, status: 'pending' });
        for (const file of await filesFor(record.id)) {
          const url = checked(await db.storage.from(BUCKET).createSignedUrl(file.object_path, 60)).signedUrl;
          const response = await fetcher(url, { headers: { Range: 'bytes=0-127' },
            redirect: 'error', signal: AbortSignal.timeout(15000) });
          const range = /^bytes 0-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '');
          if (!(response.status === 206 && range && Number(range[2]) === Number(file.declared_size)
            && Number(range[1]) < 128)) {
            await response.body?.cancel(); fail(400, 'لم يكتمل رفع المرفقات.');
          }
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (bytes.length > 128 || !matchesMedia(bytes, file.mime_type)) fail(400, 'صيغة أحد الملفات غير صحيحة.');
          checked(await db.from('cast_registration_files').update({ verified_at: new Date().toISOString(),
            verified_size: Number(file.declared_size) }).eq('id', file.id));
        }
        checked(await db.rpc('cast_submit_registration', { request_id: record.id, ticket_hash: hash }));
        return reply(200, { id: record.id, status: 'pending' });
      }

      if (['drive-status', 'drive-store', 'drive-migrate', 'list', 'detail', 'edit', 'reject', 'approve'].includes(body.action)) {
        await owner(req);
        if (body.action === 'drive-status') {
          let officialFoldersReady = false;
          const value = checked(await db.from('cast_registration_integrations')
            .select('connected_at,encrypted_connection,root_folder_id').eq('id', 'google-drive').maybeSingle());
          if(value) {
            const proof=await fetcher('https://cast-admin-anas3719.vercel.app/api/registration-approval',{
              method:'POST',redirect:'error',signal:AbortSignal.timeout(25000),
              headers:{Origin:ORIGIN,Authorization:req.headers.get('authorization'),'Content-Type':'application/json'},
              body:JSON.stringify({action:'health',connection:value.encrypted_connection})});
            const health = await proof.json();
            if(!proof.ok || health.ready!==true)fail(503,'ربط الدرايف محفوظ، لكن تعذر التحقق من صلاحيته الآن.');
            officialFoldersReady = health.officialFoldersReady === true;
          }
          return reply(200, { connected: Boolean(value), connectedAt: value?.connected_at || null,
            officialFoldersReady, officialFoldersConfigured: value?.root_folder_id === '1kyQALMt95YXHjd0wz3d0tbqRyAm3ukYi',
            approvalReady:env('APPROVAL_PIPELINE_READY')==='true' });
        }
        if (body.action === 'drive-store') {
          if (typeof body.connection !== 'string' || body.connection.length > 12000) fail(400, 'الربط غير صحيح.');
          const proof = await fetcher('https://cast-admin-anas3719.vercel.app/api/drive-auth?action=verify', {
            method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
            headers: { Origin: ORIGIN, Authorization: req.headers.get('authorization'), 'Content-Type': 'application/json' },
            body: JSON.stringify({ connection: body.connection }),
          });
          if (!proof.ok || (await proof.json()).valid !== true) fail(400, 'لم يتم التحقق من الربط المحدود.');
          if (body.destination === 'official') {
            const expected = [destinations.root,...Object.values(destinations.categories)];
            if (!Array.isArray(body.pickedIds) || body.pickedIds.length !== expected.length
              || new Set(body.pickedIds).size !== expected.length || !expected.every(id => body.pickedIds.includes(id))) {
              fail(400, 'اختر مجلد الكاست ومجلدات الأقسام الستة فقط.');
            }
            const health = await broker(req,'health',body.connection);
            if (health.officialFoldersReady !== true) fail(400, 'لم يتأكد الوصول إلى المجلدات الأساسية بصلاحية إضافة ملفات.');
            const saved = await db.rpc('cast_set_official_drive',{sealed_connection:body.connection});
            if (saved.error?.code === 'P0003') fail(409, 'انتظر اكتمال الاعتمادات الحالية قبل تغيير المجلدات.');
            checked(saved);
            return reply(200,{connected:true,destination:'official',migrationPending:true});
          }
          if (body.destination !== undefined) fail(400,'نوع الربط غير صحيح.');
          checked(await db.from('cast_registration_integrations').upsert({id:'google-drive',
            encrypted_connection:body.connection,connected_at:new Date().toISOString()}));
          return reply(200, { connected: true });
        }
        if (body.action === 'drive-migrate') {
          const integration = checked(await db.from('cast_registration_integrations').select('root_folder_id,encrypted_connection')
            .eq('id','google-drive').maybeSingle());
          if (!integration || integration.root_folder_id !== destinations.root) fail(409,'اربط المجلدات الأساسية أولًا.');
          return reply(200,await migrate(req,integration.encrypted_connection,body.offset ?? 0));
        }
        if (body.action === 'list') {
          const records = checked(await db.from('cast_registrations')
            .select('id,name,category,status,revision,created_at').in('status', ['pending', 'approving', 'rejected'])
            .order('created_at', { ascending: false }).limit(200));
          return reply(200, { records });
        }
        if (!UUID.test(body.id || '')) fail(400, 'معرف الطلب غير صحيح.');
        const record = checked(await db.from('cast_registrations').select('*').eq('id', body.id).maybeSingle());
        if (!record) fail(404, 'الطلب غير موجود.');
        if (body.action === 'detail') return reply(200, { record: await preview(record) });
        if (!Number.isInteger(body.revision) || body.revision !== record.revision) fail(409, 'الطلب تغير. حدّث البيانات قبل الحفظ.');
        if (body.action === 'edit') {
          const validated = rules.validate({ ...body.fields, worksMode: record.works_mode, folderUrl: record.supplied_folder_url });
          if (!validated.valid) return reply(400, { message: 'راجع البيانات.', errors: validated.errors });
          if (typeof body.fields?.ownerNote !== 'string' || body.fields.ownerNote.length > 4000) fail(400, 'الملاحظة غير صحيحة.');
          const count = body.fields.reviewedCount;
          if (count != null && (!Number.isInteger(count) || count < 2 || count > 10)) fail(400, 'عدد الأعمال من 2 إلى 10.');
          const result = await db.rpc('cast_edit_registration', { request_id: record.id, expected_revision: body.revision,
            fields: { ...validated.profile, speaking: validated.profile.speaking === 'yes',
              whatsapp: validated.privateContact.whatsapp, ownerNote: body.fields.ownerNote,
              reviewedCount: count, accessible: body.fields.accessible === true } });
          if (result.error?.code === 'P0003') fail(409, 'الطلب تغير. حدّث البيانات قبل الحفظ.');
          const saved = checked(result);
          if(saved.status==='approved' && env('APPROVAL_PIPELINE_READY')==='true') {
            try {await startApproval({db,rules,record:saved,authorization:req.headers.get('authorization'),fetcher});}
            catch {fail(503,'حُفظ التعديل الخاص، لكن لم يبدأ تحديث الموقع. تحقق من الطلب ثم استكمل النشر.');}
            const refreshed=checked(await db.from('cast_registrations').select('*').eq('id',saved.id).single());
            return reply(200,{record:await preview(refreshed)});
          }
          return reply(200, { record: await preview(saved) });
        }
        // Fail closed until Drive authorization and durable transfer are configured.
        if (body.action === 'approve') {
          if(env('APPROVAL_PIPELINE_READY')!=='true') fail(503,'النشر قيد التجهيز. لم يتم نشر الطلب.');
          return reply(202,await startApproval({db,rules,record,authorization:req.headers.get('authorization'),fetcher}));
        }
        if (record.status !== 'pending') fail(409, 'لا يمكن رفض هذا الطلب الآن.');
        const changed = checked(await db.from('cast_registrations').update({ status: 'rejected', revision: record.revision + 1,
          updated_at: new Date().toISOString() }).eq('id', record.id).eq('revision', body.revision).eq('status', 'pending').select('id'));
        if (!changed.length) fail(409, 'الطلب تغير. حدّث البيانات.');
        return reply(200, { id: record.id, status: 'rejected' });
      }
      return reply(404, { message: 'الطلب غير معروف.' });
    } catch (error) {
      return reply(error.status || 503, { message: error.status ? error.message : 'الخدمة غير متاحة مؤقتًا. لم تفقد طلبك.' });
    }
  };
}
