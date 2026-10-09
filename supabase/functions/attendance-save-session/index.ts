// POST /attendance-save-session
//   { class_subject_id, session_date, period_label?, records: [{student_id, status, justified?, justification_note?, justification_document_url?}] }
// Remplace AttendanceController::saveSession() + sendThresholdAlert().
// Particularité : toutes les lectures/écritures passent par asCaller() (RLS
// active avec le VRAI rôle de l'appelant) — assertMarkAccess() n'a donc pas
// besoin d'être réécrit en JavaScript, les policies de la migration 0007
// s'en chargent nativement. Seuls l'audit et l'envoi d'email utilisent le
// client service_role (aucune policy d'écriture n'existe sur audit_log).
import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase-admin.ts";
import { getCallerProfile, asCaller } from "../_shared/caller.ts";
import { auditLog, requestIp } from "../_shared/audit.ts";
import { sendEmail } from "../_shared/notify.ts";

const AUTO_ALERT_THRESHOLDS = [3, 5, 8, 12];
const VALID_STATUSES = ["present", "absent", "late"];

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);

  const caller = await getCallerProfile(req);
  if (!caller) return jsonResponse(req, { error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  if (!body.class_subject_id || !body.session_date || !Array.isArray(body.records)) {
    return jsonResponse(req, { error: "validation_missing_fields" }, 422);
  }
  const periodLabel = body.period_label ?? "";
  const cc = asCaller(req);

  // Ouvre/crée la séance — échoue nativement (RLS) si l'appelant n'a pas
  // les droits de saisie sur cette matière de classe.
  const { data: sessionData, error: sessionError } = await cc.rpc("get_or_create_attendance_session", {
    p_class_subject_id: body.class_subject_id,
    p_session_date: body.session_date,
    p_period_label: periodLabel,
  });
  if (sessionError || !sessionData) {
    return jsonResponse(req, { error: "attendance_mark_denied" }, 403);
  }
  const sessionId = (sessionData as any).session.id;

  const newlyAbsentStudentIds = new Set<string>();

  for (const entry of body.records) {
    const studentId = entry?.student_id;
    const status = VALID_STATUSES.includes(entry?.status) ? entry.status : "present";
    if (!studentId) continue;

    const { data: existing } = await cc
      .from("attendance_records")
      .select("id, status, justified, justification_note, justification_document_url")
      .eq("session_id", sessionId)
      .eq("student_id", studentId)
      .maybeSingle();

    const justified = entry.justified ?? existing?.justified ?? false;
    const note = entry.justification_note ?? existing?.justification_note ?? null;
    const docUrl = entry.justification_document_url ?? existing?.justification_document_url ?? null;

    if (existing) {
      if (existing.status === status && existing.justified === justified && existing.justification_note === note) {
        continue; // aucun changement
      }
      const { error: updateError } = await cc
        .from("attendance_records")
        .update({ status, justified, justification_note: note, justification_document_url: docUrl })
        .eq("id", existing.id);
      if (updateError) continue; // refusé par la RLS (élève hors classe, etc.) — ignoré comme le "continue" du PHP

      await auditLog({
        establishmentId: caller.establishment_id, profileId: caller.id,
        action: "attendance.updated", entityType: "attendance_record", entityId: existing.id,
        details: { student_id: studentId, old_status: existing.status, new_status: status }, ipAddress: requestIp(req),
      });
    } else {
      const { error: insertError } = await cc.from("attendance_records").insert({
        session_id: sessionId, student_id: studentId, status, justified,
        justification_note: note, justification_document_url: docUrl,
      });
      if (insertError) continue;
    }

    if (status === "absent" && !justified) newlyAbsentStudentIds.add(studentId);
  }

  await cc.from("attendance_sessions").update({
    taken_by_profile_id: caller.id, taken_at: new Date().toISOString(),
  }).eq("id", sessionId);

  // Alertes automatiques après plusieurs absences non justifiées
  const db = supabaseAdmin();
  let autoAlertsSent = 0;
  for (const studentId of newlyAbsentStudentIds) {
    const { count } = await db
      .from("attendance_records")
      .select("id", { count: "exact", head: true })
      .eq("student_id", studentId)
      .eq("status", "absent")
      .eq("justified", false);

    if (!AUTO_ALERT_THRESHOLDS.includes(count ?? -1)) continue;

    const { data: student } = await db.from("students").select("first_name, last_name").eq("id", studentId).single();
    if (!student) continue;

    const { data: staff } = await db
      .from("profiles")
      .select("email, first_name, roles!inner(code)")
      .eq("establishment_id", caller.establishment_id)
      .eq("status", "active")
      .in("roles.code", ["censeur", "surveillant_general"]);
    for (const s of staff ?? []) {
      await sendEmail(s.email, "SCHOOLAR — Alerte : absences répétées",
        `Bonjour ${s.first_name},\n\n${student.first_name} ${student.last_name} a désormais atteint ${count} absence(s) non justifiée(s) cette année scolaire. Un suivi est recommandé.`);
    }

    const { data: parents } = await db
      .from("student_parents")
      .select("profiles!student_parents_parent_id_fkey(email, first_name, status)")
      .eq("student_id", studentId);
    for (const link of parents ?? []) {
      const parent = (link as any).profiles;
      if (!parent || parent.status !== "active") continue;
      await sendEmail(parent.email, "SCHOOLAR — Alerte : absences répétées",
        `Bonjour ${parent.first_name},\n\nVotre enfant ${student.first_name} ${student.last_name} totalise désormais ${count} absence(s) non justifiée(s) cette année scolaire.`);
    }

    await auditLog({
      establishmentId: caller.establishment_id, profileId: null,
      action: "attendance.threshold_alert", entityType: "student", entityId: studentId,
      details: { count }, ipAddress: requestIp(req),
    });
    autoAlertsSent++;
  }

  return jsonResponse(req, { success: true, data: { auto_alerts_sent: autoAlertsSent } });
});
