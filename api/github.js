const { common, json, session, github, allowed, ORIGIN } = require('../lib/admin-auth.cjs');
module.exports = async (req, res) => {
  if (!common(req, res)) return;
  if (req.method !== 'POST' || req.headers.origin !== ORIGIN) return json(res, 403, { message: 'Forbidden' });
  let user;
  try { user = await session(req); } catch { return json(res, 401, { message: 'Sign in required' }); }
  if (user.accessExpires <= Date.now()) return json(res, 401, { message: 'Session refresh required' });
  const { path, method = 'GET', body } = req.body || {};
  if (!allowed(path, method, body)) return json(res, 403, { message: 'This operation is not allowed' });
  try {
    const response = await github(path, user.accessToken, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
    for (const name of ['retry-after', 'x-ratelimit-remaining']) {
      if (response.headers.has(name)) res.setHeader(name, response.headers.get(name));
    }
    res.setHeader('Access-Control-Expose-Headers', 'retry-after, x-ratelimit-remaining');
    return json(res, response.status, response.status === 204 ? null : await response.json());
  } catch { return json(res, 502, { message: 'GitHub is temporarily unavailable' }); }
};
