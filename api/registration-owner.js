const { ORIGIN, OWNER_ID, common, json, session, github } = require('../lib/admin-auth.cjs');

module.exports = async (req, res) => {
  if (!common(req, res)) return;
  if (req.method !== 'POST' || req.headers.origin !== ORIGIN) {
    return json(res, 403, { authorized: false });
  }
  let user;
  try { user = await session(req); }
  catch { return json(res, 401, { authorized: false }); }
  // The browser refreshes its session first. This endpoint must not rotate it.
  if (user.accessExpires < Date.now() + 30000) return json(res, 401, { authorized: false });
  try {
    const identity = await github('/user', user.accessToken);
    if (identity.status === 401) return json(res, 401, { authorized: false });
    if (!identity.ok) return json(res, 503, { authorized: false });
    if (String((await identity.json()).id) !== OWNER_ID) return json(res, 401, { authorized: false });
    return json(res, 200, { authorized: true });
  } catch { return json(res, 503, { authorized: false }); }
};
