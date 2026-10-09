// POST /discipline-create-report  { student_id, category, description?, incident_date? }
// Remplace DisciplineController::create() + notifyParents(). L'insertion
// passe par asCaller() : la policy discipline_reports_insert (RLS) fait
// exactement le travail d'assertReportAccess(), pas de re-vérification en JS.
import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase-admin.ts";
import { getCallerProfile, asCaller } from "../_shared/caller.ts";
import { sendEmail } from "../_shared/notify.ts";

const CATEGORIES = ["convocation", "exclusion", "retard", "indiscipline", "violence", "fraude", "avertissement"];
const CATEGORY_LABELS: Record<string, string> = {
  convocation: "Convocation", exclusion: "Exclusion", retard: "Retard",
  indiscipline: "Indiscipline", violence: "Violence", fraude: "Fraude", avertissement: "Avertissement",
};

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);

  const caller = await getCallerProfile(req);
  if (!caller) return jsonResponse(req, { error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  if (!body.student_id || !body.category) return jsonResponse(req, { error: "validation_missing_fields" }, 422);
  if (!CATEGORIES.includes(body.category)) {
    return jsonResponse(req, { error: "discipline_category_invalid", categories: CATEGORIES }, 422);
  }

  const cc = asCaller(req);
  const { data: student } = await cc
    .from("students")
    .select("id, first_name, last_name, class_id")
    .eq("id", body.student_id)
    .eq("establishment_id", caller.establishment_id)
    .eq("status", "active")
    .maybeSingle();
  if (!student) return jsonResponse(req, { error: "student_not_found" }, 404);

  const { data: report, error: insertError } = await cc
    .from("discipline_reports")
    .insert({
      establishment_id: caller.establishment_id,
      student_id: student.id,
      class_id: student.class_id,
      category: body.category,
      description: body.description ?? null,
      incident_date: body.incident_date || new Date().toISOString().slice(0, 10),
      reported_by_profile_id: caller.id,
    })
    .select("id")
    .single();

  if (insertError || !report) {
    return jsonResponse(req, { error: "discipline_access_denied" }, 403);
  }

  const db = supabaseAdmin();
  const { data: parents } = await db
    .from("student_parents")
    .select("profiles!student_parents_parent_id_fkey(email, first_name, status)")
    .eq("student_id", student.id);

  const categoryLabel = CATEGORY_LABELS[body.category] ?? body.category;
  for (const link of parents ?? []) {
    const parent = (link as any).profiles;
    if (!parent || parent.status !== "active") continue;
    await sendEmail(parent.email, "SCHOOLAR — Signalement disciplinaire",
      `Bonjour ${parent.first_name},\n\nUn signalement disciplinaire a été enregistré pour ${student.first_name} ${student.last_name}.\n` +
      `Catégorie : ${categoryLabel}\n${body.description ? `Détails : ${body.description}\n` : ""}\nConnectez-vous à SCHOOLAR pour plus d'informations.`);
  }

  return jsonResponse(req, { success: true, data: { id: report.id } }, 201);
});
