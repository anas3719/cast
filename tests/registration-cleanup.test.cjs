const test=require('node:test');
const assert=require('node:assert/strict');
const ticket='a'.repeat(64);
const lease='11111111-1111-4111-8111-111111111111';
const request=body=>new Request('https://example.com',{method:'POST',body:JSON.stringify(body)});

test('cleanup rejects unknown capabilities and bounds request bytes before any database access',async()=>{
  const {createRegistrationCleanup}=await import('../lib/registration-cleanup.mjs');
  let calls=0;
  const cleanup=createRegistrationCleanup({db:{rpc:async()=>{calls++;return {data:null};}},waitUntil:()=>assert.fail()});
  assert.equal((await cleanup(request({ticket:'invalid'}))).status,401);
  assert.equal((await cleanup(request({ticket,junk:'x'.repeat(1024)}))).status,413);
  assert.equal(calls,0);
  assert.equal((await cleanup(request({ticket}))).status,401);
});

test('cleanup removes provider objects before records and always releases its lease',async()=>{
  const {createRegistrationCleanup}=await import('../lib/registration-cleanup.mjs');
  const actions=[];let work;
  const db={rpc:async(name)=>{
    actions.push(name);
    return {data:name==='cast_claim_cleanup'?lease:name==='cast_cleanup_candidates'?[{id:lease}]:null};
  },from:()=>({select:()=>({eq:async()=>({data:[{object_path:lease+'/0/synthetic'}]})})}),
  storage:{from:bucket=>{assert.equal(bucket,'cast-registration-private');return {remove:async paths=>{
    assert.deepEqual(paths,[lease+'/0/synthetic']);actions.push('storage-remove');return {data:[]};
  }};}}};
  const cleanup=createRegistrationCleanup({db,waitUntil:promise=>{work=promise;}});
  assert.equal((await cleanup(request({ticket}))).status,202);await work;
  assert.deepEqual(actions,['cast_claim_cleanup','cast_cleanup_candidates','storage-remove',
    'cast_finish_expired_registration','cast_release_cleanup']);
});

test('storage failure retains metadata and capacity for a later cleanup retry',async()=>{
  const {createRegistrationCleanup}=await import('../lib/registration-cleanup.mjs');
  const calls=[];let work;
  const db={rpc:async name=>{calls.push(name);return {data:name==='cast_claim_cleanup'?lease:[{id:lease}]};},
    from:()=>({select:()=>({eq:async()=>({data:[{object_path:lease+'/0/synthetic'}]})})}),
    storage:{from:()=>({remove:async()=>({error:{message:'synthetic failure'}})})}};
  const cleanup=createRegistrationCleanup({db,waitUntil:promise=>{work=promise;}});
  await cleanup(request({ticket}));await work;
  assert.ok(!calls.includes('cast_finish_expired_registration'));
  assert.equal(calls.at(-1),'cast_release_cleanup');
});
