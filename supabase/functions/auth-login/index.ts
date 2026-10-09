// POST /auth-login  { email, password, establishment_code? }
// Remplace AuthController::login(). La 2FA elle-même (TOTP) est vérifiée
// nativement par Supabase Auth (auth.mfa.challengeAndVerify côté client) —
// cette fonction ne fait que le pré/post-contrôle métier autour du
// signInWithPassword natif : verrouillage anti-brute-force, statut du
// compte/établissement, et blocage tant que le code de vérification à 6
// chiffres n'a pas été confirmé (rôles proviseur/principal/directeur).
import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { supabaseAdmin, supabaseAnon } from "../_shared/supabase-admin.ts";
import { auditLog, requestIp } from "../_shared/audit.ts";
import { isRateLimited } from "../_shared/rate-limit.ts";

// Un élève se connecte avec son MATRICULE, pas un email — résolu ici vers
// l'email synthétique généré par student-create-login (matricule@eleve.CODE.
// schoolar.local). Contrat de la fonction inchangé : le frontend envoie
// toujours { email, password, establishment_code } où "email" peut être un
// matricule (aucun email valide ne contient jamais d'espace ni n'omet '@').
async function resolveLoginIdentifier(identifier: string, establishmentCode?: string): Promise<string> {
  if (identifier.includes("@") || !establishmentCode) return identifier;

  const db = supabaseAdmin();
  const { data: establishment } = await db
    .from("establishments")
    .select("id")
    .eq("code", establishmentCode.toUpperCase())
    .maybeSingle();
  if (!establishment) return identifier;

  const { data: student } = await db
    .from("students")
    .select("profile_id")
    .eq("establishment_id", establishment.id)
    .ilike("matricule", identifier)
    .maybeSingle();
  if (!student?.profile_id) return identifier;

  const { data: profile } = await db.from("profiles").select("email").eq("id", student.profile_id).maybeSingle();
  return profile?.email ?? identifier;
}

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);

  if (await isRateLimited(req, "login", 20, 900)) {
    return jsonResponse(req, { error: "too_many_requests" }, 429);
  }

  const body = await req.json().catch(() => ({}));
  const { password, establishment_code } = body;
  if (!body.email || !password) {
    return jsonResponse(req, { error: "login_credentials_required" }, 422);
  }

  const email = await resolveLoginIdentifier(String(body.email), establishment_code);
  const db = supabaseAdmin();

  // Pré-lecture du profil : nécessaire pour vérifier le verrouillage AVANT
  // même de tenter le mot de passe, et pour incrémenter les échecs ensuite.
  let profileQuery = db
    .from("profiles")
    .select(`
      id, email, status, admin_verified_at, failed_login_attempts, locked_until, must_change_password,
      establishment_id, roles!inner(code),
      establishments(status, education_level)
    `)
    .eq("email", email);

  profileQuery = establishment_code
    ? profileQuery.eq("establishments.code", establishment_code)
    : profileQuery.is("establishment_id", null); // admin national uniquement sans code

  const { data: profile } = await profileQuery.maybeSingle();

  if (profile?.locked_until && new Date(profile.locked_until) > new Date()) {
    return jsonResponse(req, { error: "account_locked" }, 423);
  }

  const anon = supabaseAnon();
  const { data: signIn, error: signInError } = await anon.auth.signInWithPassword({ email, password });

  if (signInError || !signIn?.session) {
    if (profile) {
      const attempts = (profile.failed_login_attempts ?? 0) + 1;
      const patch: Record<string, unknown> = { failed_login_attempts: attempts };
      if (attempts >= 5) {
        patch.locked_until = new Date(Date.now() + 15 * 60_000).toISOString();
        await auditLog({
          establishmentId: profile.establishment_id,
          profileId: profile.id,
          action: "repeated_login_failure",
          entityType: "profile",
          entityId: profile.id,
          details: { note: "5 échecs consécutifs — compte verrouillé 15 minutes" },
          ipAddress: requestIp(req),
        });
      }
      await db.from("profiles").update(patch).eq("id", profile.id);
    }
    await auditLog({ action: "auth.login_failed", details: { email }, ipAddress: requestIp(req) });
    return jsonResponse(req, { error: "login_invalid_credentials" }, 401);
  }

  if (!profile) {
    // Ne devrait pas arriver (un auth.users sans profiles), mais on ne
    // laisse jamais une session active sans profil applicatif valide.
    await db.auth.admin.signOut(signIn.session.access_token, "global");
    return jsonResponse(req, { error: "login_invalid_credentials" }, 401);
  }

  const roleCode = (profile.roles as unknown as { code: string }).code;
  const establishmentRow = profile.establishments as unknown as { status: string; education_level: string } | null;
  const establishmentStatus = establishmentRow?.status;

  if (profile.status !== "active") {
    await db.auth.admin.signOut(signIn.session.access_token, "global");
    return jsonResponse(req, { error: `account_status_blocked:${profile.status}` }, 403);
  }
  if (profile.establishment_id && establishmentStatus !== "active" && roleCode !== "admin_national") {
    await db.auth.admin.signOut(signIn.session.access_token, "global");
    return jsonResponse(req, { error: "establishment_not_active" }, 403);
  }
  if (["proviseur", "principal", "directeur"].includes(roleCode) && !profile.admin_verified_at) {
    await db.auth.admin.signOut(signIn.session.access_token, "global");
    return jsonResponse(req, {
      success: true,
      needs_verification: true,
      data: { email: profile.email, establishment_code },
    });
  }

  // Réinitialisation des échecs + last_login_at
  await db.from("profiles").update({
    failed_login_attempts: 0,
    locked_until: null,
    last_login_at: new Date().toISOString(),
  }).eq("id", profile.id);

  // 2FA native Supabase Auth : la session existe déjà (aal1). Si l'utilisateur
  // a une MFA active, on le signale au frontend, qui complètera l'élévation
  // vers aal2 directement via supabase-js (auth.mfa.challengeAndVerify),
  // sans repasser par cette fonction.
  const { data: aal } = await anon.auth.mfa.getAuthenticatorAssuranceLevel();
  const requiresTwoFactor = aal?.nextLevel === "aal2" && aal.currentLevel !== aal.nextLevel;

  await auditLog({
    establishmentId: profile.establishment_id,
    profileId: profile.id,
    action: "auth.login_success",
    ipAddress: requestIp(req),
  });

  return jsonResponse(req, {
    success: true,
    data: {
      requires_2fa: requiresTwoFactor,
      token: signIn.session.access_token,
      refresh_token: signIn.session.refresh_token,
      user: {
        id: profile.id,
        email: profile.email,
        role_code: roleCode,
        establishment_id: profile.establishment_id,
        establishment_education_level: establishmentRow?.education_level ?? null,
        totp_enabled: requiresTwoFactor,
        must_change_password: profile.must_change_password,
      },
    },
  });
});
