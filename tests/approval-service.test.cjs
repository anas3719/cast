const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {randomBytes}=require('node:crypto');
const {seal,unseal,OWNER_ID}=require('../lib/admin-auth.cjs');
const {protect}=require('../lib/drive-auth.cjs');
const {createApprovalService,validatePlan,storageUrl,uploadUrl,confirmedOffset,CHUNK}=require('../lib/approval-service.cjs');
const {readCatalog,updateCatalog}=require('../lib/cast-catalog.cjs');
process.env.SESSION_KEY=randomBytes(32).toString('base64');
process.env.GOOGLE_CAST_CLIENT_ID='synthetic-client';
const requestId='11111111-1111-4111-8111-111111111111';
const jobId='22222222-2222-4222-8222-222222222222';
const fileId='synthetic-file-0001';
const commit='a'.repeat(40);
function plan() {
  return {jobId,requestId,revision:2,rootId:'synthetic-root-0001',folderId:'synthetic-folder-0001',
    categories:Object.fromEntries(['men','women','boys','girls','seniorMen','seniorWomen'].map(key=>[key,'synthetic-category-'+key])),
    files:[{recordId:'33333333-3333-4333-8333-333333333333',id:fileId,path:requestId+'/0/44444444-4444-4444-8444-444444444444',
      name:'صورة البروفايل.jpg',type:'image/jpeg',size:CHUNK+7}],
    profile:{id:'registration-'+requestId,name:'Synthetic Test',category:'men',folderUrl:'https://drive.google.com/drive/folders/synthetic-existing-folder',
      photoUrl:`https://drive.google.com/thumbnail?id=${fileId}&sz=w1000`,imageTitle:'صورة البروفايل',age:'25',height:'170',weight:'70',nationality:'',speaking:'متحدث'}};
}
async function grant(value=plan()) {
  return seal({plan:value,connection:await protect({scope:'https://www.googleapis.com/auth/drive.file',access_token:'private-access',refresh_token:'private-refresh-token'}),
    owner:'Bearer '+await seal({sub:OWNER_ID,accessToken:'private-github-token',accessExpires:Date.now()+3600000},'cast-session')},'cast-approval-job','24h');
}
const makeClient=()=>({setCredentials(){},getAccessToken:async()=>({token:'synthetic-only'})});

