const { crypto, ORIGIN, REPO, session, github, seal, unseal } = require('./admin-auth.cjs');
const drive = require('./drive-auth.cjs');
const rules = require('../cast-registration-rules.js');
const { updateCatalog, readCatalog } = require('./cast-catalog.cjs');
const ID = /^[A-Za-z0-9_-]{10,100}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const BASE = 'https://www.googleapis.com/drive/v3';
const CHUNK = 8 * 1024 * 1024;
const PROPERTY = 'anasCastRegistration';
const error = (code = 'retry') => Object.assign(new Error('Approval operation unavailable'), { code });

function validatePlan(plan) {
  if (!plan || !UUID.test(plan.jobId || '') || !UUID.test(plan.requestId || '')
    || Object.keys(plan).some(key=>!['jobId','requestId','revision','rootId','folderId','categories','files','profile'].includes(key))
    || !Number.isInteger(plan.revision) || plan.revision < 1 || !ID.test(plan.rootId || '')
    || !ID.test(plan.folderId || '') || Object.keys(plan.categories || {}).length !== 6
    || Object.keys(rules.categories).some(key => !ID.test(plan.categories[key] || ''))
    || !Array.isArray(plan.files) || plan.files.length < 1 || plan.files.length > 11) throw error('conflict');
  const profile = plan.profile;
  if (!profile || Object.keys(profile).length !== rules.publicFields.length
    || Object.keys(profile).some(key => !rules.publicFields.includes(key))
    || profile.id !== 'registration-' + plan.requestId || !Object.hasOwn(rules.categories, profile.category)
    || typeof profile.name !== 'string' || !profile.name.trim() || profile.name.length > 120
    || typeof profile.nationality !== 'string' || profile.nationality.length > 80
    || !['متحدث','متحدثة','غير متحدث','غير متحدثة'].includes(profile.speaking)
    || !/^\d+$/.test(profile.age) || Number(profile.age)>120
    || !/^\d+(?:\.\d+)?$/.test(profile.height) || Number(profile.height)<=0 || Number(profile.height)>250
    || !/^\d+(?:\.\d+)?$/.test(profile.weight) || Number(profile.weight)<=0 || Number(profile.weight)>300
    || !rules.driveFolder(profile.folderUrl)) throw error('conflict');
  const portrait = plan.files[0];
  if (profile.photoUrl !== `https://drive.google.com/thumbnail?id=${portrait.id}&sz=w1000`
    || profile.imageTitle !== 'صورة البروفايل') throw error('conflict');
  const manifest = plan.files.map((file,index) => {
    if (!ID.test(file.id || '') || !UUID.test(file.recordId || '')
      || Object.keys(file).some(key=>!['recordId','id','path','name','type','size'].includes(key))
      || !new RegExp('^' + plan.requestId + '/' + index + '/[a-f0-9-]{36}$').test(file.path || '')
      || typeof file.name !== 'string' || !file.name || file.name.length > 255
      || /[\u0000-\u001f]/.test(file.name) || !Number.isSafeInteger(file.size) || file.size > 2147483648) throw error('conflict');
    return { name:file.name, type:file.type,size:file.size,role:index===0?'portrait':'work' };
  });
  if (!rules.validateAttachments(manifest,plan.files.length===1?'drive':'upload',{imageBytes:2147483648,videoBytes:2147483648}).valid
    || new Set([plan.rootId,...Object.values(plan.categories),plan.folderId,...plan.files.map(file=>file.id)]).size !== 8+plan.files.length) throw error('conflict');
  return plan;
}
function storageUrl(value, file) {
  const url = new URL(value);
  if (url.origin !== 'https://vmnkdbceyqudcxddvljx.supabase.co'
    || decodeURIComponent(url.pathname) !== '/storage/v1/object/sign/cast-registration-private/' + file.path
    || url.username || url.password || !url.searchParams.get('token')) throw error('conflict');
  return url.href;
}
function uploadUrl(value) {
  const url = new URL(value);
  if (url.origin !== 'https://www.googleapis.com' || url.pathname !== '/upload/drive/v3/files'
    || url.searchParams.get('uploadType') !== 'resumable' || !url.searchParams.get('upload_id')
    || url.username || url.password) throw error('conflict');
  return url.href;
}
function confirmedOffset(response,size) {
  if (response.status===308) {
    const range = response.headers.get('range');
    if (!range) return 0;
    const match = /^bytes=0-(\d+)$/.exec(range);
    if (!match || Number(match[1])+1>size) throw error('conflict');
    return Number(match[1])+1;
  }
  throw error(response.status===401 || response.status===403 ? 'connection' : 'retry');
}

