// POST /grades-validate-sequence  { class_id, sequence_id, action: "validate"|"unvalidate", force? }
// Remplace GradeController::validate()/unvalidate()/notifyParents().
// Le calcul du résumé (compute_class_sequence_summary) est appelé AVEC le
// JWT de l'appelant (asCaller) pour que la fonction SQL connaisse le vrai
// auth.uid() ; l'écriture de class_sequence_validations et l'envoi des
// emails utilisent ensuite le client service_role.
import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase-admin.ts";
import { getCallerProfile, asCaller } from "../_shared/caller.ts";
import { auditLog, requestIp } from "../_shared/audit.ts";
import { sendEmail } from "../_shared/notify.ts";

const VALIDATOR_ROLES = ["proviseur", "principal", "directeur", "censeur"];

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);

  const caller = await getCallerProfile(req);
  if (!caller || !VALIDATOR_ROLES.includes(caller.roleCode)) {
    return jsonResponse(req, { error: "grades_validation_denied" }, 403);
  }

  const body = await req.json().catch(() => ({}));
  if (!body.class_id || !body.sequence_id || !["validate", "unvalidate"].includes(body.action)) {
    return jsonResponse(req, { error: "validation_missing_fields" }, 422);
  }

  const db = supabaseAdmin();
  const { data: klass } = await db.from("classes").select("id").eq("id", body.class_id).eq("establishment_id", caller.establishment_id).maybeSingle();
  const { data: sequence } = await db.from("sequences").select("id, label").eq("id", body.sequence_id).eq("establishment_id", caller.establishment_id).maybeSingle();
  if (!klass) return jsonResponse(req, { error: "class_not_found" }, 404);
  if (!sequence) return jsonResponse(req, { error: "sequence_not_found" }, 404);

  if (body.action === "unvalidate") {
    await db.from("class_sequence_validations").update({
      status: "draft", validated_by_profile_id: null, validated_at: null,
    }).eq("class_id", klass.id).eq("sequence_id", sequence.id);

    await auditLog({
      establishmentId: caller.establishment_id, profileId: caller.id,
      action: "grades.sequence_unvalidated", entityType: "class", entityId: klass.id,
      details: { sequence_id: sequence.id }, ipAddress: requestIp(req),
    });
    return jsonResponse(req, { success: true });
  }

  // action === "validate"
  const { data: summary, error: summaryError } = await asCaller(req).rpc("compute_class_sequence_summary", {
    p_class_id: klass.id, p_sequence_id: sequence.id,
  });
  if (summaryError || !summary) {
    return jsonResponse(req, { error: "server_error" }, 500);
  }

  const missingGradesCount = summary.missing_grades_count ?? 0;
  if (missingGradesCount > 0 && !body.force) {
    return jsonResponse(req, {
      error: "grades_missing_warning",
      details: { missing_grades_count: missingGradesCount },
    }, 409);
  }

  await db.from("class_sequence_validations").upsert(
    { class_id: klass.id, sequence_id: sequence.id, status: "validated", validated_by_profile_id: caller.id, validated_at: new Date().toISOString() },
    { onConflict: "class_id,sequence_id" },
  );

  await auditLog({
    establishmentId: caller.establishment_id, profileId: caller.id,
    action: "grades.sequence_validated", entityType: "class", entityId: klass.id,
    details: { sequence_id: sequence.id }, ipAddress: requestIp(req),
  });

  // Notification des parents (résultats disponibles)
  let notified = 0;
  const students: Record<string, any> = summary.students ?? {};
  for (const studentSummary of Object.values(students) as any[]) {
    if (studentSummary.average === null || studentSummary.average === undefined) continue;

    const { data: parents } = await db
      .from("student_parents")
      .select("profiles!student_parents_parent_id_fkey(email, first_name, status)")
      .eq("student_id", studentSummary.student_id);

    for (const link of parents ?? []) {
      const parent = (link as any).profiles;
      if (!parent || parent.status !== "active") continue;
      await sendEmail(
        parent.email,
        `SCHOOLAR — Résultats disponibles : ${sequence.label}`,
        `Bonjour ${parent.first_name},\n\nLes résultats de ${studentSummary.first_name} ${studentSummary.last_name} pour la ${sequence.label} sont disponibles :\n` +
        `Moyenne : ${studentSummary.average}/20 — Rang : ${studentSummary.rank}e / ${summary.class_size}\n\n` +
        `Connectez-vous à SCHOOLAR pour consulter le détail par matière.`,
      );
      notified++;
    }
  }

  return jsonResponse(req, { success: true, data: { notified_parents: notified } });
});
