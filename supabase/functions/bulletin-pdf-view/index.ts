// GET /bulletin-pdf-view?id=...&token=...
// Remplace BulletinController::pdf(). HORS PÉRIMÈTRE annoncé à l'étape 13 :
// pas de vraie génération PDF serveur (mPDF) — reproduit plutôt le repli que
// le PHP d'origine utilisait déjà lui-même quand mPDF n'était pas installé :
// une page HTML imprimable (Ctrl+P / "Enregistrer en PDF" du navigateur).
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

  const { data: bulletin } = await cc
    .from("bulletins")
    .select("content, verification_code, created_at, students(first_name, last_name, matricule), sequences(label), establishments(name, code)")
    .eq("id", id)
    .maybeSingle();
  if (!bulletin) return new Response("bulletin_not_found", { status: 404 });

  const student = (bulletin as any).students;
  const establishment = (bulletin as any).establishments;
  const sequence = (bulletin as any).sequences;
  const content = bulletin.content as any;

  const rows = (content.subjects ?? [])
    .map((s: any) => `<tr><td>${escapeHtml(s.subject_name)}</td><td>${escapeHtml(s.coefficient)}</td><td>${escapeHtml(s.score ?? "—")}</td><td>${escapeHtml(s.appreciation ?? "")}</td></tr>`)
    .join("");

  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
<title>Bulletin — ${escapeHtml(student?.first_name)} ${escapeHtml(student?.last_name)}</title>
<style>
  body { font-family: Arial, sans-serif; padding: 32px; color: #1a1a1a; }
  h1 { font-size: 20px; margin-bottom: 0; } h2 { font-size: 15px; color: #555; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; margin-top: 24px; }
  th, td { border: 1px solid #ccc; padding: 8px; text-align: left; font-size: 14px; }
  th { background: #f2f2f2; }
  .meta { margin-top: 24px; font-size: 14px; } .footer { margin-top: 32px; font-size: 12px; color: #777; }
  @media print { body { padding: 0; } }
</style></head><body>
<h1>${escapeHtml(establishment?.name)}</h1>
<h2>Bulletin — ${escapeHtml(sequence?.label)}</h2>
<div class="meta"><strong>${escapeHtml(student?.first_name)} ${escapeHtml(student?.last_name)}</strong> — Matricule : ${escapeHtml(student?.matricule)}</div>
<table><thead><tr><th>Matière</th><th>Coefficient</th><th>Note</th><th>Appréciation</th></tr></thead><tbody>${rows}</tbody></table>
<div class="meta"><strong>Moyenne générale : ${escapeHtml(content.average)}/20</strong></div>
<div class="meta">${escapeHtml(content.general_appreciation ?? "")}</div>
<div class="footer">Code de vérification : ${escapeHtml(bulletin.verification_code)} — ${escapeHtml(establishment?.code)}<br>
Utilisez la fonction "Imprimer" ou "Enregistrer au format PDF" de votre navigateur pour conserver ce document.</div>
</body></html>`;

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Access-Control-Allow-Origin": "*" } });
});
