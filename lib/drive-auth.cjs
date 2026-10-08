const { OAuth2Client } = require('google-auth-library');
const { crypto, SERVICE, ORIGIN, OWNER_ID, session, github, seal, unseal } = require('./admin-auth.cjs');
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const CALLBACK = `${SERVICE}/api/drive-auth?action=callback`;
const EDGE = 'https://vmnkdbceyqudcxddvljx.supabase.co/functions/v1/cast-registration';

function client() {
  if (!process.env.GOOGLE_CAST_CLIENT_ID || !process.env.GOOGLE_CAST_CLIENT_SECRET) {
    throw new Error('Drive setup incomplete');
  }
  return new OAuth2Client({ clientId: process.env.GOOGLE_CAST_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CAST_CLIENT_SECRET, redirectUri: CALLBACK });
}
async function requireOwner(req) {
  const user = await session(req);
  if (user.accessExpires < Date.now()) throw new Error('Expired owner session');
  const response = await github('/user', user.accessToken);
  if (!response.ok || String((await response.json()).id) !== OWNER_ID) throw new Error('Owner required');
}
function limited(tokens) {
  const scopes = new Set(String(tokens.scope || '').split(/\s+/).filter(Boolean));
  return scopes.size === 1 && scopes.has(SCOPE) && typeof tokens.refresh_token === 'string'
    && tokens.refresh_token.length > 10 && typeof tokens.access_token === 'string';
}
async function protect(tokens) {
  if (!limited(tokens)) throw new Error('Limited offline grant required');
  return seal({ tokens, clientId: process.env.GOOGLE_CAST_CLIENT_ID }, 'cast-drive-connection', '365d');
}
async function connection(value) {
  const payload = await unseal(value, 'cast-drive-connection');
  if (payload.clientId !== process.env.GOOGLE_CAST_CLIENT_ID || !limited(payload.tokens)) {
    throw new Error('Invalid Drive connection');
  }
  return payload;
}
function authorizationUrl(oauth, state, verifier, official = false) {
  const url = new URL(oauth.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: [SCOPE],
    include_granted_scopes: false, state,
    code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256' }));
  if (official) {
    url.searchParams.set('trigger_onepick', 'true');
    url.searchParams.set('allow_multiple', 'true');
    url.searchParams.set('allow_folder_selection', 'true');
    url.searchParams.set('mimetypes', 'application/vnd.google-apps.folder');
    url.searchParams.set('file_ids', require('./drive-destinations.cjs').FILE_IDS.join(','));
  }
  return url.href;
}
async function saveConnection(authorization, sealedConnection, pickedIds) {
  const result = await fetch(EDGE, { method: 'POST', redirect: 'error',
    signal: AbortSignal.timeout(20000), headers: { Origin: ORIGIN, Authorization: authorization,
      'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'drive-store', connection: sealedConnection,
      ...(pickedIds ? { destination: 'official', pickedIds } : {}) }) });
  if (!result.ok) {
    const error = new Error('Connection was not saved');
    error.status = result.status;
    throw error;
  }
}
module.exports = { SCOPE, CALLBACK, client, requireOwner, limited, protect, connection,
  authorizationUrl, saveConnection };
