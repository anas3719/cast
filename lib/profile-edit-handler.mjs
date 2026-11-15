const ORIGIN = 'https://anas3719.github.io';
export const keys = ['name','age','height','weight','nationality','speaking','note'];
const simpleKeys = ['name'];
const table = 'cast_profile_edit_links';
const bad = (status, message) => { throw Object.assign(new Error(message), {status}); };
export function normalizeFields(value, simple = false) {
  const allowed = simple ? simpleKeys : keys;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(k => !allowed.includes(k))) bad(400,'خانات التعديل غير صحيحة.');
  const result = {};
  for (const k of allowed) {
    if (typeof value[k] !== 'string') bad(400,'بيانات التعديل غير صحيحة.');
    let v = value[k].trim();
    if (v.length > (k === 'note' ? 1000 : 120)) bad(400,'النص أطول من المسموح.');
    if (['age','height','weight'].includes(k) && v) {
      v = v.replace(/[٠-٩]/g,c=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/[۰-۹]/g,c=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c))).replace('٫','.');
      if (!/^\d{1,3}(\.\d{1,2})?$/.test(v) || +v <= 0 || +v > ({age:120,height:250,weight:300}[k])
        || (k === 'age' && !Number.isInteger(+v))) bad(400,'تحقق من العمر والطول والوزن.');
      v = String(+v);
    }
    if (k === 'name' && !v) bad(400,'الاسم مطلوب.');
    if (k === 'speaking' && !['','متحدث','متحدثة','غير متحدث','غير متحدثة'].includes(v)) bad(400,'اختر حالة التحدث.');
    result[k] = v;
  }
  return result;
}
export function createProfileEditHandler({db, fetcher = fetch, now = () => Date.now()}) {
  const headers = {'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'Authorization, Content-Type',
    'Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json','Cache-Control':'no-store',
    'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Vary':'Origin'};
  const reply = (status,body) => new Response(JSON.stringify(body),{status,headers});
  const checked = r => {if(r.error) bad(503,'تعذر حفظ التعديل. حاول مجددًا.'); return r.data;};
  const digest = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(x=>x.toString(16).padStart(2,'0')).join('');
  const urlFor=token=>`${ORIGIN}/cast/cast-edit.html#${token}`;
  async function vault(action,profileId,authorization,encrypted){
    const response=await fetcher('https://cast-admin-anas3719.vercel.app/api/profile-edit-link',{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(25000),headers:{Origin:ORIGIN,Authorization:authorization,'Content-Type':'application/json'},
      body:JSON.stringify({action,profileId,...(encrypted?{encrypted}:{})})});
    if(!response.ok)bad(503,'تعذر استرجاع الرابط المحفوظ. حاول مجددًا دون تغيير الرابط.');
    return response.json();
  }
  async function remember(row,token){
    const value=await vault('wrap',row.profile_id,`Bearer ${token}`);
    if(typeof value.encrypted!=='string')bad(503,'تعذر حفظ الرابط بأمان.');
    const saved=checked(await db.from(table).update({encrypted_token:value.encrypted,expires_at:null})
      .eq('profile_id',row.profile_id).eq('token_hash',row.token_hash).is('revoked_at',null).select('profile_id').maybeSingle());
    if(!saved)bad(409,'تغيّر الرابط. أعد فتحه.');
  }
  return async req => {
    if(req.method === 'OPTIONS') return new Response(null,{status:204,headers});
    try {
      if(req.method !== 'POST' || req.headers.get('origin') !== ORIGIN) bad(403,'الطلب غير مسموح.');
      const text = await req.text();
      if(new TextEncoder().encode(text).length > 12000) bad(413,'الطلب أكبر من المسموح.');
      let body; try {body=JSON.parse(text);} catch {bad(400,'الطلب غير صحيح.');}
      if(!body || Array.isArray(body)) bad(400,'الطلب غير صحيح.');
      if(['load','submit','publish-plan','link-proof'].includes(body.action)) {
        const token = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.get('authorization') || '')?.[1];
        if(!token) bad(401,'الرابط غير صالح أو انتهت صلاحيته.');
        const hash = await digest(token);
        const row = checked(await db.from(table).select('*').eq('token_hash',hash).is('revoked_at',null).maybeSingle());
        if(!row) bad(401,'الرابط غير صالح أو انتهت صلاحيته.');
        if(body.action === 'link-proof')return reply(200,{profileId:row.profile_id});
        if(body.action === 'load') {
          if(!row.encrypted_token)await remember(row,token);
          return reply(200,{fields:row.proposal || row.snapshot,simple:row.simple,pending:!!row.proposal});
        }
        if(body.action === 'publish-plan') {
          if(!row.proposal) bad(409,'لا يوجد تعديل للنشر.');
          return reply(200,{profileId:row.profile_id,fields:row.proposal,baseline:row.snapshot,revision:row.revision,simple:row.simple});
        }
        const proposal = normalizeFields(body.fields,row.simple);
        const revision=crypto.randomUUID();
        const saved=checked(await db.from(table).update({proposal,revision,submitted_at:new Date(now()).toISOString()})
          .eq('profile_id',row.profile_id).eq('token_hash',hash).is('revoked_at',null).select('profile_id').maybeSingle());
        if(!saved) bad(409,'تغيّرت صلاحية الرابط. أعد فتحه.');
        const published=await fetcher('https://cast-admin-anas3719.vercel.app/api/profile-edit-publish',{
          method:'POST',redirect:'error',signal:AbortSignal.timeout(115000),
          headers:{Origin:ORIGIN,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:'{}',
        });
        const receipt=await published.json();
        if(!published.ok || !/^[a-f0-9]{40}$/.test(receipt.commit || '')) bad(published.status===409?409:503,
          receipt.message || 'حُفظت البيانات، لكن تعذر النشر الآن. أعد الضغط على حفظ.');
        const finalized=checked(await db.from(table).update({snapshot:proposal,proposal:null,submitted_at:null})
          .eq('profile_id',row.profile_id).eq('revision',revision).select('profile_id').maybeSingle());
        return reply(200,{saved:true,commit:receipt.commit,newerPending:!finalized});
      }
      if(!['create','revoke','list','resolve'].includes(body.action)) bad(400,'الطلب غير صحيح.');
      const auth=req.headers.get('authorization') || '';
      if(!auth || auth.length>8192) bad(401,'سجّل الدخول بحساب GitHub.');
      const proof=await fetcher('https://cast-admin-anas3719.vercel.app/api/registration-owner',{
        method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{Origin:ORIGIN,Authorization:auth}});
      if(proof.status===401 || proof.status===403) bad(401,'سجّل الدخول بحساب GitHub.');
      if(!proof.ok || (await proof.json()).authorized!==true) bad(503,'خدمة الدخول غير متاحة مؤقتًا.');
      if(body.action==='list') {
        const rows=checked(await db.from(table).select('profile_id,snapshot,proposal,revision,submitted_at').not('proposal','is',null).order('submitted_at',{ascending:false}).limit(500));
        return reply(200,{rows});
      }
      if(typeof body.profileId!=='string' || !/^[a-zA-Z0-9_-]{1,120}$/.test(body.profileId)) bad(400,'معرف البروفايل غير صحيح.');
      if(body.action==='create') {
        const simple=body.simple===true;
        const snapshot=normalizeFields(body.fields,simple);
        const existing=checked(await db.from(table).select('*').eq('profile_id',body.profileId).maybeSingle());
        if(existing && body.rotate!==true){
          if(existing.revoked_at)return reply(200,{revoked:true,url:null});
          if(!existing.encrypted_token)bad(409,'افتح الرابط السابق مرة واحدة لاستعادته، أو اختر تغيير الرابط.');
          const value=await vault('unwrap',body.profileId,auth,existing.encrypted_token);
          if(!/^[a-f0-9]{64}$/.test(value.token||'') || await digest(value.token)!==existing.token_hash)bad(503,'تعذر التحقق من الرابط المحفوظ.');
          return reply(200,{url:urlFor(value.token)});
        }
        const token=[...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,'0')).join('');
        const changes={snapshot,simple,token_hash:await digest(token),encrypted_token:null,revoked_at:null,expires_at:null,revision:crypto.randomUUID(),proposal:null,submitted_at:null};
        if(existing) checked(await db.from(table).update(changes).eq('profile_id',body.profileId));
        else checked(await db.from(table).insert({profile_id:body.profileId,...changes}));
        await remember({profile_id:body.profileId,token_hash:changes.token_hash},token);
        return reply(200,{url:urlFor(token)});
      }
      if(body.action==='revoke') {
        checked(await db.from(table).update({revoked_at:new Date(now()).toISOString()}).eq('profile_id',body.profileId));
        return reply(200,{revoked:true});
      }
      if(typeof body.revision!=='string' || !/^[a-f0-9-]{36}$/.test(body.revision)) bad(400,'نسخة التعديل غير صحيحة.');
      const row=checked(await db.from(table).select('*').eq('profile_id',body.profileId).eq('revision',body.revision).maybeSingle());
      if(!row?.proposal) bad(409,'وصل تعديل أحدث. حدّث القائمة وراجعه.');
      const changes={proposal:null,submitted_at:null,...(body.approved===true?{snapshot:row.proposal}:{})};
      const saved=checked(await db.from(table).update(changes).eq('profile_id',body.profileId).eq('revision',body.revision).select('profile_id').maybeSingle());
      if(!saved) bad(409,'وصل تعديل أحدث. حدّث القائمة وراجعه.');
      return reply(200,{resolved:true});
    } catch(e) {return reply(e.status || 503,{message:e.status?e.message:'الخدمة غير متاحة مؤقتًا.'});}
  };
}
