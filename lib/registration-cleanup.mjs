import {BUCKET,TICKET} from './registration-security.mjs';

const checked=result=>{if(result.error)throw new Error('Cleanup unavailable');return result.data;};

export function createRegistrationCleanup({db,waitUntil}) {
  async function run(lease) {
    let removed=0;
    try {
      const records=checked(await db.rpc('cast_cleanup_candidates',{lease_id:lease}));
      for(const record of records || []) {
        const files=checked(await db.from('cast_registration_files').select('object_path').eq('registration_id',record.id));
        const paths=files.map(file=>file.object_path);
        if(paths.length)checked(await db.storage.from(BUCKET).remove(paths));
        // The database rechecks expiry and missing objects before releasing capacity.
        checked(await db.rpc('cast_finish_expired_registration',{lease_id:lease,request_id:record.id}));
        removed++;
      }
      console.info('cast-registration-cleanup',{removed});
    } catch {
      console.warn('cast-registration-cleanup',{code:'retry',removed});
    } finally {
      await db.rpc('cast_release_cleanup',{lease_id:lease});
    }
  }
  return async req=>{
    const reply=(status,accepted)=>new Response(JSON.stringify({accepted}),{
      status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
    if(req.method!=='POST')return reply(405,false);
    try {
      const reader=req.body?.getReader();
      if(!reader)return reply(400,false);
      let size=0;
      const parts=[];
      for(;;){const part=await reader.read();if(part.done)break;
        size+=part.value.byteLength;
        if(size>1024){await reader.cancel();return reply(413,false);}
        parts.push(part.value);
      }
      const bytes=new Uint8Array(size);
      let position=0;
      for(const part of parts){bytes.set(part,position);position+=part.length;}
      const body=JSON.parse(new TextDecoder().decode(bytes));
      if(!TICKET.test(body?.ticket || ''))return reply(401,false);
      const lease=checked(await db.rpc('cast_claim_cleanup',{ticket:body.ticket}));
      if(!lease)return reply(401,false);
      waitUntil(run(lease));
      return reply(202,true);
    } catch {return reply(503,false);}
  };
}
