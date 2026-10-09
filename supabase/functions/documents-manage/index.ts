// POST /documents-manage  (multipart, action="upload": file, category, title, student_id?)
// POST /documents-manage  (JSON, { action: "destroy", document_id })
// Remplace DocumentController::create() + destroy(). L'accès (documents.manage)
// est vérifié par la RLS via asCaller() pour la lecture/écriture des
// métadonnées ; le client service_role n'intervient que pour le Storage.
import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase-admin.ts";
import { getCallerProfile, asCaller } from "../_shared/caller.ts";
import { auditLog, requestIp } from "../_shared/audit.ts";

const STUDENT_CATEGORIES = ["bulletin", "birth_certificate", "medical_certificate", "photo", "diploma"];
const ESTABLISHMENT_CATEGORIES = ["timetable", "circular", "administrative_note"];
const MAX_FILE_BYTES = 15 * 1024 * 1024;

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
    const studentId = form.get("student_id")?.toString() || null;
    const file = form.get("file");

    if (!category || !title) return jsonResponse(req, { error: "validation_missing_fields" }, 422);
    if (![...STUDENT_CATEGORIES, ...ESTABLISHMENT_CATEGORIES].includes(category)) {
      return jsonResponse(req, { error: "document_category_invalid" }, 422);
    }
    if (STUDENT_CATEGORIES.includes(category) && !studentId) {
      return jsonResponse(req, { error: "document_student_required" }, 422);
    }
    if (!(file instanceof File)) return jsonResponse(req, { error: "document_file_required" }, 422);
    if (file.size > MAX_FILE_BYTES) return jsonResponse(req, { error: "document_upload_file_too_large" }, 422);

    if (studentId) {
      const { data: student } = await cc.from("students").select("id").eq("id", studentId).eq("establishment_id", caller.establishment_id).maybeSingle();
      if (!student) return jsonResponse(req, { error: "student_not_found" }, 404);
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `${caller.establishment_id}/${Date.now()}-${safeName}`;
    const { error: uploadError } = await db.storage.from("documents").upload(storagePath, file, {
      contentType: file.type || "application/octet-stream",
    });
    if (uploadError) return jsonResponse(req, { error: "document_upload_error" }, 500);

    const { data: document, error: insertError } = await cc
      .from("documents")
      .insert({
        establishment_id: caller.establishment_id, student_id: studentId, category, title,
        storage_path: storagePath, original_filename: file.name,
        mime_type: file.type || "application/octet-stream", file_size_bytes: file.size,
        uploaded_by_profile_id: caller.id,
      })
      .select("id")
      .single();
    if (insertError || !document) {
      await db.storage.from("documents").remove([storagePath]);
      return jsonResponse(req, { error: "document_manage_denied" }, 403);
    }

    return jsonResponse(req, { success: true, data: { id: document.id } }, 201);
  }

  const body = await req.json().catch(() => ({}));
  if (body.action === "destroy") {
    if (!body.document_id) return jsonResponse(req, { error: "validation_missing_fields" }, 422);

    const { data: doc } = await cc.from("documents").select("id, storage_path, deleted_at").eq("id", body.document_id).maybeSingle();
    if (!doc) return jsonResponse(req, { error: "document_not_found" }, 404);
    if (!doc.deleted_at) return jsonResponse(req, { error: "document_must_be_trashed_first" }, 409);

    const { error: deleteError } = await cc.from("documents").delete().eq("id", doc.id);
    if (deleteError) return jsonResponse(req, { error: "document_manage_denied" }, 403);

    await db.storage.from("documents").remove([doc.storage_path]);

    await auditLog({
      establishmentId: caller.establishment_id, profileId: caller.id,
      action: "document.deleted", entityType: "document", entityId: doc.id, ipAddress: requestIp(req),
    });
    return jsonResponse(req, { success: true });
  }

  return jsonResponse(req, { error: "unknown_action" }, 400);
});
