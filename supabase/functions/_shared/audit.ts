import { supabaseAdmin } from "./supabase-admin.ts";

// Remplace Core\Auth::log(). Toujours appelé avec le client service_role
// (les Edge Functions sont le SEUL point d'écriture dans audit_log).
export async function auditLog(entry: {
  establishmentId?: string | null;
  profileId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  details?: Record<string, unknown> | null;
  ipAddress?: string | null;
}) {
  const db = supabaseAdmin();
  await db.from("audit_log").insert({
    establishment_id: entry.establishmentId ?? null,
    profile_id: entry.profileId ?? null,
    action: entry.action,
    entity_type: entry.entityType ?? null,
    entity_id: entry.entityId ?? null,
    details: entry.details ?? null,
    ip_address: entry.ipAddress ?? null,
  });
}

export function requestIp(req: Request): string | null {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? null;
}
