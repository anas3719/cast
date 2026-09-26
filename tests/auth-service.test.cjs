const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { seal, unseal, allowed, ORIGIN, OWNER_ID, REPO } = require('../lib/admin-auth.cjs');
const handler = require('../api/auth.js');
const proxy = require('../api/github.js');
process.env.SESSION_KEY = randomBytes(32).toString('base64');
function response() { return { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(v) { this.body = v; } }; }
test('encrypted sessions are purpose-bound, opaque, and tamper-resistant', async () => {
  const value = await seal({ sub: OWNER_ID, accessToken: 'synthetic-only' }, 'cast-session');
  assert.ok(!value.includes('synthetic-only'));
  assert.equal((await unseal(value, 'cast-session')).accessToken, 'synthetic-only');
  await assert.rejects(unseal(value, 'oauth-state'));
  await assert.rejects(unseal(value.slice(0, -5) + 'ABCDE', 'cast-session'));
  const expired = await seal({}, 'cast-session', '-1s');
  await assert.rejects(unseal(expired, 'cast-session'));
});
test('proxy rejects other repositories, branches, workflows and force pushes', () => {
  const sha = 'a'.repeat(40);
  assert.ok(allowed(`${REPO}/git/ref/heads/main`, 'GET'));
  assert.ok(allowed(`${REPO}/contents/cast-data.js?ref=main`, 'GET'));
  assert.ok(!allowed('/repos/anas3719/anas-model-portfolio', 'GET'));
  assert.ok(!allowed(`${REPO}/contents/../secrets`, 'GET'));
  assert.ok(!allowed(`${REPO}/git/refs/heads/main`, 'PATCH', { sha, force: true }));
  assert.ok(!allowed(`${REPO}/git/refs/heads/other`, 'PATCH', { sha, force: false }));
  assert.ok(!allowed(`${REPO}/git/trees`, 'POST', { base_tree: sha, tree: [{ path: '.github/workflows/pwn.yml', mode: '100644', type: 'blob', sha }] }));
  assert.ok(allowed(`${REPO}/git/trees`, 'POST', { base_tree: sha, tree: [{ path: 'cast-data.js', mode: '100644', type: 'blob', sha }] }));
});
test('unauthenticated or wrong-origin requests cannot publish', async () => {
  for (const origin of [ORIGIN, 'https://example.com']) {
    const res = response();
    await proxy({ method: 'POST', headers: { origin }, body: { path: REPO } }, res);
    assert.equal(res.statusCode, origin === ORIGIN ? 401 : 403);
  }
});
test('callback rejects missing state without exchanging any authorization code', async () => {
  const old = global.fetch;
  global.fetch = () => { throw new Error('Must not call GitHub'); };
  try {
    const res = response();
    await handler({ method: 'GET', url: '/api/auth?action=callback&code=fake&state=fake', headers: {} }, res);
    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.Location, `${ORIGIN}/cast/cast-admin.html#cast-login-error=1`);
  } finally { global.fetch = old; }
});
test('transient failures preserve session; revoked credentials require login', async () => {
  const token = await seal({ sub: OWNER_ID, accessToken: 'synthetic', accessExpires: Date.now() + 3600000 }, 'cast-session');
  const req = { method: 'POST', url: '/api/auth?action=session', headers: { origin: ORIGIN, authorization: `Bearer ${token}` } };
  const old = global.fetch;
  try {
    global.fetch = async () => new Response('{}', { status: 403 });
    const limited = response(); await handler(req, limited); assert.equal(limited.statusCode, 503);
    global.fetch = async () => new Response('{}', { status: 401 });
    const revoked = response(); await handler(req, revoked); assert.equal(revoked.statusCode, 401);
    global.fetch = async () => new Response(JSON.stringify({ id: Number(OWNER_ID) }));
    const good = response(); await handler(req, good); assert.equal(good.statusCode, 200);
    assert.equal((await unseal(JSON.parse(good.body).session, 'cast-session')).sub, OWNER_ID);
  } finally { global.fetch = old; }
});
