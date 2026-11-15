import test from 'node:test';
import assert from 'node:assert/strict';
import {createProfileEditHandler,normalizeFields} from '../lib/profile-edit-handler.mjs';
const fields={name:'بدرية الزهراني',age:'',height:'',weight:'',nationality:'سعودية',speaking:'متحدثة',note:''};
const origin='https://anas3719.github.io';
function setup(publish = false){
  const rows=[];
  const db={from(){let filters=[],op='read',values,unique=false;
    const q={select(){return q;},eq(k,v){filters.push(r=>r[k]===v);return q;},is(k,v){filters.push(r=>r[k]===v || (v===null && r[k]==null));return q;},gt(k,v){filters.push(r=>r[k]>v);return q;},not(k,_op,v){filters.push(r=>r[k]!==v && r[k]!=null);return q;},order(){return q;},limit(){return q;},maybeSingle(){unique=true;return q;},update(v){op='update';values=v;return q;},insert(v){op='insert';values=v;return q;},then(resolve){let found=rows.filter(r=>filters.every(f=>f(r)));if(op==='insert'){const r={...values,proposal:null,revision:crypto.randomUUID()};rows.push(r);found=[r];}if(op==='update')found.forEach(r=>Object.assign(r,values));return Promise.resolve({data:unique?(found[0]||null):found,error:null}).then(resolve);}};return q;}};
  const handler=createProfileEditHandler({db,fetcher:async(url,init)=>{
    if(url.endsWith('/profile-edit-publish'))return Response.json(publish?{commit:'a'.repeat(40)}:{message:'retry'},{status:publish?200:503});
    return new Response(JSON.stringify({authorized:init.headers.Authorization==='Bearer owner'}),{status:init.headers.Authorization==='Bearer owner'?200:401});
  }});
  const call=async(action,body={},token='owner',o=origin)=>{
    const response=await handler(new Request('https://test.invalid',{method:'POST',headers:{origin:o,authorization:`Bearer ${token}`},body:JSON.stringify({...body,action})}));
    return {status:response.status,body:await response.json()};
  };
  return {rows,call};
}
test('only editable fields allowed, including Arabic numeric input',()=>{
  assert.equal(normalizeFields({...fields,age:'٢٧'}).age,'27');
  for(const k of ['id','category','photoUrl','folderUrl','displayOrder','whatsapp','token_hash'])assert.throws(()=>normalizeFields({...fields,[k]:'x'}));
  for(const v of ['abc','-1','121','2.5'])assert.throws(()=>normalizeFields({...fields,age:v}));
  assert.deepEqual(normalizeFields({name:'مصورة'},true),{name:'مصورة'});
  assert.throws(()=>normalizeFields({...fields},true));
});
test('owner creates one scoped link and anonymous requests cannot create or list',async()=>{
  const {rows,call}=setup();
  assert.equal((await call('create',{profileId:'badrya',fields},'attacker')).status,401);
  assert.equal((await call('list',{},'attacker')).status,401);
  const r=await call('create',{profileId:'badrya',fields});assert.equal(r.status,200);
  const token=r.body.url.split('#')[1];assert.match(token,/^[a-f0-9]{64}$/);assert.notEqual(rows[0].token_hash,token);
  const loaded=await call('load',{},token);assert.deepEqual(loaded.body,{fields,simple:false,pending:false});
  assert.equal((await call('load',{},'a'.repeat(64))).status,401);
  assert.equal((await call('load',{},token,'https://evil.example')).status,403);
});
test('submission cannot change another profile or publish; revocation and expiry fail closed',async()=>{
  const {rows,call}=setup();const r=await call('create',{profileId:'badrya',fields});const token=r.body.url.split('#')[1];
  assert.equal((await call('submit',{profileId:'another',fields:{...fields,age:'27'}},token)).status,503);
  assert.equal(rows.length,1);assert.equal(rows[0].profile_id,'badrya');assert.equal(rows[0].snapshot.age,'');assert.equal(rows[0].proposal.age,'27');
  assert.equal((await call('submit',{fields:{...fields,category:'men'}},token)).status,400);
  await call('revoke',{profileId:'badrya'});assert.equal((await call('load',{},token)).status,401);
  rows[0].revoked_at=null;rows[0].expires_at='2000-01-01';assert.equal((await call('submit',{fields},token)).status,401);
});
test('link rotation preserves pending work, rejects old token; revision conflicts preserve newer request',async()=>{
  const {rows,call}=setup();let r=await call('create',{profileId:'badrya',fields});const old=r.body.url.split('#')[1];
  await call('submit',{fields:{...fields,age:'27'}},old);const revision=rows[0].revision;
  r=await call('create',{profileId:'badrya',fields});const token=r.body.url.split('#')[1];
  assert.equal(rows[0].proposal.age,'27');assert.equal((await call('load',{},old)).status,401);
  await call('submit',{fields:{...fields,age:'28'}},token);
  assert.equal((await call('resolve',{profileId:'badrya',revision,approved:true})).status,409);
  assert.equal(rows[0].proposal.age,'28');
  assert.equal((await call('resolve',{profileId:'badrya',revision:rows[0].revision,approved:true})).status,200);
  assert.equal(rows[0].snapshot.age,'28');assert.equal(rows[0].proposal,null);
});
test('malformed/oversized payloads and invalid actions are rejected',async()=>{
  const {call}=setup();assert.equal((await call('unknown')).status,400);
  assert.equal((await call('create',{profileId:'../other',fields})).status,400);
  assert.equal((await call('create',{profileId:'valid',fields:{...fields,note:'x'.repeat(13000)}})).status,413);
});
test('successful save publishes immediately without owner approval',async()=>{
  const {rows,call}=setup(true);const created=await call('create',{profileId:'badrya',fields});
  const token=created.body.url.split('#')[1];
  const result=await call('submit',{fields:{...fields,age:'27'}},token);
  assert.equal(result.status,200);assert.equal(result.body.saved,true);assert.equal(result.body.commit,'a'.repeat(40));
  assert.equal(rows[0].snapshot.age,'27');assert.equal(rows[0].proposal,null);
});
