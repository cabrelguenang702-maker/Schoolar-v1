// POST /student-create-login  { student_id }
// Remplace StudentController::createLoginAccount(). Un élève se connecte par
// MATRICULE (pas par email — la plupart n'en ont pas), via un email
// synthétique garanti unique côté auth.users, jamais utilisé pour un envoi
// réel (voir la note sur resolveLoginIdentifier() dans auth-login).
import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase-admin.ts";
import { getCallerProfile } from "../_shared/caller.ts";
import { auditLog, requestIp } from "../_shared/audit.ts";
import { generateTempPassword } from "../_shared/codes.ts";

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);

  const caller = await getCallerProfile(req);
  if (!caller || caller.status !== "active" || !caller.establishment_id) {
    return jsonResponse(req, { error: "unauthorized" }, 401);
  }

  const body = await req.json().catch(() => ({}));
  if (!body.student_id) return jsonResponse(req, { error: "validation_missing_fields" }, 422);

  const db = supabaseAdmin();
  const { data: student } = await db
    .from("students")
    .select("id, first_name, last_name, matricule, profile_id, class_id, establishment_id")
    .eq("id", body.student_id)
    .eq("establishment_id", caller.establishment_id)
    .maybeSingle();
  if (!student) return jsonResponse(req, { error: "student_not_found" }, 404);

  // Reproduit assertStudentManageAccess() : direction/secrétariat toujours OK,
  // professeur principal seulement pour SA classe.
  const allowedDirect = ["proviseur", "principal", "directeur", "secretaire"].includes(caller.roleCode);
  let allowed = allowedDirect;
  if (!allowed && caller.roleCode === "professeur_principal" && student.class_id) {
    const { data: owns } = await db
      .from("classes")
      .select("id")
      .eq("id", student.class_id)
      .eq("homeroom_teacher_id", caller.id)
      .maybeSingle();
    allowed = !!owns;
  }
  if (!allowed) return jsonResponse(req, { error: "student_manage_denied" }, 403);

  if (student.profile_id) {
    return jsonResponse(req, { error: "student_account_already_exists" }, 409);
  }

  const { data: establishment } = await db
    .from("establishments")
    .select("code, education_level")
    .eq("id", caller.establishment_id)
    .single();
  if (establishment?.education_level === "primaire") {
    return jsonResponse(req, { error: "student_login_not_available_primary" }, 403);
  }

  const { data: role } = await db.from("roles").select("id").eq("code", "eleve").single();
  const estCode = (establishment?.code ?? "").toLowerCase();
  const syntheticEmail = `${student.matricule.toLowerCase()}@eleve.${estCode}.schoolar.local`;
  const tempPassword = generateTempPassword();

  const { data: created, error: userError } = await db.auth.admin.createUser({
    email: syntheticEmail,
    password: tempPassword,
    email_confirm: true,
  });
  if (userError || !created?.user) {
    return jsonResponse(req, { error: "server_error" }, 500);
  }

  const { error: profileError } = await db.from("profiles").insert({
    id: created.user.id,
    establishment_id: caller.establishment_id,
    role_id: role!.id,
    first_name: student.first_name,
    last_name: student.last_name,
    email: syntheticEmail,
    status: "active",
    must_change_password: true,
    admin_verified_at: new Date().toISOString(),
  });
  if (profileError) {
    await db.auth.admin.deleteUser(created.user.id);
    return jsonResponse(req, { error: "server_error" }, 500);
  }

  await db.from("students").update({ profile_id: created.user.id }).eq("id", student.id);

  await auditLog({
    establishmentId: caller.establishment_id, profileId: caller.id,
    action: "student.account_created", entityType: "student", entityId: student.id,
    ipAddress: requestIp(req),
  });

  return jsonResponse(req, {
    success: true,
    data: {
      matricule: student.matricule,
      temp_password: tempPassword,
      establishment_code: (establishment?.code ?? "").toUpperCase(),
    },
  }, 201);
});
