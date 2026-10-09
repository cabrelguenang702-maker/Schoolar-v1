// POST /student-invite-parent  { student_id, first_name, last_name, email, phone?, relationship? }
// Remplace StudentController::inviteParent().
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
  if (!caller || caller.status !== "active" || !caller.establishment_id) {
    return jsonResponse(req, { error: "unauthorized" }, 401);
  }

  const body = await req.json().catch(() => ({}));
  const missing = ["student_id", "first_name", "last_name", "email"].filter((k) => !body[k]);
  if (missing.length) return jsonResponse(req, { error: "validation_missing_fields", missing }, 422);

  const db = supabaseAdmin();
  const { data: student } = await db
    .from("students")
    .select("id, first_name, last_name, class_id, establishment_id")
    .eq("id", body.student_id)
    .eq("establishment_id", caller.establishment_id)
    .maybeSingle();
  if (!student) return jsonResponse(req, { error: "student_not_found" }, 404);

  const allowedDirect = ["proviseur", "principal", "directeur", "secretaire"].includes(caller.roleCode);
  let allowed = allowedDirect;
  if (!allowed && caller.roleCode === "professeur_principal" && student.class_id) {
    const { data: owns } = await db.from("classes").select("id").eq("id", student.class_id).eq("homeroom_teacher_id", caller.id).maybeSingle();
    allowed = !!owns;
  }
  if (!allowed) return jsonResponse(req, { error: "student_manage_denied" }, 403);

  const email = String(body.email).toLowerCase();

  // Cas 1 : ce parent a déjà un compte SCHOOLAR dans CET établissement.
  const { data: existingParent } = await db
    .from("profiles")
    .select("id, roles!inner(code)")
    .eq("establishment_id", caller.establishment_id)
    .eq("email", email)
    .eq("status", "active")
    .eq("roles.code", "parent")
    .maybeSingle();

  if (existingParent) {
    await db.from("student_parents").upsert(
      { student_id: student.id, parent_id: existingParent.id, relationship: body.relationship ?? null },
      { onConflict: "student_id,parent_id", ignoreDuplicates: true },
    );

    await sendEmail(email, "SCHOOLAR — Nouvel élève ajouté à votre espace",
      `Bonjour ${body.first_name},\n\n${student.first_name} ${student.last_name} a été ajouté(e) à votre espace parent SCHOOLAR. Connectez-vous pour le/la retrouver.`);

    await auditLog({
      establishmentId: caller.establishment_id, profileId: caller.id,
      action: "parent.linked_existing", entityType: "student", entityId: student.id, ipAddress: requestIp(req),
    });

    return jsonResponse(req, { success: true, data: { linked_existing: true } });
  }

  // Cas 2 : nouvelle invitation avec lien de confirmation sécurisé.
  const { data: pending } = await db
    .from("parent_invitations")
    .select("id")
    .eq("student_id", student.id)
    .eq("invited_email", email)
    .eq("status", "pending")
    .maybeSingle();
  if (pending) return jsonResponse(req, { error: "invitation_already_pending" }, 409);

  const token = generateInvitationToken();
  const { data: invitation, error: invError } = await db
    .from("parent_invitations")
    .insert({
      establishment_id: caller.establishment_id,
      student_id: student.id,
      invited_first_name: body.first_name,
      invited_last_name: body.last_name,
      invited_email: email,
      invited_phone: body.phone ?? null,
      relationship: body.relationship ?? null,
      validation_token: token,
      invited_by_profile_id: caller.id,
    })
    .select("id")
    .single();
  if (invError || !invitation) return jsonResponse(req, { error: "server_error" }, 500);

  const frontendUrl = (Deno.env.get("FRONTEND_URL") ?? "").replace(/\/$/, "");
  const confirmUrl = `${frontendUrl}/#/parent-invitation/confirm/${token}`;
  await sendEmail(email, "SCHOOLAR — Invitation à rejoindre votre espace parent",
    `Bonjour ${body.first_name},\n\nVous avez été invité(e) à créer votre espace parent SCHOOLAR pour suivre la scolarité de ${student.first_name} ${student.last_name}.\n` +
    `Créez votre accès via ce lien :\n${confirmUrl}\n\nSi vous n'êtes pas concerné(e), ignorez cet email.`);

  await auditLog({
    establishmentId: caller.establishment_id, profileId: caller.id,
    action: "parent.invited", entityType: "parent_invitation", entityId: invitation.id, ipAddress: requestIp(req),
  });

  return jsonResponse(req, {
    success: true,
    data: {
      linked_existing: false,
      invitation_id: invitation.id,
      dev_confirmation_token: APP_DEBUG ? token : null,
    },
  }, 201);
});
