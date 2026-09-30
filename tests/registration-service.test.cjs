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
