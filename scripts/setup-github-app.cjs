// Run locally only; the generated credentials stay in the ignored setup directory.
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
fs.mkdirSync('.admin-setup', { recursive: true });
let savedFlow;
try { savedFlow = JSON.parse(fs.readFileSync('.admin-setup/flow.json', 'utf8')); } catch { /* First setup. */ }
const state = savedFlow && Date.now() - savedFlow.created < 3600000
  ? savedFlow.state : crypto.randomBytes(32).toString('hex');
fs.writeFileSync('.admin-setup/flow.json', JSON.stringify({ state, created: Date.now() }));
const manifest = {
  name: 'Anas Cast Admin', url: 'https://anas3719.github.io/cast/', public: false,
  redirect_url: 'http://127.0.0.1:4188/callback',
  callback_urls: ['https://cast-admin-anas3719.vercel.app/api/auth?action=callback'],
  setup_url: 'https://anas3719.github.io/cast/cast-admin.html',
  hook_attributes: { url: 'https://cast-admin-anas3719.vercel.app/api/auth', active: false }, default_permissions: { contents: 'write', metadata: 'read' },
  default_events: [],
};
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const url = new URL(req.url, 'http://127.0.0.1:4188');
  if (url.pathname === '/setup') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(`<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>ربط إدارة الكاست</title><h1>ربط إدارة الكاست بحساب GitHub</h1><p>الصلاحية المطلوبة: قراءة وكتابة محتويات مستودع الكاست فقط. اختر مستودع cast عند التثبيت.</p><form method="post" action="https://github.com/settings/apps/new?state=${state}"><input type="hidden" name="manifest" value='${JSON.stringify(manifest)}'><button>متابعة إلى GitHub</button></form></html>`);
  }
  if (url.pathname !== '/callback' || url.searchParams.get('state') !== state || !url.searchParams.get('code')) {
    res.statusCode = 400; return res.end('Invalid setup request');
  }
  try {
    const response = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(url.searchParams.get('code'))}/conversions`, {
      method: 'POST', headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Cast-Admin-Setup' },
    });
    const app = await response.json();
    if (!response.ok || !app.client_secret || !app.client_id) throw new Error('Setup failed');
    fs.mkdirSync('.admin-setup', { recursive: true });
    fs.writeFileSync('.admin-setup/result.json', JSON.stringify({ clientId: app.client_id,
      clientSecret: app.client_secret, sessionKey: crypto.randomBytes(32).toString('base64'), slug: app.slug }), { flag: 'wx' });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><html lang="ar" dir="rtl"><h1>تم تجهيز الربط</h1><a href="https://github.com/apps/${encodeURIComponent(app.slug)}/installations/new">تثبيت على مستودع cast فقط</a></html>`);
    console.log('GitHub App created; credentials saved privately. Installation still required.');
    server.close();
  } catch { res.statusCode = 500; res.end('Setup could not complete'); }
});
server.listen(4188, '127.0.0.1', () => console.log('Setup: http://127.0.0.1:4188/setup'));
