// POST /library-manage  (multipart, action="upload": file, category, title, description?, level?, subject_id?)
// POST /library-manage  (JSON, { action: "destroy", resource_id })
// Remplace LibraryController::create() + destroy().
import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase-admin.ts";
import { getCallerProfile, asCaller } from "../_shared/caller.ts";
import { auditLog, requestIp } from "../_shared/audit.ts";

const CATEGORIES = ["book", "pdf", "exercise", "past_exam", "answer_key", "video", "podcast", "interactive_course"];
const MAX_FILE_BYTES = 200 * 1024 * 1024; // 200 Mo (vidéos/podcasts)

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);

  const caller = await getCallerProfile(req);
  if (!caller) return jsonResponse(req, { error: "unauthorized" }, 401);

  const contentType = req.headers.get("content-type") ?? "";
  const cc = asCaller(req);
  const db = supabaseAdmin();

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    if (!form) return jsonResponse(req, { error: "validation_missing_fields" }, 422);

    const category = form.get("category")?.toString();
    const title = form.get("title")?.toString();
    const description = form.get("description")?.toString() || null;
    const level = form.get("level")?.toString() || null;
    const subjectId = form.get("subject_id")?.toString() || null;
    const file = form.get("file");

    if (!category || !title) return jsonResponse(req, { error: "validation_missing_fields" }, 422);
    if (!CATEGORIES.includes(category)) return jsonResponse(req, { error: "library_category_invalid" }, 422);
    if (!(file instanceof File)) return jsonResponse(req, { error: "library_file_required" }, 422);
    if (file.size > MAX_FILE_BYTES) return jsonResponse(req, { error: "library_upload_file_too_large" }, 422);

    if (subjectId) {
      const { data: subject } = await cc.from("subjects").select("id").eq("id", subjectId).eq("establishment_id", caller.establishment_id).maybeSingle();
      if (!subject) return jsonResponse(req, { error: "subject_not_found" }, 404);
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `${caller.establishment_id}/${Date.now()}-${safeName}`;
    const { error: uploadError } = await db.storage.from("library").upload(storagePath, file, {
      contentType: file.type || "application/octet-stream",
    });
    if (uploadError) return jsonResponse(req, { error: "library_upload_error" }, 500);

    const { data: resource, error: insertError } = await cc
      .from("library_resources")
      .insert({
        establishment_id: caller.establishment_id, category, title, description, level, subject_id: subjectId,
        storage_path: storagePath, original_filename: file.name,
        mime_type: file.type || "application/octet-stream", file_size_bytes: file.size,
        uploaded_by_profile_id: caller.id,
      })
      .select("id")
      .single();
    if (insertError || !resource) {
      await db.storage.from("library").remove([storagePath]);
      return jsonResponse(req, { error: "library_manage_denied" }, 403);
    }

    return jsonResponse(req, { success: true, data: { id: resource.id } }, 201);
  }

  const body = await req.json().catch(() => ({}));
  if (body.action === "destroy") {
    if (!body.resource_id) return jsonResponse(req, { error: "validation_missing_fields" }, 422);

    const { data: resource } = await cc.from("library_resources").select("id, storage_path, deleted_at").eq("id", body.resource_id).maybeSingle();
    if (!resource) return jsonResponse(req, { error: "library_resource_not_found" }, 404);
    if (!resource.deleted_at) return jsonResponse(req, { error: "library_must_be_trashed_first" }, 409);

    const { error: deleteError } = await cc.from("library_resources").delete().eq("id", resource.id);
    if (deleteError) return jsonResponse(req, { error: "library_manage_denied" }, 403);

    await db.storage.from("library").remove([resource.storage_path]);

    await auditLog({
      establishmentId: caller.establishment_id, profileId: caller.id,
      action: "library.resource_deleted", entityType: "library_resource", entityId: resource.id, ipAddress: requestIp(req),
    });
    return jsonResponse(req, { success: true });
  }

  return jsonResponse(req, { error: "unknown_action" }, 400);
});
