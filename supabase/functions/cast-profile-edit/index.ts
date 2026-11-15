import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { createProfileEditHandler } from '../../../lib/profile-edit-handler.mjs';
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: {persistSession:false,autoRefreshToken:false},
});
Deno.serve(createProfileEditHandler({db}));
