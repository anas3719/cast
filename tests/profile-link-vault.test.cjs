const test=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes}=require('node:crypto');
process.env.SESSION_KEY=randomBytes(32).toString('base64');
const {seal,unseal,OWNER_ID,ORIGIN}=require('../lib/admin-auth.cjs');
const handler=require('../api/profile-edit-link.js');
const token='b'.repeat(64);
async function call(body,authorization){
  const res={setHeader(){},end(value){this.body=JSON.parse(value);}};
  await handler({method:'POST',headers:{origin:ORIGIN,authorization},body},res);return res;
}
test('wrapping requires a live capability for the exact profile and returns encrypted data only',async()=>{
  assert.equal((await call({action:'wrap',profileId:'badrya'},'Bearer invalid')).statusCode,401);
  const original=global.fetch;
  try{
    global.fetch=async()=>Response.json({profileId:'other'});
    assert.equal((await call({action:'wrap',profileId:'badrya'},'Bearer '+token)).statusCode,401);
    global.fetch=async()=>Response.json({profileId:'badrya'});
    const result=await call({action:'wrap',profileId:'badrya'},'Bearer '+token);
    assert.equal(result.statusCode,200);assert.deepEqual(Object.keys(result.body),['encrypted']);
    assert(!result.body.encrypted.includes(token));
    const decoded=await unseal(result.body.encrypted,'cast-profile-link');assert.equal(decoded.token,token);assert.equal(decoded.profileId,'badrya');
  }finally{global.fetch=original;}
});
test('only a valid owner session can recover a stored link; profile and purpose are bound',async()=>{
  const encrypted=await seal({token,profileId:'badrya'},'cast-profile-link','36500d');
  const body={action:'unwrap',profileId:'badrya',encrypted};
  assert.notEqual((await call(body,'Bearer '+token)).statusCode,200);
  const owner=await seal({sub:OWNER_ID,accessToken:'synthetic',accessExpires:Date.now()+60000},'cast-session');
  assert.equal((await call({...body,profileId:'other'},'Bearer '+owner)).statusCode,403);
  assert.deepEqual((await call(body,'Bearer '+owner)).body,{token});
  const wrong=await seal({token,profileId:'badrya'},'wrong-purpose');
  assert.notEqual((await call({...body,encrypted:wrong},'Bearer '+owner)).statusCode,200);
});
