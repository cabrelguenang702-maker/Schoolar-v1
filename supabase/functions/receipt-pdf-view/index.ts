// GET /receipt-pdf-view?id=...&token=...
// Remplace la variante PDF de PaymentController::receipt() — même repli
// "page imprimable" qu'à bulletin-pdf-view.
import { handleOptions } from "../_shared/cors.ts";
import { callerFromQueryToken } from "../_shared/query-auth.ts";

function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const cc = callerFromQueryToken(req);
  if (!id || !cc) return new Response("validation_missing_fields", { status: 422 });

  const { data: receipt, error } = await cc.rpc("payment_receipt", { p_payment_id: id });
  if (error || !receipt) return new Response("receipt_not_available", { status: 404 });

  const payment = receipt.payment;
  const student = receipt.student;
  const establishment = receipt.establishment;

  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
<title>Reçu — ${escapeHtml(payment.receipt_number)}</title>
<style>
  body { font-family: Arial, sans-serif; padding: 32px; color: #1a1a1a; }
  h1 { font-size: 18px; } table { width: 100%; border-collapse: collapse; margin-top: 20px; }
  td { padding: 8px; border-bottom: 1px solid #eee; font-size: 14px; }
  .total { font-size: 18px; font-weight: bold; margin-top: 20px; }
  .footer { margin-top: 32px; font-size: 12px; color: #777; }
  @media print { body { padding: 0; } }
</style></head><body>
<h1>${escapeHtml(establishment?.name)} — Reçu de paiement</h1>
<table>
  <tr><td>N° de reçu</td><td>${escapeHtml(payment.receipt_number)}</td></tr>
  <tr><td>Date</td><td>${escapeHtml(payment.paid_at)}</td></tr>
  <tr><td>Élève</td><td>${escapeHtml(student?.first_name)} ${escapeHtml(student?.last_name)} (${escapeHtml(student?.matricule)})</td></tr>
  <tr><td>Motif</td><td>${escapeHtml(receipt.label)}</td></tr>
  <tr><td>Méthode</td><td>${escapeHtml(payment.method)}</td></tr>
</table>
<div class="total">Montant payé : ${escapeHtml(payment.amount)} FCFA</div>
<div class="footer">Utilisez la fonction "Imprimer" ou "Enregistrer au format PDF" de votre navigateur pour conserver ce reçu.</div>
</body></html>`;

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Access-Control-Allow-Origin": "*" } });
});
