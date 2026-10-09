// GET /export-csv?resource=students|staff|grades|payments&token=...&...filtres
// Remplace ExportController (CSV uniquement — xlsx/pdf non couverts, comme le
// repli "impression navigateur" déjà prévu par le PHP d'origine pour le PDF).
import { handleOptions } from "../_shared/cors.ts";
import { callerFromQueryToken } from "../_shared/query-auth.ts";
import { auditLog } from "../_shared/audit.ts";
import { getCallerProfile } from "../_shared/caller.ts";

const EXPORT_ROLES = ["proviseur", "principal", "directeur", "censeur", "secretaire", "econome", "comptable"];

function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers, ...rows].map((r) => r.map(escape).join(";")).join("\n");
}

function csvResponse(filename: string, csv: string): Response {
  return new Response("\uFEFF" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}.csv"`,
      "Access-Control-Allow-Origin": "*",
    },
  });
}

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });

  const url = new URL(req.url);
  const resource = url.searchParams.get("resource");
  const cc = callerFromQueryToken(req);
  if (!cc || !resource) return new Response("validation_missing_fields", { status: 422 });

  const caller = await getCallerProfile(new Request(req.url, { headers: { authorization: `Bearer ${url.searchParams.get("token")}` } }));
  if (!caller || !EXPORT_ROLES.includes(caller.roleCode)) return new Response("student_manage_denied", { status: 403 });

  const today = new Date().toISOString().slice(0, 10);

  if (resource === "students") {
    const status = url.searchParams.get("status") || "active";
    let query = cc.from("students").select("matricule, last_name, first_name, sex, birth_date, parent_phone_1, status, classes(level, series, section)")
      .eq("establishment_id", caller.establishment_id).eq("status", status).order("last_name");
    const classId = url.searchParams.get("class_id");
    if (classId) query = query.eq("class_id", classId);
    const { data } = await query;

    const headers = ["Matricule", "Nom", "Prénom", "Sexe", "Date de naissance", "Niveau", "Série", "Section", "Téléphone parent", "Statut"];
    const rows = (data ?? []).map((s: any) => [s.matricule, s.last_name, s.first_name, s.sex, s.birth_date, s.classes?.level, s.classes?.series, s.classes?.section, s.parent_phone_1, s.status]);
    await auditLog({ establishmentId: caller.establishment_id, profileId: caller.id, action: "export.generated", details: { type: "eleves", rows: rows.length } });
    return csvResponse(`eleves_${today}`, toCsv(headers, rows));
  }

  if (resource === "staff") {
    const { data } = await cc.from("profiles").select("last_name, first_name, email, phone, status, roles!inner(label_fr, code)")
      .eq("establishment_id", caller.establishment_id)
      .not("roles.code", "in", "(proviseur,principal,directeur,admin_national,eleve,parent)")
      .order("last_name");
    const headers = ["Nom", "Prénom", "Email", "Téléphone", "Rôle", "Statut"];
    const rows = (data ?? []).map((u: any) => [u.last_name, u.first_name, u.email, u.phone, u.roles?.label_fr, u.status]);
    await auditLog({ establishmentId: caller.establishment_id, profileId: caller.id, action: "export.generated", details: { type: "personnel", rows: rows.length } });
    return csvResponse(`personnel_${today}`, toCsv(headers, rows));
  }

  if (resource === "grades") {
    const classId = url.searchParams.get("class_id");
    const sequenceId = url.searchParams.get("sequence_id");
    if (!classId || !sequenceId) return new Response("validation_missing_fields", { status: 422 });

    const { data: subjectRows } = await cc.from("class_subjects").select("id, coefficient, subjects(name)").eq("class_id", classId);
    const { data: students } = await cc.from("students").select("id, matricule, last_name, first_name").eq("class_id", classId).eq("status", "active").order("last_name");
    const { data: grades } = await cc.from("grades").select("score, student_id, class_subject_id").eq("sequence_id", sequenceId);
    const scoreMap = new Map((grades ?? []).map((g: any) => [`${g.student_id}:${g.class_subject_id}`, g.score]));

    const headers = ["Matricule", "Nom", "Prénom", "Matière", "Coefficient", "Note"];
    const rows: any[] = [];
    for (const s of students ?? []) {
      for (const cs of (subjectRows ?? []).sort((a: any, b: any) => String(a.subjects?.name).localeCompare(String(b.subjects?.name)))) {
        rows.push([s.matricule, s.last_name, s.first_name, (cs as any).subjects?.name, cs.coefficient, scoreMap.get(`${s.id}:${cs.id}`) ?? ""]);
      }
    }
    await auditLog({ establishmentId: caller.establishment_id, profileId: caller.id, action: "export.generated", details: { type: "notes", rows: rows.length } });
    return csvResponse(`notes_${today}`, toCsv(headers, rows));
  }

  if (resource === "payments") {
    const status = url.searchParams.get("status");
    let query = cc.from("payments")
      .select("created_at, paid_at, amount, method, status, receipt_number, student_fees(fee_structures(label), students(matricule, last_name, first_name))")
      .eq("establishment_id", caller.establishment_id).order("created_at", { ascending: false }).limit(5000);
    if (status) query = query.eq("status", status);
    const { data } = await query;

    const headers = ["Créé le", "Payé le", "Matricule", "Nom", "Prénom", "Frais", "Montant", "Méthode", "Statut", "N° reçu"];
    const rows = (data ?? []).map((p: any) => [
      p.created_at, p.paid_at, p.student_fees?.students?.matricule, p.student_fees?.students?.last_name,
      p.student_fees?.students?.first_name, p.student_fees?.fee_structures?.label, p.amount, p.method, p.status, p.receipt_number,
    ]);
    await auditLog({ establishmentId: caller.establishment_id, profileId: caller.id, action: "export.generated", details: { type: "paiements", rows: rows.length } });
    return csvResponse(`paiements_${today}`, toCsv(headers, rows));
  }

  return new Response("resource_not_found", { status: 404 });
});
