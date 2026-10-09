// POST /auth-register-establishment
// Remplace AuthController::registerEstablishment().
// Crée l'établissement (statut "pending", à valider par l'admin national),
// le compte administrateur (auth.users + profiles), et déclenche l'envoi du
// code de vérification à 6 chiffres (email + SMS).
import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase-admin.ts";
import { auditLog, requestIp } from "../_shared/audit.ts";
import { isRateLimited } from "../_shared/rate-limit.ts";
import { generateEstablishmentCode, generateSixDigitCode, sha256Hex } from "../_shared/codes.ts";
import { sendEmail, sendSms } from "../_shared/notify.ts";

const REQUIRED_FIELDS = [
  "name", "education_level", "linguistic_system",
  "region", "department", "arrondissement", "phone", "email",
  "admin_first_name", "admin_last_name", "admin_email", "admin_phone",
  "admin_password", "admin_role",
];

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);

  if (await isRateLimited(req, "register-establishment", 5, 3600)) {
    return jsonResponse(req, { error: "too_many_requests" }, 429);
  }

  const body = await req.json().catch(() => ({}));

  // Piège anti-bot : réponse succès en façade, rien n'est enregistré.
  if (String(body.website ?? "").trim() !== "") {
    return jsonResponse(req, { success: true, message: "establishment_registered_success" });
  }

  const missing = REQUIRED_FIELDS.filter((k) => !body[k]);
  if (missing.length) {
    return jsonResponse(req, { error: "validation_missing_fields", missing }, 422);
  }

  const educationLevel = body.education_level;
  if (!["primaire", "secondaire"].includes(educationLevel)) {
    return jsonResponse(req, { error: "education_level_invalid" }, 422);
  }
  const sector = body.sector ?? "public";
  if (!["public", "prive"].includes(sector)) {
    return jsonResponse(req, { error: "sector_invalid" }, 422);
  }

  let establishmentType: string, teachingType: string, allowedAdminRoles: string[];
  if (educationLevel === "primaire") {
    establishmentType = "ecole_primaire";
    teachingType = "general";
    allowedAdminRoles = ["directeur"];
  } else {
    establishmentType = body.establishment_type;
    if (!["college", "lycee"].includes(establishmentType)) {
      return jsonResponse(req, { error: "establishment_type_invalid" }, 422);
    }
    teachingType = body.teaching_type ?? "general";
    if (!["general", "technique"].includes(teachingType)) {
      return jsonResponse(req, { error: "validation_missing_fields", missing: ["teaching_type"] }, 422);
    }
    allowedAdminRoles = ["proviseur", "principal"];
  }

  if (!allowedAdminRoles.includes(body.admin_role)) {
    return jsonResponse(req, { error: "admin_role_invalid" }, 422);
  }
  if (String(body.admin_password).length < 8) {
    return jsonResponse(req, { error: "admin_password_min_length" }, 422);
  }

  const db = supabaseAdmin();
  const code = await generateEstablishmentCode(body.name, body.region);

  const { data: establishment, error: estError } = await db
    .from("establishments")
    .insert({
      code,
      name: body.name,
      establishment_type: establishmentType,
      education_level: educationLevel,
      sector,
      teaching_type: teachingType,
      linguistic_system: body.linguistic_system,
      region: body.region,
      department: body.department,
      arrondissement: body.arrondissement,
      quartier: body.quartier ?? null,
      address: body.address ?? null,
      phone: body.phone,
      email: body.email,
      logo_url: body.logo_url ?? null,
      photo_url: body.photo_url ?? null,
      default_language: body.default_language ?? "fr",
      status: "pending",
    })
    .select("id, code")
    .single();

  if (estError || !establishment) {
    const conflict = estError?.code === "23505";
    return jsonResponse(req, { error: conflict ? "establishment_email_conflict" : "establishment_creation_error" }, conflict ? 409 : 500);
  }

  const { data: role } = await db.from("roles").select("id").eq("code", body.admin_role).single();

  const { data: created, error: userError } = await db.auth.admin.createUser({
    email: body.admin_email,
    password: body.admin_password,
    email_confirm: true, // la vérification métier passe par le code à 6 chiffres, pas par le lien Supabase
  });

  if (userError || !created?.user) {
    await db.from("establishments").delete().eq("id", establishment.id);
    const conflict = userError?.message?.toLowerCase().includes("already registered");
    return jsonResponse(req, { error: conflict ? "establishment_email_conflict" : "establishment_creation_error" }, conflict ? 409 : 500);
  }

  const { error: profileError } = await db.from("profiles").insert({
    id: created.user.id,
    establishment_id: establishment.id,
    role_id: role!.id,
    first_name: body.admin_first_name,
    last_name: body.admin_last_name,
    email: body.admin_email,
    phone: body.admin_phone,
    status: "active",
    admin_verified_at: null, // vérification par code requise avant la 1ère connexion
  });

  if (profileError) {
    await db.auth.admin.deleteUser(created.user.id);
    await db.from("establishments").delete().eq("id", establishment.id);
    return jsonResponse(req, { error: "establishment_creation_error" }, 500);
  }

  await auditLog({
    establishmentId: establishment.id,
    profileId: created.user.id,
    action: "establishment.registered",
    entityType: "establishment",
    entityId: establishment.id,
    ipAddress: requestIp(req),
  });

  // Code de vérification à 6 chiffres (email + SMS)
  const plainCode = generateSixDigitCode();
  await db.from("account_verifications").insert({
    profile_id: created.user.id,
    code_hash: await sha256Hex(plainCode),
    channel: body.admin_phone ? "both" : "email",
    expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
  });
  await sendEmail(body.admin_email, "SCHOOLAR — Code de vérification", `Votre code de vérification est : ${plainCode} (valable 15 minutes).`);
  if (body.admin_phone) {
    await sendSms(body.admin_phone, `SCHOOLAR : votre code de vérification est ${plainCode} (15 min).`);
  }

  return jsonResponse(req, {
    success: true,
    message: "establishment_registered_success",
    data: {
      establishment_code: establishment.code,
      status: "pending",
      admin_email: body.admin_email,
    },
  }, 201);
});
