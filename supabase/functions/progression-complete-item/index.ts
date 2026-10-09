// POST /progression-complete-item  { item_id }
// Remplace ProgressionController::complete() + notifyCompletion(). La mise à
// jour elle-même passe par asCaller() (RLS + trigger de garde déjà en place
// dans la migration 0009) ; seul l'envoi d'emails justifie cette fonction.
import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase-admin.ts";
import { getCallerProfile, asCaller } from "../_shared/caller.ts";
import { sendEmail } from "../_shared/notify.ts";

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);

  const caller = await getCallerProfile(req);
  if (!caller) return jsonResponse(req, { error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  if (!body.item_id) return jsonResponse(req, { error: "validation_missing_fields" }, 422);

  const cc = asCaller(req);
  const { data: item } = await cc
    .from("progression_items")
    .select("id, title, class_subject_id, class_subjects(class_id, subjects(name))")
    .eq("id", body.item_id)
    .maybeSingle();
  if (!item) return jsonResponse(req, { error: "progression_item_not_found" }, 404);

  const { error: updateError } = await cc
    .from("progression_items")
    .update({ completed: true })
    .eq("id", item.id);
  if (updateError) {
    const msg = updateError.message?.includes("progression_already_completed")
      ? "progression_already_completed" : "progression_manage_denied";
    return jsonResponse(req, { error: msg }, msg === "progression_already_completed" ? 409 : 403);
  }

  const classId = (item as any).class_subjects.class_id;
  const subjectName = (item as any).class_subjects.subjects.name;

  const db = supabaseAdmin();
  const { data: klass } = await db.from("classes").select("level, series, section").eq("id", classId).single();
  const classLabel = [klass?.level, klass?.series, klass?.section].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  const body_ = `Une nouvelle leçon a été marquée comme terminée en ${subjectName} pour la classe ${classLabel} :\n« ${item.title} »`;

  let notified = 0;
  const { data: staff } = await db
    .from("profiles")
    .select("email, first_name, roles!inner(code)")
    .eq("establishment_id", caller.establishment_id)
    .eq("status", "active")
    .in("roles.code", ["censeur", "surveillant_general"]);
  for (const s of staff ?? []) {
    await sendEmail(s.email, "SCHOOLAR — Progression pédagogique mise à jour", `Bonjour ${s.first_name},\n\n${body_}`);
    notified++;
  }

  const { data: parents } = await db
    .from("students")
    .select("student_parents(profiles!student_parents_parent_id_fkey(email, first_name, status))")
    .eq("class_id", classId)
    .eq("status", "active");
  const seen = new Set<string>();
  for (const student of parents ?? []) {
    for (const link of (student as any).student_parents ?? []) {
      const parent = link.profiles;
      if (!parent || parent.status !== "active" || seen.has(parent.email)) continue;
      seen.add(parent.email);
      await sendEmail(parent.email, "SCHOOLAR — Progression pédagogique mise à jour", `Bonjour ${parent.first_name},\n\n${body_}`);
      notified++;
    }
  }

  return jsonResponse(req, { success: true, data: { notified } });
});
