import {UUID,TICKET} from './registration-security.mjs';
const MAX_CHUNK=8*1024*1024;
export function createRegistrationChunk({db,readRange,now=()=>Date.now()}) {
  return async req=>{
    const failure=status=>new Response(null,{status,headers:{'Cache-Control':'no-store'}});
    if(req.method!=='POST')return failure(405);
    try {
      const reader=req.body?.getReader();if(!reader)return failure(400);
      const chunks=[];let size=0;
      for(;;){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;
        if(size>1024){await reader.cancel();return failure(413);}chunks.push(next.value);}
      const bytes=new Uint8Array(size);let position=0;
      for(const chunk of chunks){bytes.set(chunk,position);position+=chunk.length;}
      const body=JSON.parse(new TextDecoder().decode(bytes));
      if(!body || Object.keys(body).some(k=>!['jobId','ticket','lease','fileId','offset','end'].includes(k))
        || !UUID.test(body.jobId||'') || !UUID.test(body.lease||'') || !UUID.test(body.fileId||'')
        || !TICKET.test(body.ticket||''))return failure(401);
      if(!Number.isSafeInteger(body.offset) || !Number.isSafeInteger(body.end) || body.offset<0
        || body.end<body.offset || body.end-body.offset+1>MAX_CHUNK)return failure(400);
      const job=await db.from('cast_approval_jobs').select('registration_id,revision')
        .eq('id',body.jobId).eq('tick_token',body.ticket).eq('lease',body.lease)
        .eq('status','running').eq('phase',1).gt('lease_until',new Date(now()).toISOString()).maybeSingle();
      if(job.error || !job.data)return failure(401);
      const record=await db.from('cast_registrations').select('id').eq('id',job.data.registration_id)
        .eq('status','approving').eq('revision',job.data.revision).maybeSingle();
      if(record.error || !record.data)return failure(401);
      const file=await db.from('cast_registration_files').select('object_path,declared_size,verified_at')
        .eq('id',body.fileId).eq('registration_id',job.data.registration_id).maybeSingle();
      if(file.error || !file.data?.verified_at || body.end>=Number(file.data.declared_size)
        || !new RegExp('^'+job.data.registration_id+'/\\d{1,2}/[a-f0-9-]{36}$').test(file.data.object_path))return failure(400);
      const result=await readRange(file.data.object_path,body.offset,body.end);
      const range=`bytes ${body.offset}-${body.end}/${file.data.declared_size}`;
      if(result.status!==206 || result.headers.get('content-range')!==range){
        await result.body?.cancel();console.warn('cast-source-chunk',{status:result.status,exactRange:false});return failure(503);
      }
      return new Response(result.body,{status:206,headers:{'Content-Type':'application/octet-stream',
        'Content-Range':range,'Content-Length':String(body.end-body.offset+1),'Cache-Control':'no-store'}});
    }catch(error) {
      console.warn('cast-source-chunk',{failed:true,reason:['TimeoutError','AbortError','TypeError','StorageCredentialsUnavailable'].includes(error?.name)?error.name:'Error'});
      return failure(503);
    }
  };
}