function createApprovalService({ fetcher=fetch, makeClient=drive.client, githubCall=github }={}) {
  async function google(connection, url, options={}) {
    const payload=await drive.connection(connection);
    const client=makeClient(); client.setCredentials(payload.tokens);
    let token;
    try { token=(await client.getAccessToken()).token; } catch { throw error('connection'); }
    if (!token) throw error('connection');
    return fetcher(url,{...options,redirect:'error',signal:AbortSignal.timeout(45000),
      headers:{ Authorization:`Bearer ${token}`, ...options.headers }});
  }
  const checked=async response=> {
    if (!response.ok) throw error(response.status===401 || response.status===403 ? 'connection':'retry');
    return response.json();
  };
  async function metadata(grant,id) {
    const result=await google(grant.connection,`${BASE}/files/${id}?fields=id,name,mimeType,size,parents,appProperties,trashed`);
    return result.status===404 ? null : checked(result);
  }
  async function folder(grant,id,name,parent,marker) {
    const existing=await metadata(grant,id);
    if (existing) {
      if (existing.trashed || existing.mimeType!=='application/vnd.google-apps.folder'
        || existing.appProperties?.[PROPERTY]!==marker) throw error('conflict');
      if(parent && !existing.parents?.includes(parent)) {
        if(marker!==grant.plan.requestId || existing.parents?.length!==1
          || !Object.values(grant.plan.categories).includes(existing.parents[0])) throw error('conflict');
        await checked(await google(grant.connection,`${BASE}/files/${id}?fields=id&addParents=${parent}&removeParents=${existing.parents[0]}`,{
          method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})}));
      }
      if (existing.name!==name) await checked(await google(grant.connection,`${BASE}/files/${id}?fields=id`,{
        method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name}) }));
      return;
    }
    const created=await google(grant.connection,`${BASE}/files?fields=id`,{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({id,name,mimeType:'application/vnd.google-apps.folder',
        ...(parent?{parents:[parent]}:{}),appProperties:{[PROPERTY]:marker}})});
    if (created.status===409) { const found=await metadata(grant,id);
      if (!found || found.trashed || found.mimeType!=='application/vnd.google-apps.folder'
        || found.appProperties?.[PROPERTY]!==marker || (parent && !found.parents?.includes(parent))) throw error('conflict');
    } else await checked(created);
  }
  async function authorize(req,body) {
    if (req.headers.origin!==ORIGIN) throw error('connection');
    await drive.requireOwner(req);
    await drive.connection(body.connection);
    if (body.action==='allocate' || body.action==='health') {
      const count=body.action==='health'?1:19;
      const data=await checked(await google(body.connection,`${BASE}/files/generateIds?count=${count}&space=drive&type=files`));
      if (data.ids?.length!==count || data.ids.some(id=>!ID.test(id))) throw error('conflict');
      if(body.action==='health')return {ready:true};
      return {ids:data.ids};
    }
    const plan=validatePlan(body.plan);
    return { grant:await seal({plan,connection:body.connection,owner:req.headers.authorization},'cast-approval-job','24h') };
  }
  async function completedFile(grant,file) {
    const found=await metadata(grant,file.id);
    if (!found) return false;
    if (found.trashed || Number(found.size)!==file.size || found.mimeType!==file.type
      || found.appProperties?.[PROPERTY]!==grant.plan.requestId || !found.parents?.includes(grant.plan.folderId)) throw error('conflict');
    return true;
  }
  async function upload(grant,body) {
    const file=grant.plan.files[body.slot];
    if (!file || !Number.isInteger(body.slot)) throw error('conflict');
    if (await completedFile(grant,file)) return {handle:null,offset:file.size,complete:true};
    let url,handle=body.handle || null;
    if (handle) {
      const value=await unseal(handle,'cast-drive-upload');
      if (value.jobId!==grant.plan.jobId || value.fileId!==file.id) throw error('conflict');
      url=uploadUrl(value.url);
      const probe=await google(grant.connection,url,{method:'PUT',headers:{'Content-Length':'0','Content-Range':`bytes */${file.size}`}});
      if ([200,201].includes(probe.status)) {
        if (!await completedFile(grant,file)) throw error('retry');
        return {handle:null,offset:file.size,complete:true};
      }
      if ([404,410].includes(probe.status)) { url=null; handle=null; }
      else {
        body.offset=confirmedOffset(probe,file.size);
        if(body.offset===file.size) {
          if(!await completedFile(grant,file)) throw error('retry');
          return {handle:null,offset:file.size,complete:true};
        }
      }
    }
    if (!url) {
      const response=await google(grant.connection,'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id',{
        method:'POST',headers:{'Content-Type':'application/json','X-Upload-Content-Type':file.type,'X-Upload-Content-Length':String(file.size)},
        body:JSON.stringify({id:file.id,name:file.name,mimeType:file.type,parents:[grant.plan.folderId],appProperties:{[PROPERTY]:grant.plan.requestId}})});
      if (response.status===409 && await completedFile(grant,file)) return {handle:null,offset:file.size,complete:true};
      if (!response.ok) throw error('retry');
      url=uploadUrl(response.headers.get('location'));
      handle=await seal({jobId:grant.plan.jobId,fileId:file.id,url},'cast-drive-upload','7d');
      // Save the session before transferring any bytes. Uncertain initiations use the same preallocated file ID.
      return {handle,offset:0,complete:false};
    }
    const offset=body.offset;
    if (!Number.isSafeInteger(offset) || offset<0 || offset>=file.size) throw error('conflict');
    const end=Math.min(offset+CHUNK,file.size)-1;
    const response=await fetcher(storageUrl(body.sourceUrl,file),{redirect:'error',signal:AbortSignal.timeout(20000),headers:{Range:`bytes=${offset}-${end}`}});
    if (response.status!==206 || response.headers.get('content-range')!==`bytes ${offset}-${end}/${file.size}`) {
      await response.body?.cancel(); throw error('retry');
    }
    // Read a bounded stream even when a remote Content-Length header is absent or false.
    const reader=response.body?.getReader(); if (!reader) throw error('retry');
    const chunks=[]; let bytes=0;
    for (;;) { const next=await reader.read(); if(next.done) break;
      bytes+=next.value.byteLength; if(bytes>end-offset+1){await reader.cancel();throw error('conflict');} chunks.push(Buffer.from(next.value)); }
    if(bytes!==end-offset+1) throw error('retry');
    const sent=await google(grant.connection,url,{method:'PUT',headers:{'Content-Type':file.type,
      'Content-Length':String(bytes),'Content-Range':`bytes ${offset}-${end}/${file.size}`},body:Buffer.concat(chunks,bytes)});
    if ([200,201].includes(sent.status)) {
      if (!await completedFile(grant,file)) throw error('retry');
      return {handle:null,offset:file.size,complete:true};
    }
    const received=confirmedOffset(sent,file.size);
    if(received<offset || received>end+1) throw error('conflict');
    if(received===file.size) {
      if(!await completedFile(grant,file)) throw error('retry');
      return {handle:null,offset:file.size,complete:true};
    }
    return {handle,offset:received,complete:false};
  }
  async function publish(grant) {
    const user=await session({headers:{authorization:grant.owner}});
    if(user.accessExpires<=Date.now()) throw error('expired');
    const owner=await githubCall('/user',user.accessToken);
    if(!owner.ok || String((await owner.json()).id)!==String(user.sub)) throw error('connection');
    for(let attempt=0;attempt<3;attempt++) {
      const response=await githubCall(`${REPO}/contents/cast-data.js?ref=main`,user.accessToken);
      const current=await checked(response);
      const source=Buffer.from(current.content,'base64').toString('utf8');
      const existing=readCatalog(source).members.find(member=>member.id===grant.plan.profile.id);
      if(existing && rules.publicFields.every(key=>existing[key]===grant.plan.profile[key])) {
        const head=await checked(await githubCall(`${REPO}/git/ref/heads/main`,user.accessToken));
        return {commit:head.object.sha};
      }
      const content=updateCatalog(source,grant.plan.profile);
      const head=await checked(await githubCall(`${REPO}/git/ref/heads/main`,user.accessToken));
      const commit=await checked(await githubCall(`${REPO}/git/commits/${head.object.sha}`,user.accessToken));
      // A concurrent admin commit after the content read must restart from its catalog, never overwrite it.
      const latest=await checked(await githubCall(`${REPO}/contents/cast-data.js?ref=main`,user.accessToken));
      if(latest.sha!==current.sha) continue;
      const version=crypto.createHash('sha256').update(content).digest('hex').slice(0,16);
      const pages=['index.html','cast.html','cast-category.html','cast-men.html','cast-women.html','cast-boys.html',
        'cast-girls.html','cast-senior-men.html','cast-senior-women.html','cast-admin.html'];
      const updates=[{path:'cast-data.js',content}];
      for(const path of pages) {
        const page=await checked(await githubCall(`${REPO}/contents/${path}?ref=${head.object.sha}`,user.accessToken));
        const html=Buffer.from(page.content,'base64').toString('utf8');
        const updated=html.replace(/(<script\b[^>]*\bsrc=(["']))cast-data\.js(?:\?v=[^"'<>\s]*)?\2/g,
          (_,start,quote)=>start+'cast-data.js?v='+version+quote);
        if(updated!==html) updates.push({path,content:updated});
      }
      const entries=[];
      for(const update of updates) {
        const blob=await checked(await githubCall(`${REPO}/git/blobs`,user.accessToken,{method:'POST',
          body:JSON.stringify({encoding:'base64',content:Buffer.from(update.content).toString('base64')})}));
        entries.push({path:update.path,type:'blob',mode:'100644',sha:blob.sha});
      }
      const tree=await checked(await githubCall(`${REPO}/git/trees`,user.accessToken,{method:'POST',
        body:JSON.stringify({base_tree:commit.tree.sha,tree:entries})}));
      const created=await checked(await githubCall(`${REPO}/git/commits`,user.accessToken,{method:'POST',
        body:JSON.stringify({message:'Publish approved cast registration',tree:tree.sha,parents:[head.object.sha]})}));
      const saved=await githubCall(`${REPO}/git/refs/heads/main`,user.accessToken,{method:'PATCH',
        body:JSON.stringify({sha:created.sha,force:false})});
      if([409,422].includes(saved.status)) continue;
      await checked(saved);
      return {commit:created.sha};
    }
    throw error('conflict');
  }
  async function step(body) {
    let grant;
    try { grant=await unseal(body.grant,'cast-approval-job'); } catch { throw error('expired'); }
    validatePlan(grant.plan);
    if(body.action==='folders') {
      await folder(grant,grant.plan.rootId,'الكاست - التسجيلات المعتمدة',null,'root');
      for(const [key,label] of Object.entries(rules.categories)) await folder(grant,grant.plan.categories[key],label,grant.plan.rootId,'category-'+key);
      await folder(grant,grant.plan.folderId,grant.plan.profile.name,grant.plan.categories[grant.plan.profile.category],grant.plan.requestId);
      return {ready:true};
    }
    if(body.action==='upload') return upload(grant,body);
    if(body.action==='share') {
      for(const file of grant.plan.files) if(!await completedFile(grant,file)) throw error('conflict');
      const permissions=await checked(await google(grant.connection,`${BASE}/files/${grant.plan.folderId}/permissions?fields=permissions(id,type,role)`));
      if(!permissions.permissions?.some(p=>p.type==='anyone' && p.role==='reader')) {
        await checked(await google(grant.connection,`${BASE}/files/${grant.plan.folderId}/permissions?fields=id`,{
          method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'anyone',role:'reader',allowFileDiscovery:false})}));
      }
      return {ready:true};
    }
    if(body.action==='publish') return publish(grant);
    if(body.action==='verify') {
      if(!/^[a-f0-9]{40}$/.test(body.commit||'')) throw error('conflict');
      const response=await fetcher(`https://anas3719.github.io/cast/cast-data.js?approved=${body.commit}`,{
        redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Cache-Control':'no-cache'}});
      if(!response.ok) return {live:false};
      const source=await response.text();if(source.length>2000000)throw error('conflict');
      const profile=readCatalog(source).members.find(member=>member.id===grant.plan.profile.id);
      return {live:Boolean(profile && rules.publicFields.every(key=>profile[key]===grant.plan.profile[key]))};
    }
    throw error('conflict');
  }
  return {authorize,step};
}
module.exports={createApprovalService,validatePlan,storageUrl,uploadUrl,confirmedOffset,CHUNK};
