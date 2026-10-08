// Local synthetic UI transport only. Never deployed or used for real applicants.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const id = '00000000-0000-4000-8000-000000000000';
let created, failNextEdit = false, failNextApproval=false, completeApproval=false, approvalReads=0;
const uploads = new Map();
const record = { id, profileId: 'registration-' + id, revision: 1, status: 'pending',
  profile: { name: 'ملف تجريبي', gender: 'female', age: 26, height: 165, weight: 55, nationality: '', speaking: 'yes', category: 'women' },
  privateContact: { whatsapp: '+966500000000' }, ownerNote: '', works: { mode: 'drive', folderUrl: 'https://drive.google.com/drive/folders/SyntheticFolderOnly123', reviewedCount: 2, accessible: true },
  attachments: [{name:'Synthetic portrait.png',type:'image/png',size:1024,role:'portrait',verified:true}] };
const base = 'http://127.0.0.1:4187';
const api = 'https://vmnkdbceyqudcxddvljx.supabase.co/functions/v1/cast-registration';
const json = (res, data) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
http.createServer(async (req, res) => {
  const url = new URL(req.url, base);
  if (url.pathname === '/__fixture/challenge.js') {
    res.setHeader('Content-Type', 'application/javascript');
    return res.end('window.turnstile={render:(target,config)=>{config.callback("synthetic");return 1;},reset:()=>{}};');
  }
  if (url.pathname === '/__fixture/login.js') {
    res.setHeader('Content-Type', 'application/javascript');
    return res.end(`window.castAdminLogin={connected:true,refresh:async()=>true,request:(p)=>fetch('https://api.github.com'+p),registrations:(action,body={})=>fetch('/__fixture/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,action})})};`);
  }
  if (url.pathname === '/__fixture/api') {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    if (body.action === 'availability') return json(res, { open: true, siteKey: 'synthetic' });
    if (body.action === 'list') return json(res, { records: [{ id, name: record.profile.name, category: 'women', status: record.status, revision: record.revision }] });
    if (body.action === 'detail') {
      if (completeApproval && record.status === 'approving' && ++approvalReads > 1) {
        record.status = 'approved'; record.approval = {status:'done',phase:5};
      }
      return json(res, { record });
    }
    if (body.action === 'drive-status') return json(res, { connected: true, connectedAt: '2026-10-01T00:00:00Z',approvalReady:true });
    if (body.action === 'approve') {
      record.status='approving';record.revision++;record.approval={status:'queued',phase:1};
      if(failNextApproval){failNextApproval=false;res.writeHead(503,{'Content-Type':'application/json'});return res.end(JSON.stringify({message:'انقطع تأكيد الاعتماد التجريبي'}));}
      return json(res,{id,status:'approving'});
    }
    if (body.action === 'edit') {
      record.revision++;
      for (const key of ['name', 'gender', 'age', 'height', 'weight', 'nationality', 'speaking']) record.profile[key] = body.fields[key];
      record.privateContact.whatsapp = body.fields.whatsapp;
      record.works.reviewedCount=body.fields.reviewedCount;record.works.accessible=body.fields.accessible;
      record.ownerNote=body.fields.ownerNote;
      if (failNextEdit) { failNextEdit = false; res.writeHead(503, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ message: 'انقطع تأكيد الحفظ التجريبي' })); }
      return json(res, { record });
    }
    if (body.action === 'create') { created = body; return json(res, { id: body.id, status: 'uploading' }); }
    if (body.action === 'uploads') return json(res, { endpoint: base + '/__fixture/upload', bucket: 'synthetic', uploads: created.files.map((file, slot) => ({ slot, objectPath: 'synthetic/' + slot, token: 'synthetic', ...file })) });
    if (body.action === 'submit') return json(res, { id: body.id, status: 'pending' });
    return json(res, { id: body.id, status: 'uploading' });
  }
  if (url.pathname.startsWith('/__fixture/upload')) {
    let bytes = 0; for await (const chunk of req) bytes += chunk.length;
    const key = req.method === 'POST' ? '/__fixture/upload/' + Date.now() : url.pathname;
    const offset = (uploads.get(key) || 0) + bytes; uploads.set(key, offset);
    res.setHeader('Tus-Resumable', '1.0.0'); res.setHeader('Upload-Offset', offset);
    res.setHeader('Location', base + key);
    res.writeHead(req.method === 'POST' ? 201 : 204); return res.end();
  }
  const filename = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/cast-register.html' : url.pathname));
  if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()
    || /[\\/]\.(?:env|admin|git|vercel)/.test(filename)) { res.writeHead(404); return res.end(); }
  let content = fs.readFileSync(filename);
  if (filename.endsWith('cast-data.js')) content = Buffer.from(content.toString() + '\nwindow.castMembers.push(' + JSON.stringify({
    id:record.profileId,name:record.profile.name,category:'women',folderUrl:record.works.folderUrl,
    photoUrl:'',age:'26',height:'165',weight:'55',nationality:'',speaking:'متحدثة',displayOrder:0,
  }) + ');');
  if (filename.endsWith('.js')) content = Buffer.from(content.toString().replace(api, base + '/__fixture/api')
    .replace('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', base + '/__fixture/challenge.js'));
  if (filename.endsWith('cast-admin.html')) {
    failNextEdit = url.searchParams.get('fixture') === 'uncertain';
    failNextApproval=url.searchParams.get('fixture')==='approval-uncertain';
    completeApproval=url.searchParams.get('fixture')==='approval-complete';approvalReads=0;
    record.status='pending';delete record.approval;
    content = Buffer.from(content.toString().replace(/cast-admin-login\.js[^" ]*/, '__fixture/login.js'));
  }
  const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png' };
  res.setHeader('Content-Type', types[path.extname(filename)] || 'application/octet-stream'); res.end(content);
}).listen(4187, '127.0.0.1', () => console.log('Synthetic UI preview: ' + base));
