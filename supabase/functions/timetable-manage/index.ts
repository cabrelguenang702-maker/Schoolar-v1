// POST /timetable-manage
//   { action: "create", class_id, class_subject_id, day_of_week, start_time, end_time, room? }
//   { action: "update", entry_id, class_subject_id?, day_of_week?, start_time?, end_time?, room? }
//   { action: "delete", entry_id }
// Remplace TimetableController::create()/update()/delete()/notifyTeacher().
// La pré-vérification des conflits est faite ici pour renvoyer la LISTE
// détaillée (comme le PHP) ; le trigger timetable_enforce_no_conflicts reste
// un garde-fou en base au cas où cette étape serait contournée.
import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase-admin.ts";
import { getCallerProfile, asCaller } from "../_shared/caller.ts";
import { sendEmail } from "../_shared/notify.ts";

const MANAGE_ROLES = ["proviseur", "principal", "directeur", "censeur"];

async function notifyTeacher(db: ReturnType<typeof supabaseAdmin>, teacherId: string | null, classLabel: string, subjectName: string, actionLabel: string) {
  if (!teacherId) return;
  const { data: teacher } = await db.from("profiles").select("email, first_name").eq("id", teacherId).eq("status", "active").maybeSingle();
  if (!teacher) return;
  await sendEmail(teacher.email, "SCHOOLAR — Modification de votre emploi du temps",
    `Bonjour ${teacher.first_name},\n\nUn cours a été ${actionLabel} dans l'emploi du temps de la classe ${classLabel} (${subjectName}).\n\nConnectez-vous à SCHOOLAR pour consulter votre emploi du temps à jour.`);
}

function classLabel(c: { level: string; series?: string | null; section?: string | null }) {
  return [c.level, c.series, c.section].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);

  const caller = await getCallerProfile(req);
  if (!caller || !MANAGE_ROLES.includes(caller.roleCode)) {
    return jsonResponse(req, { error: "timetable_manage_denied" }, 403);
  }

  const body = await req.json().catch(() => ({}));
  const cc = asCaller(req);
  const db = supabaseAdmin();

  if (body.action === "delete") {
    if (!body.entry_id) return jsonResponse(req, { error: "validation_missing_fields" }, 422);
    const { data: entry } = await cc
      .from("timetable_entries")
      .select("id, day_of_week, start_time, end_time, class_id, classes(level, series, section), class_subjects(teacher_id, subjects(name))")
      .eq("id", body.entry_id)
      .maybeSingle();
    if (!entry) return jsonResponse(req, { error: "timetable_entry_not_found" }, 404);

    await cc.from("timetable_entries").delete().eq("id", entry.id);

    const cs = (entry as any).class_subjects;
    await notifyTeacher(db, cs?.teacher_id ?? null, classLabel((entry as any).classes), cs?.subjects?.name ?? "", "supprimé");
    return jsonResponse(req, { success: true });
  }

  if (!["create", "update"].includes(body.action)) return jsonResponse(req, { error: "unknown_action" }, 400);

  let classId = body.class_id;
  let existing: any = null;
  if (body.action === "update") {
    if (!body.entry_id) return jsonResponse(req, { error: "validation_missing_fields" }, 422);
    const { data } = await cc.from("timetable_entries").select("*").eq("id", body.entry_id).maybeSingle();
    if (!data) return jsonResponse(req, { error: "timetable_entry_not_found" }, 404);
    existing = data;
    classId = existing.class_id;
  } else if (!body.class_id || !body.class_subject_id || body.day_of_week === undefined || !body.start_time || !body.end_time) {
    return jsonResponse(req, { error: "validation_missing_fields" }, 422);
  }

  const classSubjectId = body.class_subject_id ?? existing.class_subject_id;
  const dayOfWeek = body.day_of_week ?? existing.day_of_week;
  const startTime = body.start_time ?? existing.start_time;
  const endTime = body.end_time ?? existing.end_time;
  const room = body.room ?? existing?.room ?? null;

  if (startTime >= endTime) return jsonResponse(req, { error: "timetable_invalid_range" }, 422);

  const { data: classSubject } = await cc
    .from("class_subjects")
    .select("id, teacher_id, subjects(name)")
    .eq("id", classSubjectId)
    .eq("class_id", classId)
    .maybeSingle();
  if (!classSubject) return jsonResponse(req, { error: "class_subject_not_found" }, 404);

  const { data: conflicts } = await cc.rpc("timetable_check_conflicts", {
    p_establishment_id: caller.establishment_id,
    p_class_id: classId,
    p_teacher_id: classSubject.teacher_id,
    p_day: dayOfWeek,
    p_start: startTime,
    p_end: endTime,
    p_room: room,
    p_exclude_entry_id: body.action === "update" ? existing.id : null,
  });
  if (conflicts && conflicts.length > 0) {
    return jsonResponse(req, { error: "timetable_conflict", details: conflicts }, 409);
  }

  const { data: klass } = await cc.from("classes").select("level, series, section").eq("id", classId).single();
  const subjectName = (classSubject as any).subjects?.name ?? "";

  if (body.action === "create") {
    const { data: created, error: insertError } = await cc
      .from("timetable_entries")
      .insert({
        establishment_id: caller.establishment_id, class_id: classId, class_subject_id: classSubjectId,
        day_of_week: dayOfWeek, start_time: startTime, end_time: endTime, room,
        created_by_profile_id: caller.id,
      })
      .select("id")
      .single();
    if (insertError || !created) return jsonResponse(req, { error: "server_error" }, 500);

    await notifyTeacher(db, classSubject.teacher_id, classLabel(klass!), subjectName, "ajouté");
    return jsonResponse(req, { success: true, data: { id: created.id } }, 201);
  }

  // update
  const { error: updateError } = await cc
    .from("timetable_entries")
    .update({ class_subject_id: classSubjectId, day_of_week: dayOfWeek, start_time: startTime, end_time: endTime, room })
    .eq("id", existing.id);
  if (updateError) return jsonResponse(req, { error: "server_error" }, 500);

  await notifyTeacher(db, classSubject.teacher_id, classLabel(klass!), subjectName, "modifié");
  return jsonResponse(req, { success: true });
});
