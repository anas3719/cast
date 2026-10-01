import {BUCKET,ORIGIN,UUID,TICKET,privateView} from './registration-security.mjs';
const BROKER='https://cast-admin-anas3719.vercel.app/api/registration-approval';
const checked=result=> {if(result.error) throw Object.assign(new Error('Approval database unavailable'),{code:result.error.code==='P0003'?'conflict':'retry'});return result.data;};
async function callBroker(fetcher,body,authorization) {
  const result=await fetcher(BROKER,{method:'POST',redirect:'error',signal:AbortSignal.timeout(115000),
    headers:{'Content-Type':'application/json',...(authorization?{Origin:ORIGIN,Authorization:authorization}:{})},body:JSON.stringify(body)});
  const data=await result.json();
  if(!result.ok) throw Object.assign(new Error('Approval service unavailable'),{code:['connection','expired','conflict','retry'].includes(data.code)?data.code:'retry'});
  return data;
}
const extensions={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/heic':'heic','image/heif':'heif','video/mp4':'mp4','video/quicktime':'mov','video/webm':'webm'};

export async function startApproval({db,rules,record,authorization,fetcher=fetch}) {
  let files=checked(await db.from('cast_registration_files').select('*').eq('registration_id',record.id).order('slot'));
  const view=privateView({...record,status:record.status==='approving'?'pending':record.status},files);
  const ready=rules.reviewReadiness(view); if(!ready.valid) throw Object.assign(new Error(ready.errors.join('؛ ')),{status:400});
  let job;
  if(record.status==='approving') {
    job=checked(await db.from('cast_approval_jobs').select('*').eq('registration_id',record.id).single());
    if(!['needs_grant','needs_owner'].includes(job.status)) return {id:record.id,status:'approving'};
  }
  let integration=checked(await db.from('cast_registration_integrations').select('*').eq('id','google-drive').single());
  if(!job) {
    const allocated=await callBroker(fetcher,{action:'allocate',connection:integration.encrypted_connection},authorization);
    const result=checked(await db.rpc('cast_start_approval',{request_id:record.id,expected_revision:record.revision,allocated_ids:allocated.ids}));
    job=result.job;record=result.record;
    integration=checked(await db.from('cast_registration_integrations').select('*').eq('id','google-drive').single());
    files=checked(await db.from('cast_registration_files').select('*').eq('registration_id',record.id).order('slot'));
  }
  const approved=privateView({...record,status:'approved'},files);
  const profile=rules.publicProfile(approved,{folderUrl:record.works_mode==='drive'?record.supplied_folder_url:
    'https://drive.google.com/drive/folders/'+record.drive_folder_id,photoId:files[0].drive_file_id});
  const plan={jobId:job.id,requestId:record.id,revision:record.revision,rootId:integration.root_folder_id,
    categories:integration.category_folders,folderId:record.drive_folder_id,profile,
    files:files.map(file=>({recordId:file.id,id:file.drive_file_id,path:file.object_path,type:file.mime_type,size:Number(file.declared_size),
      name:(file.slot===0?'صورة البروفايل':'عمل-'+String(file.slot).padStart(2,'0'))+'.'+extensions[file.mime_type]}))};
  const {grant}=await callBroker(fetcher,{action:'authorize',connection:integration.encrypted_connection,plan},authorization);
  checked(await db.rpc('cast_attach_approval_grant',{job_id:job.id,expected_revision:job.revision,sealed_grant:grant}));
  checked(await db.rpc('cast_wake_approval',{job_id:job.id}));
  return {id:record.id,status:'approving'};
}

export function createApprovalWorker({db,fetcher=fetch,waitUntil}) {
  async function run(job) {
    const checkpoint=async (fields={})=>checked(await db.rpc('cast_checkpoint_approval',{
      job_id:job.id,lease_id:job.lease,new_phase:job.phase,...fields}));
    const started=Date.now();
    const sources=new Map();
    try {
      for(let step=0;step<20 && Date.now()-started<90000;step++) {
        if(job.phase===0) {
          await callBroker(fetcher,{action:'folders',grant:job.encrypted_grant});
          job.phase=1;await checkpoint();
        } else if(job.phase===1) {
          const files=checked(await db.from('cast_registration_files').select('*').eq('registration_id',job.registration_id).order('slot'));
          const file=files.find(f=>Number(f.transferred_bytes)<Number(f.declared_size));
          if(!file){job.phase=2;await checkpoint();continue;}
          // Keep the same short-lived private URL within this invocation so ranged reads can reuse the CDN cache.
          let signed=sources.get(file.id);
          if(!signed) {signed=checked(await db.storage.from(BUCKET).createSignedUrl(file.object_path,120));sources.set(file.id,signed);}
          const result=await callBroker(fetcher,{action:'upload',grant:job.encrypted_grant,slot:file.slot,
            handle:file.drive_upload_url,offset:Number(file.transferred_bytes),sourceUrl:signed.signedUrl});
          if(!Number.isSafeInteger(result.offset) || result.offset<0 || result.offset>Number(file.declared_size)) throw Object.assign(new Error('Invalid offset'),{code:'conflict'});
          await checkpoint({file_id:file.id,upload_handle:result.handle,transferred:result.offset});
        } else if(job.phase===2) {
          await callBroker(fetcher,{action:'share',grant:job.encrypted_grant});job.phase=3;await checkpoint();
        } else if(job.phase===3) {
          const result=await callBroker(fetcher,{action:'publish',grant:job.encrypted_grant});
          job.phase=4;job.commit_sha=result.commit;await checkpoint({commit_id:result.commit});
        } else if(job.phase===4) {
          const result=await callBroker(fetcher,{action:'verify',grant:job.encrypted_grant,commit:job.commit_sha});
          if(!result.live) break;
          job.phase=5;await checkpoint({commit_id:job.commit_sha});return;
        } else return;
      }
      checked(await db.rpc('cast_release_approval',{job_id:job.id,lease_id:job.lease}));
    } catch(e) {
      const code=['connection','expired','conflict','retry'].includes(e.code)?e.code:'retry';
      // No signed URL, contact, grant or raw provider error is logged.
      try {await checkpoint({failure:code,...(job.commit_sha?{commit_id:job.commit_sha}:{})});}
      catch { /* An expired/replaced lease must not overwrite the newer worker. */ }
    }
  }
  return async req=> {
    const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
    if(req.method!=='POST') return reply(405,{accepted:false});
    try {
      const reader=req.body?.getReader();if(!reader)return reply(400,{accepted:false});
      let size=0;const chunks=[];
      for(;;){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;
        if(size>1024){await reader.cancel();return reply(413,{accepted:false});}chunks.push(next.value);}
      const bytes=new Uint8Array(size);let position=0;for(const chunk of chunks){bytes.set(chunk,position);position+=chunk.length;}
      const body=JSON.parse(new TextDecoder().decode(bytes));
      if(!UUID.test(body?.jobId||'')||!TICKET.test(body?.ticket||'')) return reply(401,{accepted:false});
      const job=checked(await db.rpc('cast_claim_approval',{job_id:body.jobId,ticket:body.ticket}));
      if(!job?.id) return reply(202,{accepted:false});
      waitUntil(run(job));return reply(202,{accepted:true});
    } catch {return reply(503,{accepted:false});}
  };
}
