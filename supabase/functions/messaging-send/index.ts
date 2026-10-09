// POST /messaging-send  { conversation_id, body }
// Remplace MessagingController::send() + notifyRecipient(). L'insert du
// message passe par asCaller() (RLS = assertParticipant natif) ; seuls
// l'email et l'insert dans `notifications` (aucune policy INSERT côté
// client) utilisent le client service_role.
import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase-admin.ts";
import { getCallerProfile, asCaller } from "../_shared/caller.ts";
import { sendEmail } from "../_shared/notify.ts";

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);

  const caller = await getCallerProfile(req);
  if (!caller) return jsonResponse(req, { error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const text = String(body.body ?? "").trim();
  if (!body.conversation_id || !text) return jsonResponse(req, { error: "messaging_body_required" }, 422);

  const cc = asCaller(req);
  const { data: message, error: insertError } = await cc
    .from("messages")
    .insert({ conversation_id: body.conversation_id, sender_id: caller.id, body: text })
    .select("id, created_at")
    .single();
  if (insertError || !message) return jsonResponse(req, { error: "messaging_access_denied" }, 403);

  await cc.from("conversation_participants").update({ last_read_at: new Date().toISOString() })
    .eq("conversation_id", body.conversation_id).eq("user_id", caller.id);

  const db = supabaseAdmin();
  const { data: sender } = await db.from("profiles").select("first_name, last_name").eq("id", caller.id).single();
  const senderName = sender ? `${sender.first_name} ${sender.last_name}` : "un membre de SCHOOLAR";

  const { data: recipients } = await db
    .from("conversation_participants")
    .select("profiles!conversation_participants_user_id_fkey(id, email, first_name, establishment_id, status)")
    .eq("conversation_id", body.conversation_id)
    .neq("user_id", caller.id);

  for (const link of recipients ?? []) {
    const recipient = (link as any).profiles;
    if (!recipient || recipient.status !== "active") continue;

    await sendEmail(recipient.email, "SCHOOLAR — Nouveau message",
      `Bonjour ${recipient.first_name},\n\nVous avez reçu un nouveau message de ${senderName} sur SCHOOLAR.\n\nConnectez-vous pour le lire et y répondre.`);

    // Note : le trigger messages_notify_participants (migration 0010) crée déjà
    // la notification in-app à l'insert du message ; on ne la duplique pas ici.
  }

  return jsonResponse(req, { success: true, data: { id: message.id, created_at: message.created_at } }, 201);
});
