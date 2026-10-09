// POST /exam-submit  { exam_paper_id, answers: { question_id: réponse } }
// Remplace ExamController::submit() + correctOpenQuestions().
import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase-admin.ts";
import { getCallerProfile } from "../_shared/caller.ts";
import { auditLog, requestIp } from "../_shared/audit.ts";
import { openAiCompleteJson, AiError } from "../_shared/ai.ts";

const STAFF_ROLES = ["proviseur", "principal", "directeur", "censeur"];

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

async function correctOpenQuestions(openQuestions: any[]): Promise<Record<string, any>> {
  const systemPrompt = `Tu corriges des réponses ouvertes d'élèves camerounais à une épreuve de préparation aux concours.
Pour chaque question fournie, évalue la réponse de l'élève par rapport aux critères donnés.
Réponds avec un objet JSON dont les clés sont les identifiants de question (ex: "q3") et les valeurs des objets :
{ "correct": true|false, "points_awarded": nombre (entre 0 et le maximum indiqué pour cette question), "explanation": "brève justification en français" }`;
  return await openAiCompleteJson([
    { role: "system", content: systemPrompt },
    { role: "user", content: JSON.stringify(openQuestions) },
  ]);
}

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);

  const caller = await getCallerProfile(req);
  if (!caller || !caller.establishment_id) return jsonResponse(req, { error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  if (!body.exam_paper_id) return jsonResponse(req, { error: "validation_missing_fields" }, 422);

  const db = supabaseAdmin();
  const { data: exam } = await db.from("exam_papers").select("id, requested_by_student_id, questions").eq("id", body.exam_paper_id).eq("establishment_id", caller.establishment_id).maybeSingle();
  if (!exam) return jsonResponse(req, { error: "exam_not_found" }, 404);

  const { data: student } = await db.from("students").select("id, class_id").eq("id", exam.requested_by_student_id).single();
  if (!(await assertBroadAccess(db, caller, student))) return jsonResponse(req, { error: "student_manage_denied" }, 403);

  const { data: attempt } = await db.from("exam_attempts").select("id, status").eq("exam_paper_id", exam.id).eq("student_id", student.id).maybeSingle();
  if (!attempt) return jsonResponse(req, { error: "exam_not_started" }, 409);
  if (attempt.status !== "in_progress") return jsonResponse(req, { error: "exam_already_submitted" }, 409);

  const answers = body.answers ?? {};
  const questions: any[] = exam.questions ?? [];
  const feedback: Record<string, any> = {};
  const openQuestions: any[] = [];
  let totalScore = 0;
  let maxScore = 0;

  for (const q of questions) {
    const points = Number(q.points ?? 1);
    maxScore += points;
    const given = answers[q.id] ?? null;

    if (q.type === "mcq") {
      const correct = String(q.correct_answer ?? "").trim().toLowerCase() === String(given ?? "").trim().toLowerCase();
      feedback[q.id] = { correct, points_awarded: correct ? points : 0, explanation: null };
      totalScore += correct ? points : 0;
    } else {
      openQuestions.push({ id: q.id, prompt: q.prompt, grading_criteria: q.grading_criteria ?? "", points, given_answer: given });
    }
  }

  if (openQuestions.length > 0) {
    try {
      const correction = await correctOpenQuestions(openQuestions);
      for (const [qid, c] of Object.entries<any>(correction)) {
        feedback[qid] = c;
        totalScore += Number(c?.points_awarded ?? 0);
      }
    } catch {
      // Correction IA indisponible : questions ouvertes marquées à corriger
      // manuellement, sans bloquer la remise (comme le PHP d'origine).
      for (const oq of openQuestions) {
        feedback[oq.id] = { correct: null, points_awarded: 0, explanation: "Correction manuelle nécessaire" };
      }
    }
  }

  await db.from("exam_attempts").update({
    submitted_at: new Date().toISOString(), answers, score: totalScore, max_score: maxScore, feedback, status: "graded",
  }).eq("id", attempt.id);

  await auditLog({
    establishmentId: caller.establishment_id, profileId: caller.id,
    action: "exam.submitted", entityType: "exam_attempt", entityId: attempt.id,
    details: { score: totalScore, max: maxScore }, ipAddress: requestIp(req),
  });

  return jsonResponse(req, { success: true, data: { score: totalScore, max_score: maxScore, feedback } });
});
