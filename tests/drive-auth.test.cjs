const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { OAuth2Client } = require('google-auth-library');
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
  assert.equal(response.headers.Location, `${ORIGIN}/cast/cast-admin.html#cast-drive=failed&cast-drive-reason=expired-or-missing`);
  assert.match(response.headers['Set-Cookie'], /Max-Age=0/);
});
test('valid callback stores only the encrypted limited connection and confirms the return', async () => {
  const originalFetch = global.fetch;
  const originalExchange = OAuth2Client.prototype.getToken;
  let stored = false;
  global.fetch = async (url, options) => {
    if (url === 'https://api.github.com/user') return Response.json({ id: OWNER_ID });
    assert.equal(url, 'https://vmnkdbceyqudcxddvljx.supabase.co/functions/v1/cast-registration');
    assert.equal(options.headers.Origin, ORIGIN);
    const body = JSON.parse(options.body);
    assert.equal(body.action, 'drive-store');
    assert.ok(!body.connection.includes('PRIVATE'));
    assert.equal((await drive.connection(body.connection)).tokens.refresh_token, tokens.refresh_token);
    stored = true;
    return Response.json({ connected: true });
  };
  OAuth2Client.prototype.getToken = async input => {
    assert.equal(input.redirect_uri, drive.CALLBACK);
    assert.equal(input.codeVerifier, 'synthetic-verifier');
    return { tokens };
  };
  try {
    const authorization = `Bearer ${await seal({ sub: OWNER_ID, accessToken: 'PRIVATE-GITHUB',
      accessExpires: Date.now() + 3600000 }, 'cast-session')}`;
    const cookie = await seal({ state: 'expected', verifier: 'synthetic-verifier', authorization }, 'cast-drive-state', '10m');
    const response = res();
    await handler({ url: '/api/drive-auth?action=callback&state=expected&code=synthetic-code',
      method: 'GET', headers: { cookie: `__Host-cast-drive=${cookie}` } }, response);
    assert.equal(stored, true);
    assert.equal(response.headers.Location, `${ORIGIN}/cast/cast-admin.html#cast-drive=connected`);
    assert.match(response.headers['Set-Cookie'], /Max-Age=0/);
  } finally { global.fetch = originalFetch; OAuth2Client.prototype.getToken = originalExchange; }
});
test('missing Drive permission fails closed with diagnostics that contain no credentials', async () => {
  const originalFetch = global.fetch;
  const originalExchange = OAuth2Client.prototype.getToken;
  const originalWarn = console.warn;
  const warnings = [];
  global.fetch = async url => { assert.equal(url, 'https://api.github.com/user'); return Response.json({ id: OWNER_ID }); };
  OAuth2Client.prototype.getToken = async () => ({ tokens: { ...tokens, scope: '' } });
  console.warn = (...args) => warnings.push(args);
  try {
    const authorization = `Bearer ${await seal({ sub: OWNER_ID, accessToken: 'PRIVATE-GITHUB',
      accessExpires: Date.now() + 3600000 }, 'cast-session')}`;
    const cookie = await seal({ state: 'expected', verifier: 'synthetic-verifier', authorization }, 'cast-drive-state', '10m');
    const response = res();
    await handler({ url: '/api/drive-auth?action=callback&state=expected&code=PRIVATE-CODE', method: 'GET',
      headers: { cookie: `__Host-cast-drive=${cookie}` } }, response);
    assert.equal(response.headers.Location, `${ORIGIN}/cast/cast-admin.html#cast-drive=failed&cast-drive-reason=failed`);
    assert.deepEqual(warnings, [['cast-drive-callback-failed', { phase: 'grant', reason: 'failed', failure: 'failed', status: null }]]);
    assert.ok(!JSON.stringify(warnings).includes('PRIVATE'));
  } finally { global.fetch = originalFetch; OAuth2Client.prototype.getToken = originalExchange; console.warn = originalWarn; }
});
test('expired state is explained without exchanging a code or extending session lifetime', async () => {
  const originalFetch = global.fetch;
  const originalWarn = console.warn;
  let calls = 0;
  global.fetch = async () => { ++calls; throw new Error('Must not exchange expired state'); };
  console.warn = () => {};
  try {
    const expired = await seal({ state: 'expected', verifier: 'private-verifier', authorization: 'PRIVATE' }, 'cast-drive-state', '-1s');
    const response = res();
    await handler({ url: '/api/drive-auth?action=callback&state=expected&code=PRIVATE-CODE', method: 'GET',
      headers: { cookie: `another=value;__Host-cast-drive=${expired}` } }, response);
    assert.equal(calls, 0);
    assert.equal(response.headers.Location, `${ORIGIN}/cast/cast-admin.html#cast-drive=failed&cast-drive-reason=expired`);
    assert.match(response.headers['Set-Cookie'], /Max-Age=0/);
  } finally { global.fetch = originalFetch; console.warn = originalWarn; }
});
