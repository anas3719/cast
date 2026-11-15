const test=require('node:test');
const assert=require('node:assert/strict');
const {generateKeyPairSync}=require('node:crypto');
const {createProfilePublisher}=require('../lib/profile-publisher.cjs');
const privateKey=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'});
const baseline={name:'شخص اختباري',age:'',height:'',weight:'',nationality:'',speaking:'',note:''};
function setup({conflict=false,revoked=false,retry=false}={}){
  const original={id:'test-only',category:'women',...baseline,photoUrl:'unchanged-photo',folderUrl:'unchanged-folder',displayOrder:4};
  const saved=[],calls=[];let patches=0;
  const fetcher=async(url,options)=>{
    calls.push(url);
    if(url.includes('supabase.co'))return Response.json({profileId:'test-only',fields:{...baseline,age:'27'},baseline,simple:false,revision:'rev-1'},{status:revoked?401:200});
    const path=url.replace('https://api.github.com','');
    if(path.endsWith('/installation'))return Response.json({id:123});
    if(path==='/app/installations/123/access_tokens'){
      assert.deepEqual(JSON.parse(options.body),{repositories:['cast'],permissions:{contents:'write'}});
      return Response.json({token:'installation-only'});
    }
    assert.equal(options.headers.Authorization,'Bearer installation-only');
    if(path.endsWith('/git/ref/heads/main'))return Response.json({object:{sha:'a'.repeat(40)}});
    if(path.includes('/git/commits/')&&options.method!=='POST')return Response.json({tree:{sha:'b'.repeat(40)}});
    if(path.includes('/contents/')){
      const source=path.includes('/cast-data.js?')?'window.castMembers = '+JSON.stringify([{...original,...(conflict?{age:'30'}:{})},{id:'other',name:'unchanged'}])+';':'<script src="cast-data.js?v=old"></script>';
      return Response.json({content:Buffer.from(source).toString('base64')});
    }
    if(path.endsWith('/git/blobs')){saved.push(Buffer.from(JSON.parse(options.body).content,'base64').toString());return Response.json({sha:'c'.repeat(40)});}
    if(path.endsWith('/git/trees'))return Response.json({sha:'d'.repeat(40)});
    if(path.endsWith('/git/commits'))return Response.json({sha:'e'.repeat(40)});
    if(path.endsWith('/git/refs/heads/main')){assert.equal(JSON.parse(options.body).force,false);patches++;return Response.json({}, {status:retry&&patches===1?422:200});}
    throw Error(path);
  };
  return {publisher:createProfilePublisher({fetcher,env:{GITHUB_CLIENT_ID:'synthetic-app',GITHUB_APP_PRIVATE_KEY:privateKey}}),saved,calls,original};
}
test('automatic publication changes only scoped fields and cache versions using a repo-restricted installation',async()=>{
  const {publisher,saved,original}=setup();assert.equal((await publisher.publish('a'.repeat(64))).commit,'e'.repeat(40));
  const parsed=require('../lib/cast-catalog.cjs').readCatalog(saved[0]).members;
  assert.deepEqual(parsed,[{...original,age:'27'},{id:'other',name:'unchanged'}]);
  assert(saved.slice(1).every(s=>/cast-data.js\?v=[a-f0-9]{16}/.test(s)));
});
test('revoked capabilities cannot reach GitHub; intervening owner edits fail without writes',async()=>{
  const a=setup({revoked:true});await assert.rejects(a.publisher.publish('a'.repeat(64)),{status:401});assert.equal(a.calls.length,1);
  const b=setup({conflict:true});await assert.rejects(b.publisher.publish('a'.repeat(64)),{status:409});assert.equal(b.saved.length,0);
});
test('concurrent Git commit is retried without force pushes',async()=>{
  const {publisher}=setup({retry:true});assert.equal((await publisher.publish('a'.repeat(64))).commit,'e'.repeat(40));
});
