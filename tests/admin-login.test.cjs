const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('cast-admin-login.js', 'utf8');
function storage(seed = {}) {
  const data = new Map(Object.entries(seed));
  return { getItem: k => data.get(k) || null, setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) };
}
function browser(hash = '', nonce = '') {
  const context = { window: {}, location: { hash, pathname: '/cast/cast-admin.html', search: '', assign(url) { this.assigned = url; } },
    history: { replaceState() {} }, localStorage: storage(), sessionStorage: storage({ 'cast-admin-login-state': nonce }),
    URLSearchParams, Uint8Array, crypto: require('node:crypto').webcrypto,
    fetch: async () => new Response('{}', { status: 503 }) };
  vm.runInNewContext(source, context);
  return context;
}
test('login return requires matching browser nonce', () => {
  assert.equal(browser('#cast-session=fake&state=wrong', 'expected').window.castAdminLogin.connected, false);
  const ctx = browser('#cast-session=encrypted-test&state=expected', 'expected');
  assert.equal(ctx.window.castAdminLogin.connected, true);
  assert.equal(ctx.window.castAdminLogin.returned, true);
  assert.equal(ctx.sessionStorage.getItem('cast-admin-login-state'), null);
});
test('transient auth service failure does not discard saved login', async () => {
  const ctx = browser('#cast-session=encrypted-test&state=expected', 'expected');
  await assert.rejects(ctx.window.castAdminLogin.refresh());
  assert.equal(ctx.window.castAdminLogin.connected, true);
  ctx.fetch = async () => new Response('{}', { status: 401 });
  assert.equal(await ctx.window.castAdminLogin.refresh(), false);
  assert.equal(ctx.window.castAdminLogin.connected, false);
});
test('draft survives reload without storing publishing credentials or replacing conflict baseline', () => {
  const admin = fs.readFileSync('cast-admin.js', 'utf8');
  const start = admin.indexOf('  function savePendingDraft()');
  const end = admin.indexOf('  function startGithubLogin()', start);
  const ctx = { localStorage: storage(), draftStorageKey: 'test', members: [{ id: 'synthetic', age: '29' }],
    categoryDefinitions: [{ key: 'women' }], siteSettings: { heroTitle: 'test' },
    baseDataSource: 'base', basePhotographersSource: '', baseCategoriesSource: '', baseAuthSource: '', baseSiteSettingsSource: '',
    githubToken: 'DO-NOT-STORE', authConfig: { private: 'DO-NOT-STORE' },
    showToast() {}, normalizeCategoryDefinitions: x => x, normalizeSiteSettings: x => x,
    elements: { publishChanges: {} }, syncCategoryOptions() {}, renderProfiles() {}, setSyncStatus() {}, dataDirty: false };
  vm.createContext(ctx); vm.runInContext(admin.slice(start, end), ctx);
  assert.equal(ctx.savePendingDraft(), true);
  assert.ok(!ctx.localStorage.getItem('test').includes('DO-NOT-STORE'));
  ctx.members = []; ctx.baseDataSource = 'new remote';
  assert.equal(ctx.restorePendingDraft(), true);
  assert.equal(ctx.members[0].age, '29');
  assert.equal(ctx.baseDataSource, 'base');
  assert.equal(ctx.dataDirty, true);
  ctx.clearPendingDraft(); assert.equal(ctx.restorePendingDraft(), false);
});
