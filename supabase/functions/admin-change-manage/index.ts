// POST /admin-change-manage  { action: "confirm", token, password }        — PUBLIC
// POST /admin-change-manage  { action: "validate", request_id }            — admin national
// POST /admin-change-manage  { action: "reject", request_id, reason? }     — admin national
// Remplace AdminChangeController::confirm() + AdminController::validateAdminChangeRequest()/rejectAdminChangeRequest().
import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase-admin.ts";
import { getCallerProfile } from "../_shared/caller.ts";
import { auditLog, requestIp } from "../_shared/audit.ts";
import { sendEmail } from "../_shared/notify.ts";

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);

  const body = await req.json().catch(() => ({}));
  const db = supabaseAdmin();

  if (body.action === "confirm") {
    if (!body.token || !body.password) return jsonResponse(req, { error: "validation_missing_fields" }, 422);
    if (String(body.password).length < 8) return jsonResponse(req, { error: "password_min_length" }, 422);

    const { data: changeRequest } = await db.from("admin_change_requests").select("*").eq("validation_token", body.token).maybeSingle();
    if (!changeRequest) return jsonResponse(req, { error: "invalid_confirmation_link" }, 404);
    if (changeRequest.status !== "pending") return jsonResponse(req, { error: "admin_change_already_processed" }, 409);

    // Le compte Supabase Auth est créé dès maintenant (avec le mot de passe
    // choisi) ; le PROFIL applicatif (établissement + rôle), lui, n'est créé
    // qu'à la validation par l'admin national — voir note en tête de la
    // migration 0016.
    const { data: created, error: userError } = await db.auth.admin.createUser({
      email: changeRequest.new_admin_email, password: body.password, email_confirm: true,
    });
    if (userError || !created?.user) {
      const conflict = userError?.message?.toLowerCase().includes("already registered");
      return jsonResponse(req, { error: conflict ? "establishment_email_conflict" : "admin_change_validation_error" }, conflict ? 409 : 500);
    }

    await db.from("admin_change_requests").update({
      status: "email_confirmed", new_admin_auth_user_id: created.user.id,
    }).eq("id", changeRequest.id);

    await auditLog({
      establishmentId: changeRequest.establishment_id, action: "admin_change.email_confirmed",
      entityType: "admin_change_request", entityId: changeRequest.id, ipAddress: requestIp(req),
    });

    return jsonResponse(req, { success: true });
  }

  const caller = await getCallerProfile(req);
  if (!caller || caller.roleCode !== "admin_national") return jsonResponse(req, { error: "forbidden" }, 403);

  if (body.action === "validate") {
    if (!body.request_id) return jsonResponse(req, { error: "validation_missing_fields" }, 422);

    const { data: cr } = await db
      .from("admin_change_requests")
      .select("*, establishments(establishment_type)")
      .eq("id", body.request_id)
      .maybeSingle();
    if (!cr) return jsonResponse(req, { error: "admin_change_request_not_found" }, 404);
    if (cr.status !== "email_confirmed") {
      return jsonResponse(req, { error: "admin_change_needs_email_confirmation" }, 409);
    }

    if (cr.old_admin_profile_id) {
      await db.from("profiles").update({
        status: "archived", archived_at: new Date().toISOString(),
        archived_reason: "Remplacé suite à un changement d'administrateur validé",
      }).eq("id", cr.old_admin_profile_id);
    }

    const establishmentType = (cr as any).establishments?.establishment_type;
    const roleCode = establishmentType === "lycee" ? "proviseur" : establishmentType === "ecole_primaire" ? "directeur" : "principal";
    const { data: role } = await db.from("roles").select("id").eq("code", roleCode).single();

    const { error: profileError } = await db.from("profiles").insert({
      id: cr.new_admin_auth_user_id, establishment_id: cr.establishment_id, role_id: role!.id,
      first_name: cr.new_admin_first_name, last_name: cr.new_admin_last_name, email: cr.new_admin_email,
      phone: cr.new_admin_phone, status: "active", admin_verified_at: new Date().toISOString(),
    });
    if (profileError) return jsonResponse(req, { error: "admin_change_validation_error" }, 500);

    await db.from("admin_change_requests").update({
      status: "completed", validated_by_profile_id: caller.id, validated_at: new Date().toISOString(),
    }).eq("id", cr.id);

    await auditLog({
      establishmentId: cr.establishment_id, profileId: caller.id, action: "admin_change.validated",
      entityType: "profile", entityId: cr.new_admin_auth_user_id, ipAddress: requestIp(req),
    });

    await sendEmail(cr.new_admin_email, "SCHOOLAR — Prise de fonction validée",
      "Votre prise de fonction en tant qu'administrateur/administratrice a été validée par l'administration nationale SCHOOLAR. Vous pouvez désormais vous connecter avec votre email et le mot de passe défini.");

    return jsonResponse(req, { success: true, data: { new_profile_id: cr.new_admin_auth_user_id } });
  }

  if (body.action === "reject") {
    if (!body.request_id) return jsonResponse(req, { error: "validation_missing_fields" }, 422);
    const reason = body.reason ?? "";

    const { data: cr } = await db.from("admin_change_requests").select("*").eq("id", body.request_id).maybeSingle();
    if (!cr) return jsonResponse(req, { error: "admin_change_request_not_found" }, 404);
    if (!["pending", "email_confirmed"].includes(cr.status)) {
      return jsonResponse(req, { error: "admin_change_cannot_reject" }, 409);
    }

    // Nettoyage : si un compte Auth avait déjà été créé à la confirmation,
    // il est supprimé pour ne pas laisser un compte orphelin sans profil.
    if (cr.new_admin_auth_user_id) {
      await db.auth.admin.deleteUser(cr.new_admin_auth_user_id).catch(() => {});
    }

    await db.from("admin_change_requests").update({
      status: "rejected", rejection_reason: reason, validated_by_profile_id: caller.id, validated_at: new Date().toISOString(),
    }).eq("id", cr.id);

    await auditLog({
      establishmentId: cr.establishment_id, profileId: caller.id, action: "admin_change.rejected",
      entityType: "admin_change_request", entityId: cr.id, details: { reason }, ipAddress: requestIp(req),
    });

    return jsonResponse(req, { success: true });
  }

  return jsonResponse(req, { error: "unknown_action" }, 400);
});
