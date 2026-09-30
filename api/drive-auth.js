const { crypto, common, json, seal, unseal, SERVICE, ORIGIN, RETURN_URL } = require('../lib/admin-auth.cjs');
const drive = require('../lib/drive-auth.cjs');
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
      const request = await seal({ authorization: req.headers.authorization }, 'cast-drive-start', '2m');
      return json(res, 200, { url: `${SERVICE}/api/drive-auth?action=start&request=${encodeURIComponent(request)}` });
    } catch { return json(res, 503, { message: 'لم يكتمل إعداد ربط الدرايف بعد.' }); }
  }
  if (action === 'start' && req.method === 'GET') {
    try {
      const input = await unseal(url.searchParams.get('request'), 'cast-drive-start');
      await drive.requireOwner({ headers: { authorization: input.authorization } });
      const state = crypto.randomBytes(32).toString('hex');
      const verifier = crypto.randomBytes(32).toString('base64url');
      const flow = await seal({ state, verifier, authorization: input.authorization }, 'cast-drive-state', '10m');
      if (flow.length > 3700) throw new Error('Cookie capacity exceeded');
      cookie(res, flow);
      return redirect(res, drive.authorizationUrl(drive.client(), state, verifier));
    } catch { cookie(res, '', 0); return redirect(res, `${RETURN_URL}#cast-drive=failed`); }
  }
  if (action === 'callback' && req.method === 'GET') {
    try {
      const raw = (req.headers.cookie || '').split('; ').find(value => value.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
      const flow = await unseal(raw, 'cast-drive-state');
      cookie(res, '', 0);
      if (url.searchParams.get('state') !== flow.state || url.searchParams.get('error') || !url.searchParams.get('code')) {
        throw new Error('Invalid OAuth state');
      }
      await drive.requireOwner({ headers: { authorization: flow.authorization } });
      const { tokens } = await drive.client().getToken({ code: url.searchParams.get('code'),
        codeVerifier: flow.verifier, redirect_uri: drive.CALLBACK });
      await drive.saveConnection(flow.authorization, await drive.protect(tokens));
      return redirect(res, `${RETURN_URL}#cast-drive=connected`);
    } catch { cookie(res, '', 0); return redirect(res, `${RETURN_URL}#cast-drive=failed`); }
  }
  return json(res, 404, { message: 'غير مسموح.' });
};
