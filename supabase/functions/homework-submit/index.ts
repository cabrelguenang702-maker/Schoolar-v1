// POST /homework-submit  (multipart/form-data: homework_id, student_id, file)
// Remplace HomeworkController::submit() + notifySubmission(). Le fichier est
// stocké dans le bucket privé "homework" (jamais d'URL publique) ; l'insert
// passe par le client service_role car un parent, légitimement, n'a pas de
// droit d'écriture RLS direct sur homework_submissions (voir la policy
// homework_submissions_manage, réservée au personnel) — cette fonction fait
// exactement le travail qu'assertSubmitAccess() faisait en PHP.
import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase-admin.ts";
import { getCallerProfile, asCaller } from "../_shared/caller.ts";
import { auditLog, requestIp } from "../_shared/audit.ts";
import { sendEmail } from "../_shared/notify.ts";

const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15 Mo
const ALLOWED_MIME = ["application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/msword"];

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);

  const caller = await getCallerProfile(req);
  if (!caller) return jsonResponse(req, { error: "unauthorized" }, 401);

  const form = await req.formData().catch(() => null);
  if (!form) return jsonResponse(req, { error: "validation_missing_fields" }, 422);

  const homeworkId = form.get("homework_id")?.toString();
  const studentId = form.get("student_id")?.toString();
  const file = form.get("file");
  if (!homeworkId || !studentId) return jsonResponse(req, { error: "validation_missing_fields", missing: ["student_id"] }, 422);
  if (!(file instanceof File)) return jsonResponse(req, { error: "homework_file_required" }, 422);
  if (file.size > MAX_FILE_BYTES) return jsonResponse(req, { error: "homework_upload_file_too_large" }, 422);
  if (file.type && !ALLOWED_MIME.includes(file.type)) return jsonResponse(req, { error: "homework_upload_invalid_type" }, 422);

  const cc = asCaller(req);
  const { data: assignment } = await cc
    .from("homework_assignments")
    .select("id, title, class_subject_id, class_subjects(class_id, teacher_id, subjects(name))")
    .eq("id", homeworkId)
    .maybeSingle();
  if (!assignment) return jsonResponse(req, { error: "homework_assignment_not_found" }, 404);

  const { data: student } = await cc
    .from("students")
    .select("id, first_name, last_name, class_id")
    .eq("id", studentId)
    .maybeSingle();
  if (!student) return jsonResponse(req, { error: "student_not_found" }, 404);

  const classSubject = (assignment as any).class_subjects;
  if (student.class_id !== classSubject.class_id) {
    return jsonResponse(req, { error: "homework_student_wrong_class" }, 422);
  }

  // assertSubmitAccess() : la lecture ci-dessus a déjà été filtrée par la RLS
  // (homework_assignments_select / students_select incluent le parent
  // concerné et le personnel encadrant) — si les deux lignes ont pu être
  // lues par CET appelant, l'accès est légitime.

  const db = supabaseAdmin();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${caller.establishment_id}/${homeworkId}/${studentId}-${Date.now()}-${safeName}`;

  const { error: uploadError } = await db.storage.from("homework").upload(storagePath, file, {
    contentType: file.type || "application/octet-stream",
    upsert: true,
  });
  if (uploadError) return jsonResponse(req, { error: "homework_submission_error" }, 500);

  const { data: submission, error: upsertError } = await db
    .from("homework_submissions")
    .upsert({
      homework_id: homeworkId, student_id: studentId, storage_path: storagePath,
      original_filename: file.name, mime_type: file.type || null, file_size_bytes: file.size,
      submitted_by_profile_id: caller.id, submitted_at: new Date().toISOString(),
      reviewed: false, reviewed_at: null, review_note: null,
    }, { onConflict: "homework_id,student_id" })
    .select("id")
    .single();
  if (upsertError || !submission) return jsonResponse(req, { error: "homework_submission_error" }, 500);

  await auditLog({
    establishmentId: caller.establishment_id, profileId: caller.id,
    action: "homework.submitted", entityType: "homework_submission", entityId: submission.id,
    details: { student_id: studentId, assignment_id: homeworkId }, ipAddress: requestIp(req),
  });

  // Notifie l'enseignant de la matière + le professeur principal de la classe
  const recipientIds = [classSubject.teacher_id].filter(Boolean) as string[];
  const { data: klass } = await db.from("classes").select("homeroom_teacher_id").eq("id", classSubject.class_id).single();
  if (klass?.homeroom_teacher_id) recipientIds.push(klass.homeroom_teacher_id);

  const { data: recipients } = await db
    .from("profiles").select("email, first_name").in("id", [...new Set(recipientIds)]).eq("status", "active");
  for (const r of recipients ?? []) {
    await sendEmail(r.email, "SCHOOLAR — Nouveau devoir rendu",
      `Bonjour ${r.first_name},\n\n${student.first_name} ${student.last_name} a rendu le devoir « ${assignment.title} » (${classSubject.subjects.name}).\n\nConnectez-vous à SCHOOLAR pour le consulter.`);
  }

  return jsonResponse(req, { success: true, data: { id: submission.id } }, 201);
});
