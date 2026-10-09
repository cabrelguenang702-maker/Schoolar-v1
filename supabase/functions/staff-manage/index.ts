// POST /staff-manage  { action: "create", first_name, last_name, email, phone?, photo_url?, role_code }
// POST /staff-manage  { action: "reset_password", staff_id }
// POST /staff-manage  { action: "archive", staff_id, reason? }
// Remplace les parties d'StaffController.php qui nécessitent des droits
// d'administration Supabase Auth (créer un compte, changer un mot de passe,
// révoquer des sessions). list/show/update/reactivate n'ont pas besoin de
// cette fonction : ils passent par PostgREST direct, protégés par les
// policies RLS "profiles_manage_staff" / "profiles_select_same_establishment".
import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase-admin.ts";
import { getCallerProfile, callerHasPermission } from "../_shared/caller.ts";
import { auditLog, requestIp } from "../_shared/audit.ts";
import { sendEmail } from "../_shared/notify.ts";
import { generateTempPassword } from "../_shared/codes.ts";

const CREATABLE_ROLES = [
  "censeur", "surveillant_general", "surveillant_secteur",
  "enseignant", "professeur_principal", "secretaire", "econome", "comptable",
];
const APP_DEBUG = Deno.env.get("APP_DEBUG") === "true";


Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);

  const caller = await getCallerProfile(req);
  if (!caller || caller.status !== "active" || !caller.establishment_id) {
    return jsonResponse(req, { error: "unauthorized" }, 401);
  }
  if (!(await callerHasPermission(caller.role_id, "staff.manage"))) {
    return jsonResponse(req, { error: "forbidden" }, 403);
  }

  const body = await req.json().catch(() => ({}));
  const db = supabaseAdmin();

  // Vérifie que le membre du personnel ciblé appartient bien à l'établissement
  // de l'appelant, et n'est pas un compte de direction/élève/parent (comme
  // StaffController::findStaffOrFail()).
  async function findStaffOrFail(staffId: string) {
    const { data } = await db
      .from("profiles")
      .select("id, email, first_name, establishment_id, roles!inner(code)")
      .eq("id", staffId)
      .eq("establishment_id", caller.establishment_id)
      .not("roles.code", "in", "(proviseur,principal,directeur,admin_national,eleve,parent)")
      .maybeSingle();
    return data;
  }

  if (body.action === "create") {
    const missing = ["first_name", "last_name", "email", "role_code"].filter((k) => !body[k]);
    if (missing.length) return jsonResponse(req, { error: "validation_missing_fields", missing }, 422);
    if (!CREATABLE_ROLES.includes(body.role_code)) {
      return jsonResponse(req, { error: "staff_role_invalid", roles: CREATABLE_ROLES }, 422);
    }

    const { data: role } = await db.from("roles").select("id").eq("code", body.role_code).single();
    const { data: establishment } = await db
      .from("establishments")
      .select("name, code")
      .eq("id", caller.establishment_id)
      .single();

    const tempPassword = generateTempPassword();
    const { data: created, error: userError } = await db.auth.admin.createUser({
      email: body.email,
      password: tempPassword,
      email_confirm: true,
    });
    if (userError || !created?.user) {
      const conflict = userError?.message?.toLowerCase().includes("already registered");
      return jsonResponse(req, { error: conflict ? "staff_email_conflict" : "staff_creation_error" }, conflict ? 409 : 500);
    }

    const { error: profileError } = await db.from("profiles").insert({
      id: created.user.id,
      establishment_id: caller.establishment_id,
      role_id: role!.id,
      first_name: body.first_name,
      last_name: body.last_name,
      email: body.email,
      phone: body.phone ?? null,
      photo_url: body.photo_url ?? null,
      status: "active",
      must_change_password: true,
      admin_verified_at: new Date().toISOString(), // pas de vérification par code pour le personnel invité
    });
    if (profileError) {
      await db.auth.admin.deleteUser(created.user.id);
      return jsonResponse(req, { error: "staff_creation_error" }, 500);
    }

    await sendEmail(
      body.email,
      "SCHOOLAR — Votre compte a été créé",
      `Bonjour ${body.first_name},\n\nUn compte vous a été créé sur SCHOOLAR pour l'établissement ${establishment?.name}.\n` +
      `Code établissement : ${establishment?.code}\nEmail : ${body.email}\nMot de passe temporaire : ${tempPassword}\n\n` +
      `Vous devrez le modifier dès votre première connexion.`,
    );

    await auditLog({
      establishmentId: caller.establishment_id, profileId: caller.id,
      action: "staff.created", entityType: "profile", entityId: created.user.id,
      details: { role_code: body.role_code }, ipAddress: requestIp(req),
    });

    return jsonResponse(req, { success: true, data: { staff_id: created.user.id, dev_temp_password: APP_DEBUG ? tempPassword : null } }, 201);
  }

  if (body.action === "reset_password") {
    if (!body.staff_id) return jsonResponse(req, { error: "validation_missing_fields" }, 422);
    const staff = await findStaffOrFail(body.staff_id);
    if (!staff) return jsonResponse(req, { error: "staff_not_found" }, 404);

    const tempPassword = generateTempPassword();
    await db.auth.admin.updateUserById(staff.id, { password: tempPassword });
    await db.from("profiles").update({ must_change_password: true }).eq("id", staff.id);
    // TODO : révoquer les sessions actives de CE membre du personnel. L'appel
    // exact ("admin.signOut" par user_id vs par jwt de session) dépend de la
    // version de @supabase/supabase-js/GoTrue au moment de l'implémentation —
    // à vérifier dans la doc Supabase avant mise en production. Le nouveau
    // mot de passe est déjà effectif immédiatement dans tous les cas.

    await sendEmail(
      staff.email,
      "SCHOOLAR — Réinitialisation de votre mot de passe",
      `Bonjour ${staff.first_name},\n\nVotre mot de passe SCHOOLAR a été réinitialisé par votre établissement.\n` +
      `Nouveau mot de passe temporaire : ${tempPassword}\n\nVous devrez le modifier dès votre prochaine connexion.`,
    );

    await auditLog({
      establishmentId: caller.establishment_id, profileId: caller.id,
      action: "staff.password_reset", entityType: "profile", entityId: staff.id, ipAddress: requestIp(req),
    });

    return jsonResponse(req, { success: true, data: { dev_temp_password: APP_DEBUG ? tempPassword : null } });
  }

  if (body.action === "archive") {
    if (!body.staff_id) return jsonResponse(req, { error: "validation_missing_fields" }, 422);
    const staff = await findStaffOrFail(body.staff_id);
    if (!staff) return jsonResponse(req, { error: "staff_not_found" }, 404);

    await db.from("profiles").update({
      status: "archived",
      archived_at: new Date().toISOString(),
      archived_reason: body.reason || "Archivé par l'administration de l'établissement",
    }).eq("id", staff.id);
    // TODO : idem ci-dessus — révoquer les sessions actives de ce compte
    // archivé. À vérifier/implémenter avec l'API Supabase Auth Admin en
    // vigueur. En attendant, toutes les policies RLS doivent filtrer sur
    // profiles.status = 'active' pour qu'un JWT encore valide ne donne accès
    // à rien tant que la session n'a pas expiré naturellement.

    await auditLog({
      establishmentId: caller.establishment_id, profileId: caller.id,
      action: "staff.archived", entityType: "profile", entityId: staff.id,
      details: { reason: body.reason }, ipAddress: requestIp(req),
    });

    return jsonResponse(req, { success: true });
  }

  return jsonResponse(req, { error: "unknown_action" }, 400);
});
