import { createClient } from "npm:@supabase/supabase-js@2";
import { supabaseAdmin } from "./supabase-admin.ts";

/**
 * Client Supabase agissant AVEC les droits/JWT de l'appelant (RLS + auth.uid()
 * actifs), utile pour appeler une fonction SQL SECURITY DEFINER qui a besoin
 * de connaître le "vrai" auth.uid() de la requête (ex: compute_class_sequence_summary).
 * Le client service_role (supabaseAdmin) n'a PAS de session : auth.uid() y
 * est toujours NULL.
 */
export function asCaller(req: Request) {
  const authHeader = req.headers.get("authorization") ?? "";
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
}

/**
 * Résout le profil de l'appelant à partir du JWT Supabase envoyé dans
 * l'en-tête Authorization (vérifié automatiquement par la plateforme Edge
 * Functions avant même l'exécution du code). Remplace Core\Auth (contexte
 * $context['user'] / $context['establishment_id'] injecté par AuthMiddleware).
 */
export async function getCallerProfile(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return null;

  const asCaller = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: userData } = await asCaller.auth.getUser();
  if (!userData?.user) return null;

  const db = supabaseAdmin();
  const { data: profile } = await db
    .from("profiles")
    .select("id, establishment_id, status, role_id, first_name, last_name, roles!inner(code)")
    .eq("id", userData.user.id)
    .single();

  return profile
    ? { ...profile, roleCode: (profile.roles as unknown as { code: string }).code }
    : null;
}

// has_permission() (fonction SQL) lit auth.uid() : pratique depuis PostgREST/RLS,
// mais inutilisable ici où l'on agit avec la clé service_role (pas de session
// utilisateur). On refait donc la même vérification directement par requête.
export async function callerHasPermission(roleId: number, permCode: string): Promise<boolean> {
  const db = supabaseAdmin();
  const { data } = await db
    .from("role_permissions")
    .select("permissions!inner(code)")
    .eq("role_id", roleId)
    .eq("permissions.code", permCode)
    .maybeSingle();
  return !!data;
}
