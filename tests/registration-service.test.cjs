const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, webcrypto } = require('node:crypto');
const rules = require('../cast-registration-rules.js');
const ownerHandler = require('../api/registration-owner.js');
const { seal, OWNER_ID, ORIGIN } = require('../lib/admin-auth.cjs');
process.env.SESSION_KEY = randomBytes(32).toString('base64');
global.crypto ||= webcrypto;
const response = () => ({ statusCode: 0, setHeader() {}, end(body) { this.body = body; } });
const req = body => new Request('https://vmnkdbceyqudcxddvljx.supabase.co/functions/v1/cast-registration', {
  method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
test('review list excludes published registrations without deleting their private records',async()=>{
  const {createRegistrationHandler}=await import('../lib/registration-handler.mjs');
  let statuses,selected,limit,ordered;
  const query={select:fields=>(selected=fields,query),in:(key,values)=>(assert.equal(key,'status'),statuses=values,query),
    order:(key)=>(ordered=key,query),limit:async value=>(limit=value,{data:[{id:'pending-only',status:'pending'}]})};
  const handler=createRegistrationHandler({db:{from:table=>(assert.equal(table,'cast_registrations'),query)},rules,
    env:name=>name==='SUPABASE_URL'?'https://vmnkdbceyqudcxddvljx.supabase.co':'',
    fetcher:async()=>Response.json({authorized:true})});
  const request=req({action:'list'});request.headers.set('Authorization','Bearer synthetic-owner');
  const result=await handler(request);
  assert.equal(result.status,200);assert.deepEqual(statuses,['pending','approving','rejected']);
  assert.equal(limit,200);assert.equal(ordered,'created_at');assert.ok(!selected.includes('whatsapp'));
  assert.deepEqual((await result.json()).records,[{id:'pending-only',status:'pending'}]);
});
test('official connection storage rejects missing folder selections and read-only destinations before changing data',async()=>{
  const {createRegistrationHandler}=await import('../lib/registration-handler.mjs');
  const destinations=require('../lib/drive-destinations.cjs');let writes=0;
  for (const writable of [false,true]) {
    const handler=createRegistrationHandler({db:{rpc(){writes++;throw Error('Must not store');},from(){writes++;throw Error('Must not mutate');}},rules,
      env:name=>name==='SUPABASE_URL'?'https://vmnkdbceyqudcxddvljx.supabase.co':'',
      fetcher:async url=>Response.json(url.includes('registration-owner')?{authorized:true}:
        url.includes('drive-auth')?{valid:true}:{ready:true,officialFoldersReady:false})});
    const request=req({action:'drive-store',connection:'sealed-only',destination:'official',
      pickedIds:writable?destinations.FILE_IDS:destinations.FILE_IDS.slice(1)});
    request.headers.set('Authorization','Bearer synthetic-owner');
    assert.equal((await handler(request)).status,400);
  }
  assert.equal(writes,0);
});
test('official storage respects an active-approval conflict and never starts migration',async()=>{
  const {createRegistrationHandler}=await import('../lib/registration-handler.mjs');
  const destinations=require('../lib/drive-destinations.cjs');let rpcCalls=0;
  const handler=createRegistrationHandler({db:{rpc:async(name,args)=>{
    assert.equal(name,'cast_set_official_drive');assert.deepEqual(args,{sealed_connection:'sealed-only'});rpcCalls++;
    return {error:{code:'P0003'}};
  },from(){throw Error('No migration on a conflict');}},rules,
    env:name=>name==='SUPABASE_URL'?'https://vmnkdbceyqudcxddvljx.supabase.co':'',
    fetcher:async url=>Response.json(url.includes('registration-owner')?{authorized:true}:
      url.includes('drive-auth')?{valid:true}:{ready:true,officialFoldersReady:true})});
  const request=req({action:'drive-store',connection:'sealed-only',destination:'official',pickedIds:destinations.FILE_IDS});
  request.headers.set('Authorization','Bearer synthetic-owner');
  assert.equal((await handler(request)).status,409);assert.equal(rpcCalls,1);
});
test('verified official connection migrates only approved database folders and returns no credential',async()=>{
  const {createRegistrationHandler}=await import('../lib/registration-handler.mjs');
  const destinations=require('../lib/drive-destinations.cjs');let stored=false,migrated=false;
  const query={select:fields=>(assert.equal(fields,'id,category,drive_folder_id'),query),
    eq:(key,value)=>(assert.equal(key,'status'),assert.equal(value,'approved'),query),order:()=>query,
    range:async(start,end)=>(assert.equal(start,0),assert.equal(end,19),{data:[{id:'synthetic-request',category:'boys',drive_folder_id:'synthetic-person-folder'}]})};
  const handler=createRegistrationHandler({db:{rpc:async()=>{stored=true;return {data:null};},from:()=>query},rules,
    env:name=>name==='SUPABASE_URL'?'https://vmnkdbceyqudcxddvljx.supabase.co':'',
    fetcher:async(url,options)=>{
      if(url.includes('registration-owner'))return Response.json({authorized:true});
      if(url.includes('drive-auth'))return Response.json({valid:true});
      const body=JSON.parse(options.body);
      if(body.action==='health')return Response.json({ready:true,officialFoldersReady:true});
      assert.equal(stored,true);assert.equal(body.action,'migrate');
      assert.deepEqual(body.records,[{id:'synthetic-request',category:'boys',folderId:'synthetic-person-folder'}]);
      migrated=true;return Response.json({migrated:1});
    }});
  const request=req({action:'drive-store',connection:'sealed-only',destination:'official',pickedIds:destinations.FILE_IDS});
  request.headers.set('Authorization','Bearer synthetic-owner');
  const result=await handler(request);assert.equal(result.status,200);assert.equal(migrated,true);
  const data=await result.json();assert.deepEqual(data,{connected:true,destination:'official',migrated:1,nextOffset:null});
  assert.ok(!JSON.stringify(data).includes('sealed-only'));
});

test('owner verification never rotates credentials or discloses them', async () => {
  const original = global.fetch;
  let calls = 0;
  global.fetch = async url => { calls++; assert.equal(url, 'https://api.github.com/user'); return Response.json({ id: OWNER_ID }); };
  try {
    const token = await seal({ sub: OWNER_ID, accessToken: 'PRIVATE-SYNTHETIC', refreshToken: 'PRIVATE-REFRESH',
      accessExpires: Date.now() + 3600000 }, 'cast-session');
    const result = response();
    await ownerHandler({ method: 'POST', headers: { origin: ORIGIN, authorization: `Bearer ${token}` } }, result);
    assert.equal(result.statusCode, 200);
    assert.deepEqual(JSON.parse(result.body), { authorized: true });
    assert.equal(calls, 1);
    assert.ok(!result.body.includes('PRIVATE'));
    const expired = await seal({ sub: OWNER_ID, accessToken: 'x', accessExpires: 0 }, 'cast-session');
    const denied = response();
    await ownerHandler({ method: 'POST', headers: { origin: ORIGIN, authorization: `Bearer ${expired}` } }, denied);
    assert.equal(denied.statusCode, 401); assert.equal(calls, 1);
  } finally { global.fetch = original; }
});

test('owner verification rejects wrong origin and missing credentials', async () => {
  for (const origin of [ORIGIN, 'https://other.example']) {
    const result = response(); await ownerHandler({ method: 'POST', headers: { origin } }, result);
    assert.equal(result.statusCode, origin === ORIGIN ? 401 : 403);
  }
});

test('private API fails closed without readiness, owner verification, or correct project', async () => {
  const { createRegistrationHandler } = await import('../lib/registration-handler.mjs');
  let dbCalls = 0;
  const db = { from() { dbCalls++; throw new Error('Must not access private storage'); } };
  const env = name => name === 'SUPABASE_URL' ? 'https://vmnkdbceyqudcxddvljx.supabase.co' : '';
  const handler = createRegistrationHandler({ db, rules, env, fetcher: async () => Response.json({ authorized: false }, { status: 401 }) });
  const availability = await handler(req({ action: 'availability' }));
  assert.deepEqual(await availability.json(), { open: false, siteKey: '' });
  assert.equal((await handler(req({ action: 'create' }))).status, 503);
  assert.equal((await handler(req({ action: 'list' }))).status, 401);
  assert.equal((await handler(req({ action: 'uploads', id: 'bad' }))).status, 400);
  assert.equal(dbCalls, 0);
  const prematureOpen = createRegistrationHandler({ db, rules, env: name => ({
    SUPABASE_URL: 'https://vmnkdbceyqudcxddvljx.supabase.co', REGISTRATION_OPEN: 'true',
    TURNSTILE_SECRET: 'synthetic', TURNSTILE_SITE_KEY: 'synthetic',
  })[name] || '' });
  assert.equal((await prematureOpen(req({ action: 'create' }))).status, 503);
  assert.equal((await (await prematureOpen(req({ action: 'availability' }))).json()).open, false);
  const wrongProject = createRegistrationHandler({ db, rules, env: () => 'https://other.supabase.co' });
  assert.equal((await wrongProject(req({ action: 'availability' }))).status, 503);
});

test('private API caps actual request bytes and rejects missing/wrong Origin', async () => {
  const { createRegistrationHandler } = await import('../lib/registration-handler.mjs');
  const handler = createRegistrationHandler({ db: {}, rules,
    env: name => name === 'SUPABASE_URL' ? 'https://vmnkdbceyqudcxddvljx.supabase.co' : '' });
  for (const origin of ['', 'https://attacker.example']) {
    const request = new Request('https://example.com', { method: 'POST', headers: { Origin: origin }, body: '{}' });
    assert.equal((await handler(request)).status, 403);
  }
  assert.equal((await handler(req({ action: 'availability', junk: 'x'.repeat(32768) }))).status, 413);
  assert.equal((await handler(req([]))).status, 400);
});

test('anonymous ticket APIs expose no private profile even with invalid/expired ticket', async () => {
  const { createRegistrationHandler } = await import('../lib/registration-handler.mjs');
  const handler = createRegistrationHandler({ db: { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }) },
    rules, env: name => name === 'SUPABASE_URL' ? 'https://vmnkdbceyqudcxddvljx.supabase.co' : '' });
  const request = req({ action: 'receipt', id: '00000000-0000-4000-8000-000000000000' });
  request.headers.set('Authorization', 'Bearer ' + 'a'.repeat(64));
  const denied = await handler(request);
  assert.equal(denied.status, 401);
  assert.deepEqual(Object.keys(await denied.json()), ['message']);
});

