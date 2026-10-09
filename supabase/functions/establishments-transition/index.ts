// POST /establishments-transition
//   { establishment_id, action: "approve" }               pending -> active
//   { establishment_id, action: "reject", reason }        pending -> rejected
//   { establishment_id, action: "suspend", reason }        active -> suspended
//   { establishment_id, action: "reactivate" }             suspended -> active
// Remplace AdminController::approveEstablishment()/rejectEstablishment()/
// suspendEstablishment()/reactivateEstablishment() + notifyEstablishmentAdmins().
// Réservé à l'admin national (is_national_admin()).
import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase-admin.ts";
import { getCallerProfile } from "../_shared/caller.ts";
import { auditLog, requestIp } from "../_shared/audit.ts";
import { sendEmail } from "../_shared/notify.ts";

const TRANSITIONS: Record<string, { from: string; to: string; auditAction: string }> = {
  approve:    { from: "pending",  to: "active",    auditAction: "establishment.approved" },
  reject:     { from: "pending",  to: "rejected",  auditAction: "establishment.rejected" },
  suspend:    { from: "active",   to: "suspended", auditAction: "establishment.suspended" },
  reactivate: { from: "suspended", to: "active",   auditAction: "establishment.reactivated" },
};

const NOTIFICATIONS: Record<string, (reason?: string) => { subject: string; body: string } | null> = {
  approve: () => ({
    subject: "SCHOOLAR — Établissement activé",
    body: "Bonne nouvelle ! Votre établissement a été validé par l'administration nationale SCHOOLAR et est désormais actif. Vous pouvez vous connecter à votre espace.",
  }),
  reject: (reason) => ({
    subject: "SCHOOLAR — Inscription non validée",
    body: `Votre demande d'inscription n'a pas pu être validée. Motif indiqué par l'administration nationale : ${reason || "non précisé"}. Vous pouvez corriger les informations et soumettre une nouvelle demande.`,
  }),
  suspend: () => null,
  reactivate: () => null,
};

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);

  const caller = await getCallerProfile(req);
  if (!caller || caller.roleCode !== "admin_national") {
    return jsonResponse(req, { error: "forbidden" }, 403);
  }

  const body = await req.json().catch(() => ({}));
  const transition = TRANSITIONS[body.action];
  if (!transition || !body.establishment_id) {
    return jsonResponse(req, { error: "unknown_action" }, 400);
  }

  const db = supabaseAdmin();
  const { data: establishment } = await db
    .from("establishments")
    .select("id, status")
    .eq("id", body.establishment_id)
    .single();

  if (!establishment) return jsonResponse(req, { error: "establishment_not_found" }, 404);
  if (establishment.status !== transition.from) {
    return jsonResponse(req, {
      error: "establishment_invalid_transition",
      details: { status: establishment.status, expected: transition.from },
    }, 409);
  }

  const patch: Record<string, unknown> = {
    status: transition.to,
    validated_by_profile_id: caller.id,
    validated_at: new Date().toISOString(),
  };
  if (body.action === "reject") patch.rejection_reason = body.reason ?? "";
  if (body.action === "suspend") patch.suspended_reason = body.reason ?? "";

  await db.from("establishments").update(patch).eq("id", establishment.id);

  await auditLog({
    establishmentId: establishment.id,
    profileId: caller.id,
    action: transition.auditAction,
    entityType: "establishment",
    entityId: establishment.id,
    details: body.reason ? { reason: body.reason } : null,
    ipAddress: requestIp(req),
  });

  const notification = NOTIFICATIONS[body.action]?.(body.reason);
  if (notification) {
    const { data: admins } = await db
      .from("profiles")
      .select("email, roles!inner(code)")
      .eq("establishment_id", establishment.id)
      .eq("status", "active")
      .in("roles.code", ["proviseur", "principal", "directeur"]);
    for (const admin of admins ?? []) {
      await sendEmail(admin.email, notification.subject, notification.body);
    }
  }

  return jsonResponse(req, { success: true });
});
