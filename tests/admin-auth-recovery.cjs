const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../cast-admin.js'), 'utf8');
function section(start, end) {
  return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
}
async function run() {
  const context = vm.createContext({
    githubToken: 'test-only', repository: { owner: 'test', name: 'test', branch: 'main' },
    fetch: async () => new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0' } }),
  });
  vm.runInContext(section('  async function githubRequest(', '  async function loadSourceIntoWindow('), context);
  await assert.rejects(context.githubRequest('/test'), /مؤقتًا/);
  assert.equal(context.githubToken, 'test-only');
  await assert.rejects(context.fetchGithubRaw('test.js'));
  assert.equal(context.githubToken, 'test-only');
  let reads = 0;
  context.fetch = async () => ++reads === 1
    ? new Response('{}', { status: 401 }) : new Response('public data');
  assert.equal(await context.fetchGithubRaw('test.js'), 'public data');
  assert.equal(context.githubToken, 'test-only');
  context.fetch = async () => new Response('{}', { status: 401 });
  await assert.rejects(context.githubRequest('/test'), error => error.status === 401);
  let published = 0;
  let loaded = 0;
  Object.assign(context, {
    elements: { adminPassword: { value: 'test' }, unlockAdmin: {}, adminLockError: {},
      rememberAdminDevice: { checked: true }, adminLockDialog: { close() {} } },
    authConfig: { passwordHash: 'hash', encryptedGithubToken: true },
    hashAdminPassword: async () => 'hash', decryptBundledGithubToken: async () => 'test-restored',
    storeGithubToken() {}, updateConnectionButton() {}, storeAdminUnlock() {},
    document: { body: { classList: { remove() {} } } },
    dataDirty: true, formDirty: false,
    publishChanges: async () => { published++; }, loadData: async () => { loaded++; },
  });
  vm.runInContext(section('  async function unlockAdminAccess(', '  function openSecuritySettings('), context);
  await context.unlockAdminAccess({ preventDefault() {} });
  assert.equal(published, 1);
  assert.equal(loaded, 0, 'Unlock must preserve pending edits');
  console.log('PASS: rate limits preserve connection; 401 reads preserve shared state; unlock resumes pending publish');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
