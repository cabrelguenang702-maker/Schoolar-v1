import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * Pour les liens de téléchargement/export cliqués directement par le
 * navigateur (balise <a href>, window.open), impossible d'attacher un en-tête
 * Authorization — le jeton Supabase transite donc en paramètre `?token=`.
 * Reproduit le principe déjà présent dans le frontend d'origine
 * (`?token=...` sur les URLs de téléchargement PHP), adapté au JWT Supabase.
 */
export function callerFromQueryToken(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) return null;

  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
}
