import { supabaseAdmin } from "./supabase-admin.ts";

// Reprend AuthController::generateEstablishmentCode() : 3 lettres de la
// région + 3 lettres du nom + suffixe numérique si collision.
export async function generateEstablishmentCode(
  name: string,
  region: string,
): Promise<string> {
  const clean = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z]/g, "")
      .toUpperCase();

  const base = (clean(region).slice(0, 3) + clean(name).slice(0, 3)).padEnd(6, "X");
  const db = supabaseAdmin();

  for (let suffix = 0; suffix < 1000; suffix++) {
    const candidate = suffix === 0 ? base : `${base}${suffix}`;
    const { data } = await db
      .from("establishments")
      .select("id")
      .eq("code", candidate)
      .maybeSingle();
    if (!data) return candidate;
  }
  throw new Error("Impossible de générer un code établissement unique");
}

export function generateSixDigitCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return n.toString().padStart(6, "0");
}

// Mot de passe temporaire lisible, remis à l'utilisateur une seule fois
// (personnel invité, compte élève créé par l'établissement...).
export function generateTempPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, "").slice(0, 12) + "!1";
}

export function generateInvitationToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
