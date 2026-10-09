// POST /admin-change-request  { establishment_id?, new_admin_first_name, new_admin_last_name, new_admin_email, new_admin_phone?, justification_doc_url? }
// Remplace AdminChangeController::request(). establishment_id requis si
// appelé par l'admin national (pour un établissement autre que le sien,
// qu'il n'a pas), ignoré/déduit sinon.
import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase-admin.ts";
import { getCallerProfile } from "../_shared/caller.ts";
import { auditLog, requestIp } from "../_shared/audit.ts";
import { generateInvitationToken } from "../_shared/codes.ts";
import { sendEmail } from "../_shared/notify.ts";

const APP_DEBUG = Deno.env.get("APP_DEBUG") === "true";

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);

  const caller = await getCallerProfile(req);
  if (!caller) return jsonResponse(req, { error: "unauthorized" }, 401);
  if (!["proviseur", "principal", "directeur", "admin_national"].includes(caller.roleCode)) {
    return jsonResponse(req, { error: "student_manage_denied" }, 403);
  }

  const body = await req.json().catch(() => ({}));
  const establishmentId = caller.roleCode === "admin_national" ? body.establishment_id : caller.establishment_id;
  if (!establishmentId) return jsonResponse(req, { error: "admin_change_establishment_not_found" }, 422);

  const missing = ["new_admin_first_name", "new_admin_last_name", "new_admin_email"].filter((k) => !body[k]);
  if (missing.length) return jsonResponse(req, { error: "validation_missing_fields", missing }, 422);

  const db = supabaseAdmin();
  const { data: pending } = await db
    .from("admin_change_requests")
    .select("id")
    .eq("establishment_id", establishmentId)
    .in("status", ["pending", "email_confirmed"])
    .maybeSingle();
  if (pending) return jsonResponse(req, { error: "admin_change_already_pending" }, 409);

  const { data: currentAdmin } = await db
    .from("profiles")
    .select("id, roles!inner(code)")
    .eq("establishment_id", establishmentId)
    .eq("status", "active")
    .in("roles.code", ["proviseur", "principal", "directeur"])
    .maybeSingle();

  const token = generateInvitationToken();
  const { data: created, error: insertError } = await db
    .from("admin_change_requests")
    .insert({
      establishment_id: establishmentId, old_admin_profile_id: currentAdmin?.id ?? null,
      new_admin_first_name: body.new_admin_first_name, new_admin_last_name: body.new_admin_last_name,
      new_admin_email: body.new_admin_email, new_admin_phone: body.new_admin_phone ?? null,
      justification_doc_url: body.justification_doc_url ?? null,
      validation_token: token, requested_by_profile_id: caller.id, status: "pending",
    })
    .select("id")
    .single();
  if (insertError || !created) return jsonResponse(req, { error: "server_error" }, 500);

  const frontendUrl = (Deno.env.get("FRONTEND_URL") ?? "").replace(/\/$/, "");
  const confirmUrl = `${frontendUrl}/#/admin-change/confirm/${token}`;
  await sendEmail(body.new_admin_email, "SCHOOLAR — Confirmation de votre prise de fonction",
    `Bonjour ${body.new_admin_first_name},\n\nVous avez été désigné(e) comme nouvel(le) administrateur/administratrice de votre établissement sur SCHOOLAR.\n` +
    `Merci de confirmer votre prise de fonction et de définir votre mot de passe via ce lien :\n${confirmUrl}\n\n` +
    `Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.`);

  await auditLog({
    establishmentId, profileId: caller.id, action: "admin_change.requested",
    entityType: "admin_change_request", entityId: created.id, ipAddress: requestIp(req),
  });

  return jsonResponse(req, {
    success: true, data: { request_id: created.id, dev_confirmation_token: APP_DEBUG ? token : null },
  }, 201);
});
