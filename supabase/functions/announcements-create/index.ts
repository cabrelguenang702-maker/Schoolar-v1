// POST /announcements-create  { title, body, audience, class_id? }
// Remplace AnnouncementController::create() + notifyAudience(). L'insert de
// l'annonce passe par asCaller() (RLS = mêmes règles que announcements_insert,
// pas de revérification manuelle des rôles) ; le fan-out (emails + lignes de
// notifications) utilise le client service_role car il touche des profils
// autres que l'appelant.
import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase-admin.ts";
import { getCallerProfile, asCaller } from "../_shared/caller.ts";
import { sendEmail } from "../_shared/notify.ts";

const AUDIENCES = ["all_establishment", "all_staff", "all_parents", "class"];

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);

  const caller = await getCallerProfile(req);
  if (!caller) return jsonResponse(req, { error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  if (!body.title || !body.body || !body.audience) return jsonResponse(req, { error: "validation_missing_fields" }, 422);
  if (!AUDIENCES.includes(body.audience)) return jsonResponse(req, { error: "announcement_audience_invalid", audiences: AUDIENCES }, 422);
  if (body.audience === "class" && !body.class_id) return jsonResponse(req, { error: "announcement_class_required" }, 422);

  const cc = asCaller(req);
  const { data: announcement, error: insertError } = await cc
    .from("announcements")
    .insert({
      establishment_id: caller.establishment_id,
      title: body.title, body: body.body, audience: body.audience,
      class_id: body.audience === "class" ? body.class_id : null,
      created_by_profile_id: caller.id,
    })
    .select("id")
    .single();

  if (insertError || !announcement) {
    // RLS a rejeté l'insert : soit audience interdite pour ce rôle, soit
    // classe non possédée (professeur essayant d'annoncer hors de sa classe).
    return jsonResponse(req, { error: "announcement_audience_denied" }, 403);
  }

  const db = supabaseAdmin();
  const { data: sender } = await db.from("profiles").select("first_name, last_name").eq("id", caller.id).single();
  const authorName = sender ? `${sender.first_name} ${sender.last_name}` : "L'administration";

  let recipientsQuery = db
    .from("profiles")
    .select("id, email, first_name, roles!inner(code, is_staff)")
    .eq("establishment_id", caller.establishment_id)
    .eq("status", "active");

  if (body.audience === "all_establishment") {
    recipientsQuery = recipientsQuery.neq("id", caller.id);
  } else if (body.audience === "all_staff") {
    recipientsQuery = recipientsQuery.eq("roles.is_staff", true).neq("id", caller.id);
  } else if (body.audience === "all_parents") {
    recipientsQuery = recipientsQuery.eq("roles.code", "parent");
  }

  let recipients: { id: string; email: string; first_name: string }[] = [];
  if (body.audience === "class") {
    const { data: parentIds } = await db
      .from("students")
      .select("student_parents(profiles!student_parents_parent_id_fkey(id, email, first_name, status))")
      .eq("class_id", body.class_id);
    const { data: klass } = await db.from("classes").select("homeroom_teacher_id").eq("id", body.class_id).single();
    const { data: subjectTeachers } = await db.from("class_subjects").select("teacher_id").eq("class_id", body.class_id).not("teacher_id", "is", null);

    const byId = new Map<string, { id: string; email: string; first_name: string }>();
    for (const s of parentIds ?? []) {
      for (const link of (s as any).student_parents ?? []) {
        const p = link.profiles;
        if (p && p.status === "active") byId.set(p.id, p);
      }
    }
    const staffIds = [klass?.homeroom_teacher_id, ...(subjectTeachers ?? []).map((r) => r.teacher_id)].filter(Boolean) as string[];
    if (staffIds.length) {
      const { data: staffProfiles } = await db.from("profiles").select("id, email, first_name, status").in("id", [...new Set(staffIds)]);
      for (const p of staffProfiles ?? []) if (p.status === "active") byId.set(p.id, p);
    }
    recipients = [...byId.values()];
  } else {
    const { data } = await recipientsQuery;
    recipients = (data ?? []).map((p: any) => ({ id: p.id, email: p.email, first_name: p.first_name }));
  }

  for (const recipient of recipients) {
    await sendEmail(recipient.email, `SCHOOLAR — ${body.title}`,
      `Bonjour ${recipient.first_name},\n\n${body.body}\n\n— ${authorName}, via SCHOOLAR`);

    await db.from("notifications").insert({
      user_id: recipient.id,
      establishment_id: caller.establishment_id,
      type: "announcement",
      title: body.title,
      body: body.body,
      link: "#/announcements",
    });
  }

  return jsonResponse(req, { success: true, data: { id: announcement.id, notified_count: recipients.length } }, 201);
});