test('catalog parser rejects execution, duplicate keys and prototype pollution without eval',()=>{
  assert.ok(readCatalog(fs.readFileSync('cast-data.js','utf8')).members.length>0);
  for(const source of ['window.castMembers=alert(1);','window.castMembers=[{id:"x",photoUrl:fetch("x")}];',
    'window.castMembers=[{id:"x",__proto__:{}}];','window.castMembers=[{id:"x",id:"y"}];','window.castMembers=[];alert(1);'])assert.throws(()=>readCatalog(source));
});
test('new profiles follow permanent first profiles, preserve other fields, edits do not reorder',()=>{
  const source='window.castMembers = '+JSON.stringify([{id:'old',category:'men',name:'Existing',displayOrder:2,note:'keep'},
    {id:'anas-omar',category:'men',displayOrder:1},{id:'walaa',category:'women',displayOrder:1}])+';';
  const updated=readCatalog(updateCatalog(source,plan().profile)).members;
  assert.equal(updated.find(x=>x.id==='anas-omar').displayOrder,1);
  assert.equal(updated.find(x=>x.id===plan().profile.id).displayOrder,2);
  assert.equal(updated.find(x=>x.id==='old').displayOrder,3);
  assert.equal(updated.find(x=>x.id==='old').note,'keep');
  const edited=readCatalog(updateCatalog(updateCatalog(source,plan().profile),{...plan().profile,name:'Edited'})).members;
  assert.equal(edited.find(x=>x.name==='Edited').displayOrder,2);
  assert.throws(()=>updateCatalog(source,{...plan().profile,whatsapp:'+966500000000'}));
});
test('grant manifests and transport reject private fields, oversized files and SSRF',()=>{
  assert.equal(validatePlan(plan()).jobId,jobId);
  assert.throws(()=>validatePlan({...plan(),profile:{...plan().profile,whatsapp:'private'}}));
  const large=plan();large.files[0].size=2147483649;assert.throws(()=>validatePlan(large));
  const file=plan().files[0];
  for(const url of ['http://localhost/','https://evil.example/a','https://vmnkdbceyqudcxddvljx.supabase.co/storage/v1/object/sign/other/'+file.path+'?token=x'])assert.throws(()=>storageUrl(url,file));
  assert.equal(storageUrl('https://vmnkdbceyqudcxddvljx.supabase.co/storage/v1/object/sign/cast-registration-private/'+file.path+'?token=x',file).includes(file.path),true);
  assert.throws(()=>uploadUrl('https://evil.example/upload'));
  assert.equal(confirmedOffset(new Response(null,{status:308,headers:{range:'bytes=0-7'}}),20),8);
  assert.throws(()=>confirmedOffset(new Response(null,{status:308,headers:{range:'bytes=0-20'}}),20));
});
test('upload session is persisted before bytes and is purpose-bound/encrypted',async()=>{
  let calls=0;
  const service=createApprovalService({makeClient,fetcher:async(url,options)=>{
    calls++;if(url.includes('/drive/v3/files/'+fileId+'?'))return new Response(null,{status:404});
    assert.equal(options.method,'POST');return new Response(null,{status:200,headers:{location:'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=private-session'}});
  }});
  const result=await service.step({action:'upload',grant:await grant(),slot:0});
  assert.equal(calls,2);assert.equal(result.offset,0);assert.equal(result.complete,false);
  assert.ok(!result.handle.includes('private-session'));
  const handle=await unseal(result.handle,'cast-drive-upload');assert.equal(handle.fileId,fileId);
  await assert.rejects(unseal(result.handle,'cast-session'));
});
test('resume probes server offset and bounds chunk length instead of trusting stale client offset',async()=>{
  const value=plan();value.files[0].size=CHUNK+7;
  const handle=await seal({jobId,fileId,url:'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=private'},'cast-drive-upload','7d');
  let sent=0;
  const service=createApprovalService({makeClient,fetcher:async(url,options)=>{
    if(url.startsWith('https://www.googleapis.com/')) assert.equal(options.redirect,'manual');
    if(url.includes('/drive/v3/files/'+fileId+'?'))return sent?Response.json({id:fileId,size:CHUNK+7,mimeType:'image/jpeg',
      parents:[value.folderId],appProperties:{anasCastRegistration:requestId}}):new Response(null,{status:404});
    if(url.includes('.supabase.co/')){
      assert.equal(options.headers.Range,`bytes=${CHUNK}-${CHUNK+6}`);
      return new Response(new Uint8Array(7),{status:206,headers:{'content-range':`bytes ${CHUNK}-${CHUNK+6}/${CHUNK+7}`}});
    }
    if(options.headers['Content-Length']==='0')return new Response(null,{status:308,headers:{range:`bytes=0-${CHUNK-1}`}});
    sent++;assert.equal(options.body.byteLength,7);return new Response(null,{status:308,headers:{range:`bytes=0-${CHUNK+6}`}});
  }});
  const result=await service.step({action:'upload',grant:await grant(value),slot:0,handle,offset:0,
    sourceUrl:'https://vmnkdbceyqudcxddvljx.supabase.co/storage/v1/object/sign/cast-registration-private/'+value.files[0].path+'?token=synthetic'});
  assert.equal(sent,1);assert.equal(result.offset,CHUNK+7);
  assert.equal(result.complete,true);
});
test('GitHub idempotence reconciles a lost publish receipt without another commit',async()=>{
  let writes=0;
  const service=createApprovalService({githubCall:async(path,token,options={})=>{
    if(options.method)writes++;
    if(path==='/user')return Response.json({id:OWNER_ID});
    if(path.includes('/contents/'))return Response.json({content:Buffer.from('window.castMembers='+JSON.stringify([plan().profile])+';').toString('base64')});
    return Response.json({object:{sha:commit}});
  }});
  assert.deepEqual(await service.step({action:'publish',grant:await grant()}),{commit});assert.equal(writes,0);
});

