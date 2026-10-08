const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname, '../cast-register.js'), 'utf8');
function section(start, end) {
  const offset = source.indexOf(start);
  assert.ok(offset >= 0 && source.indexOf(end, offset) > offset);
  return source.slice(offset, source.indexOf(end, offset));
}
function helpers(values = {}) {
  const context = vm.createContext({crypto: webcrypto, Uint8Array, AbortController, TypeError,
    setTimeout, clearTimeout, ...values});
  vm.runInContext(section('  const mimeByExtension', '  function fields()'), context);
  return context;
}

test('mobile MIME aliases and generic picker types resolve only supported extensions', () => {
  const context = helpers();
  const cases = [
    ['photo.JPG', '', 'image/jpeg'], ['photo.heic', 'application/octet-stream', 'image/heic'],
    ['clip.MOV', '', 'video/quicktime'], ['photo.jpg', 'image/jpg', 'image/jpeg'],
    ['burst.heic', 'image/heic-sequence', 'image/heic'], ['clip.mp4', 'video/x-m4v', 'video/mp4'],
    ['unknown.exe', '', ''], ['fake.jpg', 'text/html', 'text/html'],
  ];
  for (const [name, type, expected] of cases) assert.equal(context.mediaType({name, type}), expected);
});

test('older browsers get cryptographically random version-4 request IDs without randomUUID', () => {
  const context = helpers({crypto: {getRandomValues: value => webcrypto.getRandomValues(value)}});
  const ids = new Set(Array.from({length: 50}, () => context.randomId()));
  assert.equal(ids.size, 50);
  for (const id of ids) assert.match(id, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
});

test('API timeout and network failure surface retryable errors and always clear timers', async () => {
  let clears = 0;
  const context = helpers({api: 'https://synthetic.example', setTimeout: callback => {callback(); return 1;},
    clearTimeout: () => {clears++;}, fetch: async (_, options) => {
      assert.equal(options.signal.aborted, true); throw Object.assign(new Error(), {name: 'AbortError'});
    }});
  await assert.rejects(context.request('availability'), /تأخر الاتصال/);
  context.fetch = async () => {throw new TypeError('offline');};
  await assert.rejects(context.request('uploads'), /الإنترنت/);
  assert.equal(clears, 2);
});

test('API rejection preserves field errors; successful requests return receipts', async () => {
  const context = helpers({api: 'https://synthetic.example', fetch: async () => ({ok: false,
    json: async () => ({message: 'bad file', errors: {portrait: 'wrong image'}})})});
  await assert.rejects(context.request('create'), error => error.errors.portrait === 'wrong image');
  context.fetch = async () => ({ok: true, json: async () => ({status: 'pending'})});
  assert.equal((await context.request('receipt')).status, 'pending');
});

test('resumable upload does not touch localStorage and resumes its own page-local upload', async () => {
  let starts = 0, resumed, timeout, options;
  class Upload {
    constructor(file, config) {this.options = options = config;}
    findPreviousUploads() {return this.options.urlStorage.findUploadsByFingerprint('request-0');}
    resumeFromPreviousUpload(previous) {resumed = previous.uploadUrl;}
    async start() {
      starts++; this.options.onBeforeRequest({getUnderlyingObject: () => {
        const xhr = {}; Object.defineProperty(xhr, 'timeout', {set: value => {timeout = value;}}); return xhr;
      }});
      await this.options.urlStorage.addUpload('request-0', {uploadUrl: 'https://synthetic.example/upload'});
      if (starts === 1) this.options.onError(new Error('disconnected'));
      else {this.options.onProgress(100); this.options.onSuccess();}
    }
  }
  const progress = {value: 0}, label = {textContent: ''};
  const context = helpers({tus: {Upload}, stopped: false, activeUpload: null,
    attempt: {id: 'request'}, progress, document: {querySelector: () => label}});
  Object.defineProperty(context, 'localStorage', {get() {throw new Error('Storage is blocked');}});
  vm.runInContext(section('  function uploadFile(', "  form.addEventListener('change'"), context);
  const file = {name: 'test.mp4'}, signed = {slot: 0, type: 'video/mp4', objectPath: 'private/0', token: 'synthetic'};
  const config = {endpoint: 'https://synthetic.example', bucket: 'private'};
  await assert.rejects(context.uploadFile(file, signed, config, 0, 100), /test.mp4/);
  await context.uploadFile(file, signed, config, 0, 100);
  assert.equal(starts, 2); assert.equal(resumed, 'https://synthetic.example/upload');
  assert.equal(timeout, 300000); assert.equal(options.chunkSize, 6 * 1024 ** 2);
  assert.equal(options.headers['x-signature'], 'synthetic'); assert.equal(progress.value, 100);
  context.stopped = true;
  await assert.rejects(context.uploadFile(file, signed, config, 0, 100), /توقف الرفع/);
  assert.equal(starts, 2);
});

test('queued files are signed just in time, completed files are skipped, and lost submission receipts reconcile', async () => {
  const calls = [], submitted = [], files = [{name:'portrait.png',size:2},{name:'one.mp4',size:4},{name:'two.png',size:3}];
  let listener, fail = true, receiptStatus = 'uploading';
  const request = async (action, body) => {
    calls.push({action,...body});
    if (action==='receipt') return {status:receiptStatus};
    if (action==='uploads') return {uploads:body.slots.map(slot=>({slot}))};
    if (action==='submit') {receiptStatus='pending';throw Error('Lost receipt');}
    return {};
  };
  const context = helpers({form: {addEventListener: (_, callback) => {listener = callback;}, querySelector: () => null},
    busy:false,open:true,stopped:false,attempt:null,activeUpload:null,progress:{value:0},challenge:'synthetic',
    errorBox:{textContent:'',focus(){}},portrait:{files:[files[0]]},
    selection:() => ({data:{worksMode:'upload'},chosen:files,manifest:files}),
    rules:{validate:()=>({errors:{}}),validateAttachments:()=>({errors:{}})},
    showErrors(){},setBusy(){},resetChallenge(){},document:{querySelector:()=>({textContent:''})},
    receipt: data => {submitted.push(data);},
    uploadFile:async file => {if (file===files[1] && fail) {fail=false;throw Error('Interrupted');}},
  });
  context.request = request;
  vm.runInContext(section("  form.addEventListener('submit'", '  window.lucide'), context);
  const event={preventDefault(){}};
  await listener(event);
  await listener(event);
  await listener(event);
  assert.equal(calls.filter(item=>item.action==='create').length,1);
  assert.deepEqual(calls.filter(item=>item.action==='uploads').map(item=>Array.from(item.slots)),[[0],[1],[1],[2]]);
  assert.equal(calls.filter(item=>item.action==='submit').length,1);
  assert.equal(submitted.length,1);assert.equal(submitted[0].status,'pending');
});
