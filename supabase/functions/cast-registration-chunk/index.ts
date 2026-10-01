import {createClient} from 'npm:@supabase/supabase-js@2.117.2';
import {S3Client,GetObjectCommand} from 'npm:@aws-sdk/client-s3@3.1144.0';
import {FetchHttpHandler} from 'npm:@smithy/fetch-http-handler@5.8.0';
import {createRegistrationChunk} from '../../../lib/registration-chunk.mjs';
import {PROJECT,BUCKET} from '../../../lib/registration-security.mjs';
const url=Deno.env.get('SUPABASE_URL');
if(url!=='https://vmnkdbceyqudcxddvljx.supabase.co')throw new Error('Wrong project');
const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
// S3 signs with the project's configured legacy anon key, not a regenerated JWT.
const anon=Deno.env.get('CAST_S3_ANON_SIGNING_KEY')||'';
const session=Deno.env.get('CAST_S3_SERVICE_SESSION')||'';
const s3=new S3Client({endpoint:`https://${PROJECT}.storage.supabase.co/storage/v1/s3`,
  forcePathStyle:true,region:'ap-south-1',maxAttempts:1,requestHandler:new FetchHttpHandler({requestTimeout:30000}),
  credentials:{accessKeyId:PROJECT,secretAccessKey:anon,sessionToken:session}});
const readRange=async(path:string,offset:number,end:number)=>{
  if(!anon.startsWith('eyJ') || !session.startsWith('eyJ')){const error=new Error('Storage credentials unavailable');error.name='StorageCredentialsUnavailable';throw error;}
  try {
    const object=await s3.send(new GetObjectCommand({Bucket:BUCKET,Key:path,Range:`bytes=${offset}-${end}`}),
      {abortSignal:AbortSignal.timeout(30000)});
    return new Response(object.Body?.transformToWebStream(),{status:object.$metadata.httpStatusCode,
      headers:{'Content-Range':object.ContentRange||'','Content-Length':String(object.ContentLength||0)}});
  }catch(error){
    const code=['SignatureDoesNotMatch','InvalidAccessKeyId','AccessDenied','InvalidToken','NotImplemented','TimeoutError','AbortError']
      .includes(error?.name)?error.name:'Other';
    const message=String(error?.message||'');
    const detail=/jwt|token/i.test(message)?'token':/missing.*anon/i.test(message)?'anon-config':
      /signature/i.test(message)?'signature':/denied|permission|policy/i.test(message)?'permission':'other';
    console.warn('cast-source-s3',{code,detail});
    throw new Error('Storage range unavailable');
  }
};
Deno.serve(createRegistrationChunk({db,readRange}));
