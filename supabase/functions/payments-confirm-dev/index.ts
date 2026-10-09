// POST /payments-confirm-dev  { payment_id, success? }
// Remplace PaymentController::confirm(). ⚠️ SIMULATEUR DE DÉVELOPPEMENT :
// remplace le webhook signé Orange Money / MTN MoMo qui devra être branché
// avant toute mise en production (voir avertissement en tête de la
// migration 0011). Désactivé si le secret APP_DEBUG n'est pas "true".
//
// Depuis la migration 0018, un client ne peut plus confirmer lui-même un paiement
// mobile money (faille d'auto-validation). La lecture passe par asCaller() (la RLS
// vérifie que le paiement appartient bien à l'appelant), puis la mise à jour est
// faite avec le service role, uniquement si APP_DEBUG=true. Le trigger
// payments_apply_effects (migration 0011) applique les effets
// (facture soldée, abonnement activé, reçu généré) automatiquement. Cette
// fonction ne s'occupe que des emails d'activation (Premium, Concours,
// Bulletins IA), qui nécessitent un envoi externe.
import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase-admin.ts";
import { getCallerProfile, asCaller } from "../_shared/caller.ts";
import { auditLog, requestIp } from "../_shared/audit.ts";
import { sendEmail } from "../_shared/notify.ts";

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405);

  if (Deno.env.get("APP_DEBUG") !== "true") {
    return jsonResponse(req, { error: "route_not_found" }, 404);
  }

  const caller = await getCallerProfile(req);
  if (!caller) return jsonResponse(req, { error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  if (!body.payment_id) return jsonResponse(req, { error: "validation_missing_fields" }, 422);
  const success = body.success !== false;

  const cc = asCaller(req);
  const { data: payment } = await cc.from("payments").select("id, status, premium_subscription_id, concours_subscription_id, bulletin_subscription_id, provider_reference").eq("id", body.payment_id).maybeSingle();
  if (!payment) return jsonResponse(req, { error: "payment_not_found" }, 404);
  if (payment.status !== "pending") return jsonResponse(req, { error: "payment_not_pending" }, 409);

  const { error: updateError } = await supabaseAdmin().from("payments")
    .update({ status: success ? "completed" : "failed" }).eq("id", payment.id).eq("status", "pending");
  if (updateError) return jsonResponse(req, { error: "payment_confirmation_error" }, 500);

  await auditLog({
    establishmentId: caller.establishment_id, profileId: caller.id,
    action: success ? "payment.confirmed" : "payment.failed", entityType: "payment", entityId: payment.id,
    ipAddress: requestIp(req),
  });

  if (success && payment.premium_subscription_id) {
    const db = supabaseAdmin();
    const { data: sub } = await db
      .from("premium_subscriptions")
      .select("parent_id, establishment_id, profiles!premium_subscriptions_parent_id_fkey(email, first_name)")
      .eq("id", payment.premium_subscription_id)
      .single();
    const parent = (sub as any)?.profiles;
    if (parent) {
      await sendEmail(parent.email, "SCHOOLAR — Premium Parents activé",
        `Bonjour ${parent.first_name},\n\nVotre abonnement Premium Parents (500 FCFA/mois) est désormais actif. Vous avez accès au suivi renforcé de la scolarité de votre enfant.`);
      await db.from("notifications").insert({
        user_id: sub.parent_id, establishment_id: sub.establishment_id, type: "premium",
        title: "Premium Parents activé", body: "Votre abonnement Premium Parents est actif pour 1 mois.",
        link: "#/my-children",
      });
    }
  }

  if (success && payment.concours_subscription_id) {
    const db = supabaseAdmin();
    const { data: sub } = await db
      .from("concours_subscriptions")
      .select("student_id, establishment_id, tier, students(first_name, last_name, student_parents(profiles!student_parents_parent_id_fkey(email, first_name, status)))")
      .eq("id", payment.concours_subscription_id)
      .single();
    const student = (sub as any)?.students;
    for (const link of student?.student_parents ?? []) {
      const parent = link.profiles;
      if (!parent || parent.status !== "active") continue;
      await sendEmail(parent.email, "SCHOOLAR — Préparation aux concours activée",
        `Bonjour ${parent.first_name},\n\nL'abonnement Préparation aux concours (${sub.tier === "unlimited" ? "illimité" : "limité"}) de ${student.first_name} ${student.last_name} est désormais actif.`);
    }
  }

  if (success && payment.bulletin_subscription_id) {
    const db = supabaseAdmin();
    const { data: sub } = await db
      .from("bulletin_subscriptions")
      .select("student_id, establishment_id, students(first_name, last_name, student_parents(profiles!student_parents_parent_id_fkey(email, first_name, status)))")
      .eq("id", payment.bulletin_subscription_id)
      .single();
    const student = (sub as any)?.students;
    for (const link of student?.student_parents ?? []) {
      const parent = link.profiles;
      if (!parent || parent.status !== "active") continue;
      await sendEmail(parent.email, "SCHOOLAR — Bulletins pilotés par IA activés",
        `Bonjour ${parent.first_name},\n\nL'abonnement Bulletins pilotés par IA de ${student.first_name} ${student.last_name} est désormais actif pour l'année scolaire en cours.`);
    }
  }

  return jsonResponse(req, { success: true, message: success ? "payment_confirmed" : "payment_failed_msg", data: {} });
});
