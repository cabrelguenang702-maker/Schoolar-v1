import { createClient } from "npm:@supabase/supabase-js@2";

// Client "service_role" : contourne RLS, réservé aux Edge Functions.
// SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont injectées automatiquement
// par Supabase dans l'environnement de chaque Edge Function.
export function supabaseAdmin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

// Client "anon" : utilisé pour appeler auth.signInWithPassword côté serveur
// exactement comme le ferait le frontend (nécessaire pour l'étape login, où
// l'on veut intercepter le résultat avant de le transmettre au client).
export function supabaseAnon() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