test('signature checks reject renamed unsupported files and distinguish images from video', async () => {
  const { matchesMedia, validatedManifest, privateView } = await import('../lib/registration-security.mjs');
  assert.equal(matchesMedia(Uint8Array.from([255, 216, 255]), 'image/jpeg'), true);
  assert.equal(matchesMedia(new TextEncoder().encode('<script>alert(1)</script>'), 'image/jpeg'), false);
  assert.equal(matchesMedia(new TextEncoder().encode('0000ftypisom'), 'video/mp4'), true);
  assert.equal(matchesMedia(new TextEncoder().encode('0000ftypisom'), 'image/heic'), false);
  assert.throws(() => validatedManifest([{ name: 'x.jpg', type: 'image/jpeg', size: 2147483649 }], rules, 'drive'));
  const privateRecord = privateView({ id: 'x', submission_token_hash: 'secret', whatsapp: '+966500000000',
    drive_upload_url: 'https://secret', owner_note: 'private', speaking: false }, []);
  assert.equal(privateRecord.privateContact.whatsapp, '+966500000000');
  assert.ok(!JSON.stringify(privateRecord).includes('secret'));
});

test('signed anonymous uploads use the signature-only TUS route without exposing server credentials', async () => {
  const { createRegistrationHandler } = await import('../lib/registration-handler.mjs');
  const id = '00000000-0000-4000-8000-000000000000';
  const file = { slot: 0, object_path: id + '/0/object', mime_type: 'image/png', declared_size: 200 };
  const db = {
    from(table) {
      const query = { select: () => query, eq: () => query,
        maybeSingle: async () => ({ data: { id, status: 'uploading', upload_expires_at: new Date(Date.now() + 60000).toISOString() } }),
        order: async () => ({ data: [file] }) };
      return query;
    },
    storage: { from: bucket => {
      assert.equal(bucket, 'cast-registration-private');
      return { createSignedUploadUrl: async (object, options) => {
        assert.equal(object, file.object_path); assert.equal(options.upsert, false);
        return { data: { token: 'synthetic-object-token' } };
      } };
    } },
  };
  const handler = createRegistrationHandler({ db, rules,
    env: name => name === 'SUPABASE_URL' ? 'https://vmnkdbceyqudcxddvljx.supabase.co' : '' });
  const request = req({ action: 'uploads', id });
  request.headers.set('Authorization', 'Bearer ' + 'a'.repeat(64));
  const result = await handler(request); assert.equal(result.status, 200);
  const data = await result.json();
  assert.equal(data.endpoint, 'https://vmnkdbceyqudcxddvljx.storage.supabase.co/storage/v1/upload/resumable/sign');
  assert.deepEqual(Object.keys(data).sort(), ['bucket', 'endpoint', 'uploads']);
  assert.deepEqual(data.uploads, [{ slot: 0, objectPath: file.object_path, token: 'synthetic-object-token', type: 'image/png', size: 200 }]);
  const retry = req({ action: 'uploads', id, slots: [] });
  retry.headers.set('Authorization', 'Bearer ' + 'a'.repeat(64));
  assert.deepEqual((await (await handler(retry)).json()).uploads, []);
  for (const slots of [[1], [0, 0], ['0']]) {
    const invalid = req({ action: 'uploads', id, slots });
    invalid.headers.set('Authorization', 'Bearer ' + 'a'.repeat(64));
    assert.equal((await handler(invalid)).status, 400);
  }
});

