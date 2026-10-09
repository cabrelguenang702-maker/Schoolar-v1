// POST /bulletin-template-upload  (multipart : class_id, file)
// Remplace BulletinController::uploadTemplate().
import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase-admin.ts";
import { getCallerProfile } from "../_shared/caller.ts";
import { auditLog, requestIp } from "../_shared/audit.ts";

const TEMPLATE_MANAGE_ROLES = ["proviseur", "principal", "directeur", "censeur", "secretaire"];
const MAX_FILE_BYTES = 10 * 1024 * 1024;

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);

  const caller = await getCallerProfile(req);
  if (!caller || !TEMPLATE_MANAGE_ROLES.includes(caller.roleCode)) {
    return jsonResponse(req, { error: "student_manage_denied" }, 403);
  }

  const form = await req.formData().catch(() => null);
  if (!form) return jsonResponse(req, { error: "validation_missing_fields" }, 422);
  const classId = form.get("class_id")?.toString();
  const file = form.get("file");
  if (!classId) return jsonResponse(req, { error: "validation_missing_fields" }, 422);
  if (!(file instanceof File)) return jsonResponse(req, { error: "document_file_required" }, 422);
  if (file.size > MAX_FILE_BYTES) return jsonResponse(req, { error: "document_upload_file_too_large" }, 422);

  const db = supabaseAdmin();
  const { data: klass } = await db.from("classes").select("id").eq("id", classId).eq("establishment_id", caller.establishment_id).maybeSingle();
  if (!klass) return jsonResponse(req, { error: "class_not_found" }, 404);

  const { data: existing } = await db.from("bulletin_templates").select("id, storage_path").eq("class_id", classId).maybeSingle();

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${caller.establishment_id}/${classId}/${Date.now()}-${safeName}`;
  const { error: uploadError } = await db.storage.from("bulletin-templates").upload(storagePath, file, {
    contentType: file.type || "application/octet-stream",
  });
  if (uploadError) return jsonResponse(req, { error: "document_upload_error" }, 500);

  if (existing) {
    await db.from("bulletin_templates").update({
      storage_path: storagePath, original_filename: file.name, mime_type: file.type || "application/octet-stream",
      uploaded_by_profile_id: caller.id, created_at: new Date().toISOString(),
    }).eq("id", existing.id);
    await db.storage.from("bulletin-templates").remove([existing.storage_path]);
  } else {
    await db.from("bulletin_templates").insert({
      establishment_id: caller.establishment_id, class_id: classId, storage_path: storagePath,
      original_filename: file.name, mime_type: file.type || "application/octet-stream", uploaded_by_profile_id: caller.id,
    });
  }

  await auditLog({
    establishmentId: caller.establishment_id, profileId: caller.id,
    action: "bulletin_template.uploaded", entityType: "class", entityId: classId, ipAddress: requestIp(req),
  });

  return jsonResponse(req, { success: true });
});
