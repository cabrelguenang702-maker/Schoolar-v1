// POST /homework-download  { submission_id }             -> { url, expires_in }
// GET  /homework-download?id=...&token=...                -> 302 vers le fichier
// Remplace HomeworkController::download().
import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase-admin.ts";
import { asCaller } from "../_shared/caller.ts";
import { callerFromQueryToken } from "../_shared/query-auth.ts";

const SIGNED_URL_TTL_SECONDS = 300;

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;

  const db = supabaseAdmin();

  if (req.method === "GET") {
    const url = new URL(req.url);
    const submissionId = url.searchParams.get("id");
    const cc = callerFromQueryToken(req);
    if (!submissionId || !cc) return jsonResponse(req, { error: "validation_missing_fields" }, 422);

    const { data: submission } = await cc.from("homework_submissions").select("storage_path, original_filename").eq("id", submissionId).maybeSingle();
    if (!submission) return jsonResponse(req, { error: "homework_submission_not_found" }, 404);

    const { data: signed, error } = await db.storage.from("homework").createSignedUrl(submission.storage_path, SIGNED_URL_TTL_SECONDS, { download: submission.original_filename });
    if (error || !signed) return jsonResponse(req, { error: "server_error" }, 500);

    return Response.redirect(signed.signedUrl, 302);
  }

  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);

  const body = await req.json().catch(() => ({}));
  if (!body.submission_id) return jsonResponse(req, { error: "validation_missing_fields" }, 422);

  const cc = asCaller(req);
  const { data: submission } = await cc.from("homework_submissions").select("storage_path, original_filename").eq("id", body.submission_id).maybeSingle();
  if (!submission) return jsonResponse(req, { error: "homework_submission_not_found" }, 404);

  const { data: signed, error } = await db.storage.from("homework").createSignedUrl(submission.storage_path, SIGNED_URL_TTL_SECONDS, { download: submission.original_filename });
  if (error || !signed) return jsonResponse(req, { error: "server_error" }, 500);

  return jsonResponse(req, { success: true, data: { url: signed.signedUrl, expires_in: SIGNED_URL_TTL_SECONDS } });
});
