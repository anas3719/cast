import {createClient} from 'npm:@supabase/supabase-js@2.117.2';
import {createRegistrationCleanup} from '../../../lib/registration-cleanup.mjs';
const url=Deno.env.get('SUPABASE_URL');
if(url!=='https://vmnkdbceyqudcxddvljx.supabase.co')throw new Error('Wrong project');
const db=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',{auth:{persistSession:false,autoRefreshToken:false}});
Deno.serve(createRegistrationCleanup({db,waitUntil:(promise:Promise<void>)=>EdgeRuntime.waitUntil(promise)}));
