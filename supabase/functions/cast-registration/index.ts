import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import '../../../cast-registration-rules.js';
import { createRegistrationHandler } from '../../../lib/registration-handler.mjs';

const env = (name: string) => Deno.env.get(name) || '';
const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const rules = (globalThis as unknown as { castRegistrationRules: object }).castRegistrationRules;
Deno.serve(createRegistrationHandler({ db, rules, env }));
