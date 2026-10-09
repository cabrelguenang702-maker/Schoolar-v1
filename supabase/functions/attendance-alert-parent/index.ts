// POST /attendance-alert-parent  { record_id }
// Remplace AttendanceController::alertParent(). Utilise asCaller() pour la
// lecture (RLS = assertClassStaffAccess natif), service_role uniquement
// pour l'audit et la lecture des emails parents.
import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase-admin.ts";
import { getCallerProfile, asCaller } from "../_shared/caller.ts";
import { auditLog, requestIp } from "../_shared/audit.ts";
import { sendEmail } from "../_shared/notify.ts";

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);

  const caller = await getCallerProfile(req);
  if (!caller) return jsonResponse(req, { error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  if (!body.record_id) return jsonResponse(req, { error: "validation_missing_fields" }, 422);

  const cc = asCaller(req);
  const { data: record } = await cc
    .from("attendance_records")
    .select(`
      id, status, alerted_at, student_id,
      students!inner(first_name, last_name),
      attendance_sessions!inner(session_date, class_subjects!inner(subjects!inner(name)))
    `)
    .eq("id", body.record_id)
    .maybeSingle();

  if (!record) return jsonResponse(req, { error: "attendance_record_not_found" }, 404);
  if (record.status === "present") return jsonResponse(req, { error: "attendance_not_absent" }, 409);

  const student = (record as any).students;
  const subjectName = (record as any).attendance_sessions.class_subjects.subjects.name;
  const sessionDate = (record as any).attendance_sessions.session_date;
  const statusLabel = record.status === "absent" ? "absent(e)" : "en retard";

  const db = supabaseAdmin();
  const { data: parents } = await db
    .from("student_parents")
    .select("profiles!student_parents_parent_id_fkey(email, first_name, status)")
    .eq("student_id", record.student_id);

  let notified = 0;
  for (const link of parents ?? []) {
    const parent = (link as any).profiles;
    if (!parent || parent.status !== "active") continue;
    await sendEmail(parent.email, "SCHOOLAR — Alerte de présence",
      `Bonjour ${parent.first_name},\n\nVotre enfant ${student.first_name} ${student.last_name} a été signalé(e) ${statusLabel} au cours de ${subjectName} du ${sessionDate}.\n\nConnectez-vous à SCHOOLAR pour plus de détails.`);
    notified++;
  }

  await cc.from("attendance_records").update({ alerted_at: new Date().toISOString() }).eq("id", record.id);

  await auditLog({
    establishmentId: caller.establishment_id, profileId: caller.id,
    action: "attendance.parent_alerted", entityType: "attendance_record", entityId: record.id,
    ipAddress: requestIp(req),
  });

  return jsonResponse(req, { success: true, data: { notified_parents: notified } });
});
