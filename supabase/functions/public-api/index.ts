// GET /public-api?resource=establishment
// GET /public-api?resource=students
// GET /public-api?resource=student_grades&student_id=...
// Authentification par clé d'API (Authorization: Bearer sch_xxx), PAS par
// JWT Supabase — remplace ApiKeyMiddleware + PublicApiController. La clé est
// vérifiée via verify_api_key() (SQL, hache et compare, jamais la clé en
// clair ne transite par une comparaison JS) ; scope requis par ressource,
// comme le PHP d'origine.
import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase-admin.ts";

const SCOPE_BY_RESOURCE: Record<string, string> = {
  establishment: "establishment.read",
  students: "students.read",
  student_grades: "grades.read",
};

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  if (req.method !== "GET") return jsonResponse(req, { error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("authorization") ?? "";
  const apiKey = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!apiKey || !apiKey.startsWith("sch_")) {
    return jsonResponse(req, { error: "api_key_invalid" }, 401);
  }

  const url = new URL(req.url);
  const resource = url.searchParams.get("resource");
  const scope = resource ? SCOPE_BY_RESOURCE[resource] : null;
  if (!scope) return jsonResponse(req, { error: "resource_not_found" }, 404);

  const db = supabaseAdmin();
  const { data: establishmentId, error } = await db.rpc("verify_api_key", { p_key: apiKey, p_scope: scope });
  if (error || !establishmentId) return jsonResponse(req, { error: "api_key_invalid" }, 401);

  if (resource === "establishment") {
    const { data } = await db.from("establishments").select("code, name, establishment_type, teaching_type, region, department").eq("id", establishmentId).single();
    return jsonResponse(req, { establishment: data });
  }

  if (resource === "students") {
    const { data } = await db
      .from("students").select("id, matricule, first_name, last_name, sex")
      .eq("establishment_id", establishmentId).eq("status", "active")
      .order("last_name").limit(500);
    return jsonResponse(req, { students: data ?? [] });
  }

  if (resource === "student_grades") {
    const studentId = url.searchParams.get("student_id");
    if (!studentId) return jsonResponse(req, { error: "validation_missing_fields" }, 422);

    const { data: student } = await db.from("students").select("id").eq("id", studentId).eq("establishment_id", establishmentId).maybeSingle();
    if (!student) return jsonResponse(req, { error: "student_not_found" }, 404);

    const { data: grades } = await db
      .from("grades")
      .select("score, sequences(label, order_index), class_subjects(coefficient, subjects(name))")
      .eq("student_id", studentId).not("score", "is", null);

    const shaped = (grades ?? [])
      .sort((a: any, b: any) => (a.sequences?.order_index ?? 0) - (b.sequences?.order_index ?? 0))
      .map((g: any) => ({
        sequence_label: g.sequences?.label, subject_name: g.class_subjects?.subjects?.name,
        coefficient: g.class_subjects?.coefficient, score: g.score,
      }));
    return jsonResponse(req, { grades: shaped });
  }

  return jsonResponse(req, { error: "resource_not_found" }, 404);
});