test('registration retry identity excludes rotating challenge fields and preserves applicant fields', () => {
  const fs = require('node:fs'), vm = require('node:vm'), acorn = require('acorn');
  const source = fs.readFileSync('cast-register.js', 'utf8');
  const wrapper = acorn.parse(source, { ecmaVersion: 'latest' }).body[0].expression.callee;
  const fieldsFunction = wrapper.body.body.find(node => node.type === 'FunctionDeclaration' && node.id.name === 'fields');
  let challenge = 'first-proof';
  const applicant = { name: 'Synthetic', gender: 'female', age: '50', height: '170', weight: '70', nationality: '',
    speaking: 'no', whatsapp: '+12025550123', worksMode: 'drive', folderUrl: 'https://drive.google.com/drive/folders/SyntheticFolderOnly123' };
  class FormData {
    constructor() { this.values = { ...applicant, 'cf-turnstile-response': challenge, injected: 'not-an-applicant-field' }; }
    get(key) { return this.values[key] ?? null; }
    [Symbol.iterator]() { return Object.entries(this.values)[Symbol.iterator](); }
  }
  const read = vm.runInNewContext('(' + source.slice(fieldsFunction.start, fieldsFunction.end) + ')', { FormData, form: {} });
  const first = JSON.stringify(read()); challenge = 'renewed-proof';
  assert.equal(JSON.stringify(read()), first);
  assert.deepEqual(JSON.parse(first), applicant);
});
