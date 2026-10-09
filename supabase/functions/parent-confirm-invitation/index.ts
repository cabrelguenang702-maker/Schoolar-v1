// GET  /parent-confirm-invitation?token=...   -> statut (via RPC SQL, voir migration 0005)
// POST /parent-confirm-invitation  { token, password }
// Remplace ParentController::confirmInvitation(). Fonction PUBLIQUE (aucune
// authentification requise) : le token fait office de secret, exactement
// comme dans la version PHP.
import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase-admin.ts";
import { auditLog, requestIp } from "../_shared/audit.ts";
import { isRateLimited } from "../_shared/rate-limit.ts";

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);

  if (await isRateLimited(req, "parent-confirm-invitation", 10, 3600)) {
    return jsonResponse(req, { error: "too_many_requests" }, 429);
  }

  const body = await req.json().catch(() => ({}));
  if (!body.token || !body.password) return jsonResponse(req, { error: "validation_missing_fields" }, 422);
  if (String(body.password).length < 8) return jsonResponse(req, { error: "password_min_length" }, 422);

  const db = supabaseAdmin();
  const { data: invitation } = await db
    .from("parent_invitations")
    .select("*")
    .eq("validation_token", body.token)
    .maybeSingle();

  if (!invitation) return jsonResponse(req, { error: "invitation_link_invalid" }, 404);
  if (invitation.status !== "pending") return jsonResponse(req, { error: "invitation_already_used" }, 409);

  const { data: role } = await db.from("roles").select("id").eq("code", "parent").single();

  // Cas limite : une invitation concurrente pour un autre enfant a pu créer
  // entre-temps le compte parent pour cet établissement.
  const { data: existing } = await db
    .from("profiles")
    .select("id")
    .eq("establishment_id", invitation.establishment_id)
    .eq("email", invitation.invited_email)
    .eq("role_id", role!.id)
    .maybeSingle();

  let parentProfileId: string;
  if (existing) {
    parentProfileId = existing.id;
  } else {
    const { data: created, error: userError } = await db.auth.admin.createUser({
      email: invitation.invited_email,
      password: body.password,
      email_confirm: true,
    });
    if (userError || !created?.user) {
      const conflict = userError?.message?.toLowerCase().includes("already registered");
      return jsonResponse(req, { error: conflict ? "parent_email_conflict" : "parent_space_creation_error" }, conflict ? 409 : 500);
    }
    const { error: profileError } = await db.from("profiles").insert({
      id: created.user.id,
      establishment_id: invitation.establishment_id,
      role_id: role!.id,
      first_name: invitation.invited_first_name,
      last_name: invitation.invited_last_name,
      email: invitation.invited_email,
      phone: invitation.invited_phone,
      status: "active",
      admin_verified_at: new Date().toISOString(),
    });
    if (profileError) {
      await db.auth.admin.deleteUser(created.user.id);
      return jsonResponse(req, { error: "parent_space_creation_error" }, 500);
    }
    parentProfileId = created.user.id;
  }

  await db.from("student_parents").upsert(
    { student_id: invitation.student_id, parent_id: parentProfileId, relationship: invitation.relationship },
    { onConflict: "student_id,parent_id", ignoreDuplicates: true },
  );

  await db.from("parent_invitations").update({
    status: "completed",
    created_parent_profile_id: parentProfileId,
    completed_at: new Date().toISOString(),
  }).eq("id", invitation.id);

  await auditLog({
    establishmentId: invitation.establishment_id,
    profileId: parentProfileId,
    action: "parent.invitation_confirmed",
    entityType: "profile",
    entityId: parentProfileId,
    ipAddress: requestIp(req),
  });

  return jsonResponse(req, { success: true });
});
