import { supabaseAdmin } from "./supabase-admin.ts";

/**
 * Remplace backend/middleware/RateLimitMiddleware.php.
 * bucket ex: "login", "register-establishment", "forgot-password".
 * Retourne true si la limite est dépassée (requête à rejeter avec 429).
 */
export async function isRateLimited(
  req: Request,
  bucket: string,
  maxHits: number,
  windowSeconds: number,
): Promise<boolean> {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("cf-connecting-ip") ??
    "unknown";
  const bucketKey = `${bucket}:${ip}`;
  const db = supabaseAdmin();

  const since = new Date(Date.now() - windowSeconds * 1000).toISOString();
  const { count } = await db
    .from("rate_limit_hits")
    .select("id", { count: "exact", head: true })
    .eq("bucket_key", bucketKey)
    .gte("created_at", since);

  await db.from("rate_limit_hits").insert({ bucket_key: bucketKey });

  return (count ?? 0) >= maxHits;
}
