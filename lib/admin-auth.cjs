const crypto = require('node:crypto');
const ORIGIN = 'https://anas3719.github.io';
const RETURN_URL = `${ORIGIN}/cast/cast-admin.html`;
const SERVICE = 'https://cast-admin-anas3719.vercel.app';
const OWNER_ID = '231677417';
const REPO = '/repos/anas3719/cast';
const FILES = new Set(['cast-data.js', 'photographers-data.js', 'cast-categories.js',
  'cast-site-settings.js', 'cast-admin-auth.js', 'cast-admin.html', 'index.html',
  'cast.html', 'cast-category.html', 'cast-men.html', 'cast-women.html',
  'cast-boys.html', 'cast-girls.html', 'cast-senior-men.html', 'cast-senior-women.html',
  'photographers.html']);

function key() {
  const value = Buffer.from(process.env.SESSION_KEY || '', 'base64');
  if (value.length !== 32) throw new Error('Auth service is not configured');
  return value;
}
async function seal(value, purpose, duration = '30d') {
  const { EncryptJWT } = await import('jose');
  return new EncryptJWT(value).setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuer(SERVICE).setAudience(purpose).setIssuedAt().setExpirationTime(duration).encrypt(key());
}
async function unseal(value, purpose) {
  const { jwtDecrypt } = await import('jose');
  return (await jwtDecrypt(value, key(), { issuer: SERVICE, audience: purpose })).payload;
}
function json(res, status, body) { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); }
function common(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Vary', 'Origin');
  if (req.headers.origin === ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', ORIGIN);
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return false; }
  return true;
}
async function session(req) {
  const bearer = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(req.headers.authorization || '');
  if (!bearer) throw new Error('Unauthorized');
  const value = await unseal(bearer[1], 'cast-session');
  if (value.sub !== OWNER_ID || !value.accessToken) throw new Error('Unauthorized');
  return value;
}
async function github(path, accessToken, options = {}) {
  return fetch(`https://api.github.com${path}`, {
    ...options, redirect: 'error', signal: AbortSignal.timeout(20000),
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Cast-Admin', 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
  });
}
async function exchange(params) {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST', signal: AbortSignal.timeout(15000),
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET, ...params }),
  });
  const value = await response.json();
  if (!response.ok || value.error || !value.access_token) {
    const error = new Error('GitHub authorization failed');
    error.status = response.status >= 500 || response.status === 429 ? 503 : 401;
    throw error;
  }
  return { accessToken: value.access_token, refreshToken: value.refresh_token || '',
    accessExpires: Date.now() + (value.expires_in || 28800) * 1000, sub: OWNER_ID };
}
function allowed(path, method, body) {
  if (typeof path !== 'string' || !path.startsWith(REPO)) return false;
  const suffix = path.slice(REPO.length);
  if (method === 'GET') return suffix === '' || suffix === '/git/ref/heads/main'
    || /^\/git\/commits\/[a-f0-9]{40}$/.test(suffix)
    || (suffix.startsWith('/contents/') && FILES.has(suffix.slice(10).split('?')[0])
      && !suffix.includes('..') && (!suffix.includes('?') || suffix.endsWith('?ref=main')));
  if (method === 'POST' && suffix === '/git/blobs') return body?.encoding === 'base64' && typeof body.content === 'string' && body.content.length < 2000000;
  if (method === 'POST' && suffix === '/git/trees') return /^[a-f0-9]{40}$/.test(body?.base_tree || '')
    && Array.isArray(body.tree) && body.tree.length <= FILES.size
    && body.tree.every(x => FILES.has(x.path) && x.type === 'blob' && x.mode === '100644' && /^[a-f0-9]{40}$/.test(x.sha));
  if (method === 'POST' && suffix === '/git/commits') return /^[a-f0-9]{40}$/.test(body?.tree || '')
    && Array.isArray(body.parents) && body.parents.length === 1 && /^[a-f0-9]{40}$/.test(body.parents[0])
    && typeof body.message === 'string' && body.message.length < 500;
  return method === 'PATCH' && suffix === '/git/refs/heads/main' && body?.force === false && /^[a-f0-9]{40}$/.test(body.sha);
}
module.exports = { crypto, ORIGIN, RETURN_URL, SERVICE, OWNER_ID, REPO, seal, unseal, common, json, session, github, exchange, allowed };
