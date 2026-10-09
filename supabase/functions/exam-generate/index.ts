// POST /exam-generate  { student_id, subject_id?, subject_label, level, difficulty?, question_count?, time_limit_minutes? }
// Remplace ExamController::generate().
import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase-admin.ts";
import { getCallerProfile } from "../_shared/caller.ts";
import { auditLog, requestIp } from "../_shared/audit.ts";
import { openAiCompleteJson, AiError } from "../_shared/ai.ts";

const STAFF_ROLES = ["proviseur", "principal", "directeur", "censeur"];
const LIMITED_TIER_QUOTA = 5;

async function assertBroadAccess(db: ReturnType<typeof supabaseAdmin>, caller: any, student: { id: string; class_id: string | null }) {
  if (STAFF_ROLES.includes(caller.roleCode)) return true;
  if (caller.roleCode === "professeur_principal" && student.class_id) {
    const { data } = await db.from("classes").select("id").eq("id", student.class_id).eq("homeroom_teacher_id", caller.id).maybeSingle();
    if (data) return true;
  }
  if (caller.roleCode === "parent") {
    const { data } = await db.from("student_parents").select("student_id").eq("student_id", student.id).eq("parent_id", caller.id).maybeSingle();
    if (data) return true;
  }
  const { data } = await db.from("students").select("id").eq("id", student.id).eq("profile_id", caller.id).maybeSingle();
  return !!data;
}

const SYSTEM_PROMPT_TEMPLATE = (difficulty: string, questionCount: number) => `Tu génères des épreuves de préparation aux concours pour des élèves camerounais (niveau collège/lycée, système éducatif francophone du Cameroun).
Réponds avec un objet JSON contenant une seule clé "questions" : un tableau d'exactement ${questionCount} objets, chacun avec :
- "id" : identifiant court unique (ex: "q1", "q2"...)
- "type" : "mcq" (choix multiple) ou "open" (réponse ouverte courte)
- "prompt" : l'énoncé de la question
- "options" : tableau de 4 chaînes si type="mcq", sinon absent
- "correct_answer" : la bonne réponse exacte (texte de l'option correcte si mcq, ou réponse attendue si open) — OBLIGATOIRE, ne jamais omettre
- "grading_criteria" : courte explication de ce qui constitue une bonne réponse, uniquement si type="open"
- "points" : nombre de points (entier, total sur l'ensemble des questions = 20)
Adapte la difficulté (${difficulty}) et le niveau scolaire indiqué. Varie les types de questions.`;

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);

  const caller = await getCallerProfile(req);
  if (!caller || !caller.establishment_id) return jsonResponse(req, { error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  if (!body.student_id || !body.subject_label || !body.level) return jsonResponse(req, { error: "validation_missing_fields" }, 422);

  const db = supabaseAdmin();
  const { data: student } = await db.from("students").select("id, class_id").eq("id", body.student_id).eq("establishment_id", caller.establishment_id).maybeSingle();
  if (!student) return jsonResponse(req, { error: "student_not_found" }, 404);
  if (!(await assertBroadAccess(db, caller, student))) return jsonResponse(req, { error: "student_manage_denied" }, 403);

  const { data: subscription } = await db.from("concours_subscriptions").select("tier").eq("student_id", student.id).eq("status", "active").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!subscription) return jsonResponse(req, { error: "concours_subscription_required" }, 403);

  if (subscription.tier === "limited") {
    const { count } = await db.from("exam_papers").select("id", { count: "exact", head: true }).eq("requested_by_student_id", student.id);
    if ((count ?? 0) >= LIMITED_TIER_QUOTA) return jsonResponse(req, { error: "concours_quota_exceeded" }, 403);
  }

  const difficulty = ["easy", "medium", "hard"].includes(body.difficulty) ? body.difficulty : "medium";
  const questionCount = Math.max(3, Math.min(20, Number(body.question_count) || 10));
  const timeLimit = Math.max(5, Math.min(180, Number(body.time_limit_minutes) || 30));

  const userPrompt = `Matière : ${body.subject_label}\nNiveau : ${body.level}\nDifficulté : ${difficulty}\nNombre de questions : ${questionCount}`;

  let result: any;
  try {
    result = await openAiCompleteJson([
      { role: "system", content: SYSTEM_PROMPT_TEMPLATE(difficulty, questionCount) },
      { role: "user", content: userPrompt },
    ]);
  } catch (e) {
    const msg = e instanceof AiError ? e.message : "ai_provider_error";
    return jsonResponse(req, { error: msg.split(":")[0] }, msg === "ai_not_configured" ? 503 : 502);
  }

  const questions = result?.questions;
  if (!questions || !Array.isArray(questions) || questions.length === 0) {
    return jsonResponse(req, { error: "ai_invalid_json" }, 502);
  }

  const model = Deno.env.get("OPENAI_MODEL")!;
  const { data: exam, error: insertError } = await db
    .from("exam_papers")
    .insert({
      establishment_id: caller.establishment_id, requested_by_student_id: student.id,
      subject_id: body.subject_id || null, subject_label: body.subject_label, level: body.level,
      difficulty, time_limit_minutes: timeLimit, questions, ai_model: model,
    })
    .select("id, created_at")
    .single();
  if (insertError || !exam) return jsonResponse(req, { error: "server_error" }, 500);

  await auditLog({
    establishmentId: caller.establishment_id, profileId: caller.id,
    action: "exam.generated", entityType: "exam_paper", entityId: exam.id, ipAddress: requestIp(req),
  });

  return jsonResponse(req, { success: true, data: { id: exam.id, created_at: exam.created_at } }, 201);
});
