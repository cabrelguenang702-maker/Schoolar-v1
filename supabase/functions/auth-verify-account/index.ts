// POST /auth-verify-account  { action: "verify", email, code, establishment_code? }
// POST /auth-verify-account  { action: "resend", email, establishment_code? }
// Remplace AuthController::verifyAccount() + resendVerificationCode().
import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase-admin.ts";
import { auditLog } from "../_shared/audit.ts";
import { isRateLimited } from "../_shared/rate-limit.ts";
import { generateSixDigitCode, sha256Hex } from "../_shared/codes.ts";
import { sendEmail, sendSms } from "../_shared/notify.ts";

async function findUnverifiedAdmin(db: ReturnType<typeof supabaseAdmin>, email: string, establishmentCode?: string) {
  let query = db
    .from("profiles")
    .select("id, email, phone, establishment_id, admin_verified_at, roles!inner(code), establishments(code)")
    .eq("email", email)
    .in("roles.code", ["proviseur", "principal", "directeur"])
    .is("admin_verified_at", null);

  if (establishmentCode) {
    query = query.eq("establishments.code", establishmentCode);
  }
  const { data } = await query.maybeSingle();
  return data;
}

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);

  const body = await req.json().catch(() => ({}));
  const db = supabaseAdmin();

  if (body.action === "verify") {
    if (!body.email || !body.code) {
      return jsonResponse(req, { error: "validation_missing_fields" }, 422);
    }
    const profile = await findUnverifiedAdmin(db, body.email, body.establishment_code);
    if (!profile) return jsonResponse(req, { error: "account_verification_not_found" }, 404);

    const codeHash = await sha256Hex(String(body.code));
    const { data: verification } = await db
      .from("account_verifications")
      .select("id")
      .eq("profile_id", profile.id)
      .eq("code_hash", codeHash)
      .is("consumed_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!verification) return jsonResponse(req, { error: "account_verification_invalid_code" }, 401);

    await db.from("account_verifications").update({ consumed_at: new Date().toISOString() }).eq("id", verification.id);
    await db.from("profiles").update({ admin_verified_at: new Date().toISOString() }).eq("id", profile.id);

    await auditLog({ establishmentId: profile.establishment_id, profileId: profile.id, action: "auth.account_verified" });
    return jsonResponse(req, { success: true, message: "account_verified_success", data: {} });
  }

  if (body.action === "resend") {
    if (!body.email) return jsonResponse(req, { error: "validation_missing_fields" }, 422);
    if (await isRateLimited(req, "resend-verification", 10, 3600)) {
      return jsonResponse(req, { error: "too_many_requests" }, 429);
    }

    const profile = await findUnverifiedAdmin(db, body.email, body.establishment_code);
    if (!profile) return jsonResponse(req, { error: "account_verification_not_found" }, 404);

    const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
    const { data: recent } = await db
      .from("account_verifications")
      .select("id")
      .eq("profile_id", profile.id)
      .gt("created_at", oneMinuteAgo)
      .limit(1)
      .maybeSingle();
    if (recent) return jsonResponse(req, { error: "account_verification_too_soon" }, 429);

    const plainCode = generateSixDigitCode();
    await db.from("account_verifications").insert({
      profile_id: profile.id,
      code_hash: await sha256Hex(plainCode),
      channel: profile.phone ? "both" : "email",
      expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
    });
    await sendEmail(profile.email, "SCHOOLAR — Code de vérification", `Votre code de vérification est : ${plainCode} (valable 15 minutes).`);
    if (profile.phone) await sendSms(profile.phone, `SCHOOLAR : votre code de vérification est ${plainCode} (15 min).`);

    return jsonResponse(req, { success: true, message: "account_verification_code_resent", data: {} });
  }

  return jsonResponse(req, { error: "unknown_action" }, 400);
});
