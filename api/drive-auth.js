const { crypto, common, json, seal, unseal, SERVICE, ORIGIN, RETURN_URL } = require('../lib/admin-auth.cjs');
const drive = require('../lib/drive-auth.cjs');
const destinations = require('../lib/drive-destinations.cjs');
const COOKIE = '__Host-cast-drive';
function cookie(res, value, age = 600) {
  res.setHeader('Set-Cookie', `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`);
}
function redirect(res, url) { res.statusCode = 303; res.setHeader('Location', url); res.end(); }
module.exports = async (req, res) => {
  if (!common(req, res)) return;
  const url = new URL(req.url, SERVICE);
  const action = url.searchParams.get('action');
  if (action === 'health') return json(res, 200, { configured: Boolean(process.env.GOOGLE_CAST_CLIENT_ID && process.env.GOOGLE_CAST_CLIENT_SECRET) });
  if (req.method === 'POST' && req.headers.origin === ORIGIN && ['prepare', 'verify'].includes(action)) {
    try { await drive.requireOwner(req); } catch { return json(res, 401, { message: 'سجّل الدخول بحساب GitHub.' }); }
    try {
      drive.client();
      if (action === 'verify') {
        if (typeof req.body?.connection !== 'string' || req.body.connection.length > 12000) throw new Error('Invalid connection');
        await drive.connection(req.body.connection);
        return json(res, 200, { valid: true });
      }
      const request = await seal({ authorization: req.headers.authorization,
        official: url.searchParams.get('destination') === 'official' }, 'cast-drive-start', '2m');
      return json(res, 200, { url: `${SERVICE}/api/drive-auth?action=start&request=${encodeURIComponent(request)}` });
    } catch { return json(res, 503, { message: 'لم يكتمل إعداد ربط الدرايف بعد.' }); }
  }
  if (action === 'start' && req.method === 'GET') {
    try {
      const input = await unseal(url.searchParams.get('request'), 'cast-drive-start');
      await drive.requireOwner({ headers: { authorization: input.authorization } });
      const state = crypto.randomBytes(32).toString('hex');
      const verifier = crypto.randomBytes(32).toString('base64url');
      const flow = await seal({ state, verifier, authorization: input.authorization, official: input.official === true }, 'cast-drive-state', '10m');
      if (flow.length > 3700) throw new Error('Cookie capacity exceeded');
      cookie(res, flow);
      return redirect(res, drive.authorizationUrl(drive.client(), state, verifier, input.official === true));
    } catch { cookie(res, '', 0); return redirect(res, `${RETURN_URL}#cast-drive=failed`); }
  }
  if (action === 'callback' && req.method === 'GET') {
    let phase = 'state';
    let failure = 'failed';
    try {
      const raw = (req.headers.cookie || '').split(';').map(value => value.trim())
        .find(value => value.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
      if (!raw) { failure = 'expired-or-missing'; throw new Error('OAuth cookie missing'); }
      const flow = await unseal(raw, 'cast-drive-state');
      cookie(res, '', 0);
      if (url.searchParams.get('error') === 'access_denied') failure = 'denied';
      if (url.searchParams.get('state') !== flow.state || url.searchParams.get('error') || !url.searchParams.get('code')) {
        throw new Error('Invalid OAuth state');
      }
      phase = 'owner';
      await drive.requireOwner({ headers: { authorization: flow.authorization } });
      const pickedIds = flow.official ? (url.searchParams.get('picked_file_ids') || '').split(',') : null;
      if (flow.official && !destinations.validSelection(pickedIds)) {
        failure = 'folders'; throw new Error('Official folders not selected');
      }
      phase = 'exchange';
      const { tokens } = await drive.client().getToken({ code: url.searchParams.get('code'),
        codeVerifier: flow.verifier, redirect_uri: drive.CALLBACK });
      phase = 'grant';
      const protectedConnection = await drive.protect(tokens);
      phase = 'store';
      await drive.saveConnection(flow.authorization, protectedConnection, pickedIds);
      return redirect(res, `${RETURN_URL}#cast-drive=connected`);
    } catch (error) {
      if (phase === 'state' && error.code === 'ERR_JWT_EXPIRED') failure = 'expired';
      const reason = ['invalid_grant', 'invalid_client', 'access_denied'].includes(error.code) ? error.code : 'failed';
      console.warn('cast-drive-callback-failed', { phase, reason, failure,
        status: Number.isInteger(error.status) ? error.status : null });
      cookie(res, '', 0); return redirect(res, `${RETURN_URL}#cast-drive=failed&cast-drive-reason=${failure}`);
    }
  }
  return json(res, 404, { message: 'غير مسموح.' });
};