test('transfer timeouts identify only the safe provider stage and retain resumable state',async()=>{
  const value=plan();
  const handle=await seal({jobId,fileId,url:'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=private'},'cast-drive-upload','7d');
  for(const stage of ['source-range','source-read','drive-upload']) {
    const service=createApprovalService({makeClient,fetcher:async(url,options)=>{
      if(url.includes('/drive/v3/files/'+fileId+'?'))return new Response(null,{status:404});
      if(options.headers['Content-Length']==='0')return new Response(null,{status:308});
      if(url.includes('.supabase.co/')) {
        if(stage==='source-range')throw new DOMException('private transport detail','TimeoutError');
        const body=stage==='source-read'?new ReadableStream({pull(controller){controller.error(new DOMException('private transport detail','TimeoutError'));}}):new Uint8Array(CHUNK);
        return new Response(body,{status:206,headers:{'content-range':`bytes 0-${CHUNK-1}/${value.files[0].size}`}});
      }
      throw new DOMException('private transport detail','TimeoutError');
    }});
    await assert.rejects(service.step({action:'upload',grant:await grant(value),slot:0,handle,offset:0,
      sourceUrl:'https://vmnkdbceyqudcxddvljx.supabase.co/storage/v1/object/sign/cast-registration-private/'+value.files[0].path+'?token=synthetic'}),failure=>failure.stage===stage && failure.name==='TimeoutError');
  }
});
test('all bytes acknowledged without finalized Drive metadata cannot advance the transfer',async()=>{
  const value=plan();value.files[0].size=7;
  const handle=await seal({jobId,fileId,url:'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=private'},'cast-drive-upload','7d');
  let sourceReads=0;
  const service=createApprovalService({makeClient,fetcher:async(url)=>{
    if(url.includes('/drive/v3/files/'+fileId+'?'))return new Response(null,{status:404});
    if(url.includes('.supabase.co/'))sourceReads++;
    return new Response(null,{status:308,headers:{range:'bytes=0-6'}});
  }});
  await assert.rejects(service.step({action:'upload',grant:await grant(value),slot:0,handle,offset:0}),error=>error.code==='retry');
  assert.equal(sourceReads,0);
});
test('publication updates catalog and HTML cache versions atomically and retries concurrent commits',async()=>{
  let attempts=0;const blobs=new Map();let tree;
  const concurrent={id:'concurrent-owner-profile',name:'Keep owner edit',category:'women',note:'Private-independent-public-note'};
  const service=createApprovalService({githubCall:async(path,token,options={})=>{
    if(path==='/user')return Response.json({id:OWNER_ID});
    if(path.includes('/contents/cast-data.js'))return Response.json({sha:'source-'+attempts,
      content:Buffer.from('window.castMembers='+JSON.stringify(attempts?[concurrent]:[])+';').toString('base64')});
    if(path.includes('/contents/'))return Response.json({content:Buffer.from('<script src="cast-data.js?v=old"></script>').toString('base64')});
    if(path.endsWith('/git/ref/heads/main'))return Response.json({object:{sha:String(attempts).repeat(40)}});
    if(path.includes('/git/commits/') && !options.method)return Response.json({tree:{sha:'base-'+attempts}});
    const body=JSON.parse(options.body);
    if(path.endsWith('/git/blobs')){const sha='blob-'+blobs.size;blobs.set(sha,Buffer.from(body.content,'base64').toString('utf8'));return Response.json({sha});}
    if(path.endsWith('/git/trees')){tree=body;return Response.json({sha:'tree-'+attempts});}
    if(path.endsWith('/git/commits'))return Response.json({sha:commit});
    if(path.endsWith('/git/refs/heads/main')){assert.equal(body.force,false);return ++attempts===1?Response.json({}, {status:409}):Response.json({object:{sha:commit}});}
    throw new Error('Unexpected route');
  }});
  assert.deepEqual(await service.step({action:'publish',grant:await grant()}),{commit});
  assert.equal(attempts,2);assert.equal(tree.base_tree,'base-1');assert.equal(tree.tree.length,11);
  const published=blobs.get(tree.tree.find(x=>x.path==='cast-data.js').sha);
  assert.ok(readCatalog(published).members.some(x=>x.id===concurrent.id && x.note===concurrent.note));
  assert.ok(!published.includes('whatsapp') && !published.includes('+966'));
  const versions=tree.tree.filter(x=>x.path.endsWith('.html')).map(x=>/cast-data.js\?v=([a-f0-9]{16})/.exec(blobs.get(x.sha))?.[1]);
  assert.ok(versions.every(Boolean));assert.equal(new Set(versions).size,1);
});
test('approval is not live until deployed public fields match; no contact is fetched',async()=>{
  let deployed=false;
  const service=createApprovalService({fetcher:async url=>{
    assert.ok(url.startsWith('https://anas3719.github.io/cast/cast-data.js?approved='));
    return new Response('window.castMembers='+JSON.stringify(deployed?[plan().profile]:[])+';');
  }});
  const body={action:'verify',grant:await grant(),commit};
  assert.deepEqual(await service.step(body),{live:false});deployed=true;
  assert.deepEqual(await service.step(body),{live:true});
  await assert.rejects(service.step({...body,grant:'invalid'}));
});
test('worker rejects wrong capability and stores commit through unknown checkpoint acknowledgements',async()=>{
  const {createApprovalWorker}=await import('../lib/registration-approval.mjs');
  const calls=[];let pending;
  const worker=createApprovalWorker({db:{rpc:async(name,args)=>{
    calls.push({name,args});
    if(name==='cast_claim_approval')return {data:args.ticket==='a'.repeat(64)?{id:jobId,registration_id:requestId,lease:jobId,phase:3,encrypted_grant:'sealed'}:null};
    if(name==='cast_checkpoint_approval' && !args.failure)return {error:{code:'NETWORK'}};
    return {data:null};
  }},waitUntil:promise=>{pending=promise;},fetcher:async()=>Response.json({commit})});
  const request=ticket=>new Request('https://example.com',{method:'POST',body:JSON.stringify({jobId,ticket})});
  assert.equal((await (await worker(request('b'.repeat(64)))).json()).accepted,false);
  assert.equal((await (await worker(request('a'.repeat(64)))).json()).accepted,true);
  await pending;
  const recovery=calls.find(x=>x.args.failure);
  assert.equal(recovery.args.commit_id,commit);assert.equal(recovery.args.new_phase,4);
});
