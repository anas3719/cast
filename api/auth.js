const { crypto, ORIGIN, RETURN_URL, SERVICE, OWNER_ID, REPO, common, json, seal, unseal, session, github, exchange } = require('../lib/admin-auth.cjs');
const COOKIE = '__Host-cast-oauth';
function cookie(res, value, age = 600) { res.setHeader('Set-Cookie', `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`); }
function redirect(res, url) { res.statusCode = 302; res.setHeader('Location', url); res.end(); }
module.exports = async (req, res) => {
  if (!common(req, res)) return;
  const url = new URL(req.url, SERVICE);
  const action = url.searchParams.get('action');
  if (action === 'health') return json(res, 200, { ready: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET && process.env.SESSION_KEY) });
  if (action === 'start' && req.method === 'GET') {
    const nonce = url.searchParams.get('nonce');
    if (!/^[a-f0-9]{64}$/.test(nonce || '')) return json(res, 400, { message: 'Invalid login request' });
    if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) return json(res, 503, { message: 'GitHub login setup is not complete' });
    const state = crypto.randomBytes(32).toString('hex');
    const verifier = crypto.randomBytes(32).toString('base64url');
    cookie(res, await seal({ state, nonce, verifier }, 'oauth-state', '10m'));
    const query = new URLSearchParams({ client_id: process.env.GITHUB_CLIENT_ID,
      redirect_uri: `${SERVICE}/api/auth?action=callback`, state, login: 'anas3719', allow_signup: 'false',
      code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
    return redirect(res, `https://github.com/login/oauth/authorize?${query}`);
  }
  if (action === 'callback' && req.method === 'GET') {
    let flow;
    try {
      const raw = (req.headers.cookie || '').split('; ').find(x => x.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
      flow = await unseal(raw, 'oauth-state');
      cookie(res, '', 0);
      if (url.searchParams.get('state') !== flow.state || !url.searchParams.get('code')) throw new Error('Invalid state');
      const user = await exchange({ code: url.searchParams.get('code'), code_verifier: flow.verifier,
        redirect_uri: `${SERVICE}/api/auth?action=callback`, repository_id: '1344212817' });
      const identity = await github('/user', user.accessToken);
      if (!identity.ok || String((await identity.json()).id) !== OWNER_ID) throw new Error('Owner required');
      const repo = await github(REPO, user.accessToken);
      if (!repo.ok || !(await repo.json()).permissions?.push) throw new Error('Repository write access required');
      const sealed = await seal(user, 'cast-session');
      return redirect(res, `${RETURN_URL}#cast-session=${encodeURIComponent(sealed)}&state=${flow.nonce}`);
    } catch {
      cookie(res, '', 0);
      return redirect(res, `${RETURN_URL}#cast-login-error=1`);
    }
  }
  if (action === 'session' && req.method === 'POST' && req.headers.origin === ORIGIN) {
    let user;
    try { user = await session(req); } catch { return json(res, 401, { message: 'Sign in required' }); }
    try {
      if (user.accessExpires < Date.now() + 300000) {
        if (!user.refreshToken) return json(res, 401, { message: 'Sign in required' });
        user = await exchange({ grant_type: 'refresh_token', refresh_token: user.refreshToken });
      }
      const identity = await github('/user', user.accessToken);
      if (identity.status === 401) return json(res, 401, { message: 'Login required' });
      if (!identity.ok) return json(res, 503, { message: 'GitHub is temporarily unavailable' });
      if (String((await identity.json()).id) !== OWNER_ID) return json(res, 401, { message: 'Login required' });
      return json(res, 200, { session: await seal({ sub: user.sub, accessToken: user.accessToken,
        refreshToken: user.refreshToken, accessExpires: user.accessExpires }, 'cast-session') });
    } catch (error) { return json(res, error.status === 401 ? 401 : 503, { message: 'Unable to refresh session' }); }
  }
  return json(res, 404, { message: 'Not found' });
};
