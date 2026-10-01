const test=require('node:test');
const assert=require('node:assert/strict');
const jobId='11111111-1111-4111-8111-111111111111';
const requestId='22222222-2222-4222-8222-222222222222';
const fileId='33333333-3333-4333-8333-333333333333';
const lease='44444444-4444-4444-8444-444444444444';
const now=()=>Date.parse('2026-10-01T00:00:00Z');
const body=()=>({jobId,ticket:'a'.repeat(64),lease,fileId,offset:4,end:10});
const request=value=>new Request('https://example.com',{method:'POST',body:JSON.stringify(value)});
function database(change={}) {
  const rows={cast_approval_jobs:{id:jobId,tick_token:'a'.repeat(64),lease,status:'running',phase:1,
    lease_until:'2026-10-01T00:05:00Z',revision:2,registration_id:requestId},
    cast_registrations:{id:requestId,status:'approving',revision:2},
    cast_registration_files:{id:fileId,registration_id:requestId,verified_at:'2026-10-01T00:00:00Z',
      declared_size:20,object_path:requestId+'/1/'+fileId}};
  for(const [table,fields] of Object.entries(change))Object.assign(rows[table],fields);
  return {from:table=>{const filters=[];const query={select:()=>query,
    eq:(key,value)=>{filters.push(row=>row[key]===value);return query;},
    gt:(key,value)=>{filters.push(row=>row[key]>value);return query;},
    maybeSingle:async()=>({data:filters.every(check=>check(rows[table]))?rows[table]:null})};return query;}};
}
test('private chunk rejects wrong capabilities, stale leases, revisions and unverified files before storage access',async()=>{
  const {createRegistrationChunk}=await import('../lib/registration-chunk.mjs');
  let reads=0;
  const options={now,readRange:async()=>{reads++;throw new Error('Must not read');}};
  for(const [change,input] of [
    [{},{...body(),ticket:'b'.repeat(64)}],
    [{},{...body(),lease:fileId}],
    [{cast_approval_jobs:{lease_until:'2026-09-30T00:00:00Z'}},body()],
    [{cast_approval_jobs:{status:'queued'}},body()],
    [{cast_approval_jobs:{phase:2}},body()],
    [{cast_registrations:{revision:3}},body()],
    [{cast_registrations:{status:'approved'}},body()],
    [{cast_registration_files:{verified_at:null}},body()],
    [{cast_registration_files:{registration_id:jobId}},body()],
    [{cast_registration_files:{object_path:'other-bucket/path'}},body()]
  ]){const result=await createRegistrationChunk({...options,db:database(change)})(request(input));assert.ok([400,401].includes(result.status));}
  assert.equal(reads,0);
});
test('private chunk bounds the body and range and ignores no client destination overrides',async()=>{
  const {createRegistrationChunk}=await import('../lib/registration-chunk.mjs');
  const handler=createRegistrationChunk({db:database(),now,readRange:()=>assert.fail()});
  assert.equal((await handler(request({...body(),extra:'x'.repeat(1024)}))).status,413);
  assert.equal((await handler(request({...body(),sourceUrl:'https://evil.example'}))).status,401);
  for(const input of [{...body(),offset:-1},{...body(),end:20},{...body(),end:8*1024*1024+4}])
    assert.equal((await handler(request(input))).status,400);
});
test('private chunk performs exact authenticated origin range reads and returns no credentials',async()=>{
  const {createRegistrationChunk}=await import('../lib/registration-chunk.mjs');
  const handler=createRegistrationChunk({db:database(),now,readRange:async(path,offset,end)=>{
    assert.equal(path,requestId+'/1/'+fileId);assert.equal(offset,4);assert.equal(end,10);
    return new Response(new Uint8Array(7),{status:206,headers:{'Content-Range':'bytes 4-10/20'}});
  }});
  const result=await handler(request(body()));assert.equal(result.status,206);
  assert.equal(result.headers.get('Cache-Control'),'no-store');assert.equal(result.headers.get('Authorization'),null);
  assert.equal(result.headers.get('Content-Length'),'7');assert.equal((await result.arrayBuffer()).byteLength,7);
});
test('private chunk rejects providers that ignore or change the requested range',async()=>{
  const {createRegistrationChunk}=await import('../lib/registration-chunk.mjs');
  for(const [status,range] of [[200,null],[206,'bytes 0-6/20']]){
    const handler=createRegistrationChunk({db:database(),now,
      readRange:async()=>new Response(new Uint8Array(7),{status,headers:range?{'Content-Range':range}:{}})});
    assert.equal((await handler(request(body()))).status,503);
  }
});
