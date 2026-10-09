// POST /bulletin-generate  { student_id, sequence_id }
// Remplace BulletinController::generate().
import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase-admin.ts";
import { getCallerProfile } from "../_shared/caller.ts";
import { auditLog, requestIp } from "../_shared/audit.ts";
import { openAiCompleteJson, AiError } from "../_shared/ai.ts";

const TEMPLATE_MANAGE_ROLES = ["proviseur", "principal", "directeur", "censeur", "secretaire"];

const SYSTEM_PROMPT = `Tu génères le contenu structuré d'un bulletin scolaire camerounais pour un élève, à partir de ses notes.
Si une image d'exemple de bulletin est fournie, inspire-toi de sa structure (sections, ordre) pour le champ "layout_notes".
Réponds avec un objet JSON contenant exactement ces clés :
- "subjects": tableau reprenant les matières fournies, chacune avec {"subject_name","coefficient","score","appreciation"} — "appreciation" est un très court commentaire pédagogique (2-4 mots, ex: "Bon travail", "Peut mieux faire")
- "average": moyenne générale pondérée (nombre, calcule-la toi-même à partir des scores et coefficients fournis)
- "general_appreciation": une appréciation générale du conseil de classe (1-2 phrases, ton constructif)
- "layout_notes": brève description de la mise en page observée sur l'exemple fourni (ou "Modèle standard" si aucune image n'est fournie)`;

function generateVerificationCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return "SCH-" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);

  const caller = await getCallerProfile(req);
  if (!caller || !caller.establishment_id) return jsonResponse(req, { error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  if (!body.student_id || !body.sequence_id) return jsonResponse(req, { error: "validation_missing_fields" }, 422);

  const db = supabaseAdmin();
  const { data: student } = await db.from("students").select("id, first_name, last_name, class_id").eq("id", body.student_id).eq("establishment_id", caller.establishment_id).maybeSingle();
  if (!student) return jsonResponse(req, { error: "student_not_found" }, 404);

  let authorized = TEMPLATE_MANAGE_ROLES.includes(caller.roleCode);
  if (!authorized && caller.roleCode === "professeur_principal" && student.class_id) {
    const { data } = await db.from("classes").select("id").eq("id", student.class_id).eq("homeroom_teacher_id", caller.id).maybeSingle();
    authorized = !!data;
  }
  if (!authorized) return jsonResponse(req, { error: "student_manage_denied" }, 403);
  if (!student.class_id) return jsonResponse(req, { error: "student_no_class" }, 422);

  const { data: activeSub } = await db.from("bulletin_subscriptions").select("id").eq("student_id", student.id).eq("status", "active").maybeSingle();
  if (!activeSub) return jsonResponse(req, { error: "bulletin_subscription_required" }, 403);

  const { data: sequence } = await db.from("sequences").select("id, label").eq("id", body.sequence_id).eq("establishment_id", caller.establishment_id).maybeSingle();
  if (!sequence) return jsonResponse(req, { error: "sequence_not_found" }, 404);

  const { data: gradesForSequence } = await db
    .from("grades")
    .select("score, class_subject_id")
    .eq("sequence_id", sequence.id)
    .eq("student_id", student.id);
  const scoreByClassSubject = new Map((gradesForSequence ?? []).map((g: any) => [g.class_subject_id, g.score]));

  const { data: classSubjectRows } = await db.from("class_subjects").select("id, coefficient, subjects(name)").eq("class_id", student.class_id);
  const subjects = (classSubjectRows ?? []).map((cs: any) => ({
    subject_name: cs.subjects?.name, coefficient: cs.coefficient, score: scoreByClassSubject.get(cs.id) ?? null,
  })).sort((a: any, b: any) => String(a.subject_name).localeCompare(String(b.subject_name)));

  const gradedCount = subjects.filter((s: any) => s.score !== null).length;
  if (gradedCount === 0) return jsonResponse(req, { error: "bulletin_no_grades" }, 422);

  const { data: template } = await db.from("bulletin_templates").select("storage_path, mime_type").eq("class_id", student.class_id).maybeSingle();
  let imageBase64: string | null = null;
  let imageMime: string | null = null;
  if (template) {
    const { data: fileBlob } = await db.storage.from("bulletin-templates").download(template.storage_path);
    if (fileBlob) {
      imageBase64 = btoa(String.fromCharCode(...new Uint8Array(await fileBlob.arrayBuffer())));
      imageMime = template.mime_type;
    }
  }

  const userPrompt = `Élève : ${student.first_name} ${student.last_name} — Séquence : ${sequence.label}\n\nNotes par matière (sur 20, coefficient) :\n${JSON.stringify(subjects)}`;

  let result: any;
  try {
    result = await openAiCompleteJson(
      [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: userPrompt }],
      imageBase64, imageMime,
    );
  } catch (e) {
    const msg = e instanceof AiError ? e.message : "ai_provider_error";
    return jsonResponse(req, { error: msg.split(":")[0] }, msg === "ai_not_configured" ? 503 : 502);
  }

  const model = Deno.env.get("OPENAI_MODEL")!;
  const { data: existing } = await db.from("bulletins").select("id, verification_code").eq("student_id", student.id).eq("sequence_id", sequence.id).maybeSingle();

  let bulletinId: string;
  let verificationCode: string;
  let createdAt: string;
  if (existing) {
    // verification_code n'est JAMAIS régénéré sur une régénération — un
    // bulletin déjà imprimé avec son QR code doit rester vérifiable.
    verificationCode = existing.verification_code;
    const { data: updated } = await db.from("bulletins").update({
      content: result, ai_model: model, generated_by_profile_id: caller.id, created_at: new Date().toISOString(),
    }).eq("id", existing.id).select("id, created_at").single();
    bulletinId = updated!.id;
    createdAt = updated!.created_at;
  } else {
    verificationCode = generateVerificationCode();
    const { data: created } = await db.from("bulletins").insert({
      establishment_id: caller.establishment_id, student_id: student.id, sequence_id: sequence.id,
      content: result, ai_model: model, generated_by_profile_id: caller.id, verification_code: verificationCode,
    }).select("id, created_at").single();
    bulletinId = created!.id;
    createdAt = created!.created_at;
  }

  await auditLog({
    establishmentId: caller.establishment_id, profileId: caller.id,
    action: "bulletin.generated", entityType: "bulletin", entityId: bulletinId, ipAddress: requestIp(req),
  });

  return jsonResponse(req, {
    success: true,
    data: { id: bulletinId, created_at: createdAt, verification_code: verificationCode, content: result },
  }, 201);
});
