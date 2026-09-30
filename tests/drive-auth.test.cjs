const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const drive = require('../lib/drive-auth.cjs');
const handler = require('../api/drive-auth.js');
const { seal, unseal, ORIGIN, OWNER_ID, SERVICE } = require('../lib/admin-auth.cjs');
process.env.SESSION_KEY = randomBytes(32).toString('base64');
process.env.GOOGLE_CAST_CLIENT_ID = 'synthetic.apps.googleusercontent.com';
process.env.GOOGLE_CAST_CLIENT_SECRET = 'synthetic-server-only';
const res = () => ({ statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(v) { this.body = v; } });
const tokens = { scope: drive.SCOPE, refresh_token: 'PRIVATE-REFRESH-TOKEN', access_token: 'PRIVATE-ACCESS-TOKEN' };

test('Google authorization uses the fixed callback and only drive.file with PKCE', () => {
  const url = new URL(drive.authorizationUrl(drive.client(), 'a'.repeat(64), 'verifier'));
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('scope'), drive.SCOPE);
  assert.equal(url.searchParams.get('redirect_uri'), drive.CALLBACK);
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('include_granted_scopes'), 'false');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
});
test('connection is encrypted, rejects broad grants, missing refresh and changed clients', async () => {
  assert.equal(drive.limited(tokens), true);
  for (const candidate of [{ ...tokens, scope: `${drive.SCOPE} https://www.googleapis.com/auth/drive` },
    { ...tokens, scope: '' }, { ...tokens, refresh_token: '' }]) {
    await assert.rejects(drive.protect(candidate));
  }
  const blob = await drive.protect(tokens);
  assert.ok(!blob.includes('PRIVATE'));
  assert.equal((await drive.connection(blob)).tokens.refresh_token, tokens.refresh_token);
  await assert.rejects(unseal(blob, 'cast-session'));
  const changed = await seal({ clientId: 'other', tokens }, 'cast-drive-connection');
  await assert.rejects(drive.connection(changed));
});
test('start requires the owner, sets an HttpOnly cookie and exposes no GitHub session to Google', async () => {
  const original = global.fetch;
  global.fetch = async url => { assert.equal(url, 'https://api.github.com/user'); return Response.json({ id: OWNER_ID }); };
  try {
    const session = await seal({ sub: OWNER_ID, accessToken: 'PRIVATE-GITHUB', accessExpires: Date.now() + 3600000 }, 'cast-session');
    const prepared = res();
    await handler({ url: '/api/drive-auth?action=prepare', method: 'POST', headers: { origin: ORIGIN, authorization: `Bearer ${session}` } }, prepared);
    assert.equal(prepared.statusCode, 200);
    const start = new URL(JSON.parse(prepared.body).url); assert.equal(start.origin, SERVICE);
    const redirected = res();
    await handler({ url: start.pathname + start.search, method: 'GET', headers: {} }, redirected);
    assert.equal(redirected.statusCode, 303);
    assert.match(redirected.headers['Set-Cookie'], /HttpOnly; Secure; SameSite=Lax/);
    assert.ok(!redirected.headers.Location.includes(session));
    assert.ok(!redirected.headers.Location.includes('PRIVATE'));
    const anonymous = res();
    await handler({ url: '/api/drive-auth?action=prepare', method: 'POST', headers: { origin: ORIGIN } }, anonymous);
    assert.equal(anonymous.statusCode, 401);
  } finally { global.fetch = original; }
});
test('invalid callback state is cleaned and returns only a closed failure hint', async () => {
  const response = res();
  await handler({ url: '/api/drive-auth?action=callback&state=bad&code=secret', method: 'GET', headers: {} }, response);
  assert.equal(response.statusCode, 303);
  assert.equal(response.headers.Location, `${ORIGIN}/cast/cast-admin.html#cast-drive=failed`);
  assert.match(response.headers['Set-Cookie'], /Max-Age=0/);
});
