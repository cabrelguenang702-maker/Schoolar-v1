// POST /orientation-generate  { student_id }
// Remplace OrientationController::generate(). L'accès est réévalué
// explicitement ici (assertAccess) plutôt que de s'appuyer sur la RLS de
// `students`, qui est plus large (inclut tout enseignant de la classe, pas
// seulement le professeur principal — voir career_assessments_select,
// migration 0013, qui elle reproduit fidèlement le groupe exact).
import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase-admin.ts";
import { getCallerProfile } from "../_shared/caller.ts";
import { auditLog, requestIp } from "../_shared/audit.ts";
import { anthropicCompleteJson, AiError } from "../_shared/ai.ts";

const STAFF_ROLES = ["proviseur", "principal", "directeur", "censeur"];

const SYSTEM_PROMPT = `Tu es un conseiller d'orientation scolaire pour le système éducatif camerounais (collèges et lycées, séries générales et techniques).
On te fournit l'historique de résultats d'un élève. Réponds avec un objet JSON contenant exactement ces clés :
- "strengths": tableau de chaînes (matières/points forts identifiés)
- "weaknesses": tableau de chaînes (matières où l'élève est en difficulté)
- "revision_plan": chaîne (plan de révision personnalisé, concis, actionnable)
- "suggested_universities": tableau de chaînes (universités camerounaises ou étrangères pertinentes selon la série/niveau)
- "suggested_competitive_exams": tableau de chaînes (concours nationaux camerounais pertinents : ENS, ENAM, Polytechnique, FMSB, IRIC, etc. selon le profil)
- "success_estimate": chaîne courte (estimation qualitative des chances de réussite, ex: "Élevées", "Moyennes avec efforts ciblés", "À renforcer")
- "summary": chaîne (2-3 phrases de synthèse générale, ton bienveillant et constructif)`;

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);

  const caller = await getCallerProfile(req);
  if (!caller || !caller.establishment_id) return jsonResponse(req, { error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  if (!body.student_id) return jsonResponse(req, { error: "validation_missing_fields" }, 422);

  const db = supabaseAdmin();
  const { data: student } = await db.from("students").select("id, first_name, last_name, class_id").eq("id", body.student_id).eq("establishment_id", caller.establishment_id).maybeSingle();
  if (!student) return jsonResponse(req, { error: "student_not_found" }, 404);

  let authorized = STAFF_ROLES.includes(caller.roleCode);
  if (!authorized && caller.roleCode === "professeur_principal" && student.class_id) {
    const { data } = await db.from("classes").select("id").eq("id", student.class_id).eq("homeroom_teacher_id", caller.id).maybeSingle();
    authorized = !!data;
  }
  if (!authorized && caller.roleCode === "parent") {
    const { data } = await db.from("student_parents").select("student_id").eq("student_id", student.id).eq("parent_id", caller.id).maybeSingle();
    authorized = !!data;
  }
  if (!authorized) {
    const { data } = await db.from("students").select("id").eq("id", student.id).eq("profile_id", caller.id).maybeSingle();
    authorized = !!data;
  }
  if (!authorized) return jsonResponse(req, { error: "student_manage_denied" }, 403);

  const { data: grades } = await db
    .from("grades")
    .select("score, sequences(label, term_label, order_index), class_subjects(coefficient, subjects(name))")
    .eq("student_id", student.id)
    .not("score", "is", null);
  if (!grades || grades.length === 0) return jsonResponse(req, { error: "orientation_no_grades" }, 422);

  const gradesPayload = grades
    .sort((a: any, b: any) => (a.sequences?.order_index ?? 0) - (b.sequences?.order_index ?? 0))
    .map((g: any) => ({
      sequence_label: g.sequences?.label, term_label: g.sequences?.term_label,
      subject_name: g.class_subjects?.subjects?.name, coefficient: g.class_subjects?.coefficient, score: g.score,
    }));

  const { data: attendanceRows } = await db.from("attendance_records").select("status").eq("student_id", student.id);
  const attendance = Object.entries(
    (attendanceRows ?? []).reduce((acc: Record<string, number>, r: any) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {}),
  ).map(([status, total]) => ({ status, total }));

  let classInfo: { level: string | null; series: string | null } = { level: null, series: null };
  if (student.class_id) {
    const { data } = await db.from("classes").select("level, series").eq("id", student.class_id).single();
    if (data) classInfo = data;
  }

  const userPrompt = `Niveau/série de l'élève : ${classInfo.level ?? "?"} ${classInfo.series ?? ""}\n\n` +
    `Résultats par séquence et matière (sur 20, coefficient indiqué) :\n${JSON.stringify(gradesPayload)}\n\n` +
    `Présences (nombre d'occurrences par statut) :\n${JSON.stringify(attendance)}`;

  let result: any;
  try {
    result = await anthropicCompleteJson(SYSTEM_PROMPT, userPrompt);
  } catch (e) {
    const msg = e instanceof AiError ? e.message : "ai_provider_error";
    return jsonResponse(req, { error: msg.split(":")[0] }, msg === "ai_not_configured" ? 503 : 502);
  }

  const model = Deno.env.get("ANTHROPIC_MODEL")!;
  const { data: assessment, error: insertError } = await db
    .from("career_assessments")
    .insert({ establishment_id: caller.establishment_id, student_id: student.id, requested_by_profile_id: caller.id, content: result, ai_model: model })
    .select("id, created_at")
    .single();
  if (insertError || !assessment) return jsonResponse(req, { error: "server_error" }, 500);

  await auditLog({
    establishmentId: caller.establishment_id, profileId: caller.id,
    action: "orientation.generated", entityType: "career_assessment", entityId: assessment.id, ipAddress: requestIp(req),
  });

  return jsonResponse(req, { success: true, data: { id: assessment.id, created_at: assessment.created_at, content: result } }, 201);
});
