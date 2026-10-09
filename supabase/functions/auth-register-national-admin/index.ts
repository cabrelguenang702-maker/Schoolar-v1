// GET  /auth-register-national-admin  -> { available: boolean }
// POST /auth-register-national-admin  { first_name, last_name, email, phone?, password }
// Remplace AuthController::nationalAdminBootstrapStatus() + registerNationalAdmin().
// N'accepte qu'UNE SEULE inscription à vie (dès qu'un profil admin_national existe).
import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase-admin.ts";
import { auditLog, requestIp } from "../_shared/audit.ts";

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;

  const db = supabaseAdmin();

  const { count } = await db
    .from("profiles")
    .select("id, roles!inner(code)", { count: "exact", head: true })
    .eq("roles.code", "admin_national");

  const available = (count ?? 0) === 0;

  if (req.method === "GET") {
    return jsonResponse(req, { success: true, data: { available } });
  }

  if (req.method !== "POST") {
    return jsonResponse(req, { error: "method_not_allowed" }, 405);
  }

  if (!available) {
    return jsonResponse(req, { error: "national_admin_already_exists" }, 403);
  }

  const body = await req.json().catch(() => ({}));
  const { first_name, last_name, email, phone, password } = body;

  const missing = ["first_name", "last_name", "email", "password"].filter((k) => !body[k]);
  if (missing.length) {
    return jsonResponse(req, { error: "validation_missing_fields", missing }, 422);
  }
  if (String(password).length < 8) {
    return jsonResponse(req, { error: "admin_password_min_length" }, 422);
  }

  const { data: role } = await db
    .from("roles")
    .select("id")
    .eq("code", "admin_national")
    .single();

  const { data: created, error: createError } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // pas de flux de vérification par code pour le national admin
  });

  if (createError || !created?.user) {
    const isConflict = createError?.message?.toLowerCase().includes("already registered");
    return jsonResponse(
      req,
      { error: isConflict ? "national_admin_already_exists" : "server_error" },
      isConflict ? 409 : 500,
    );
  }

  const { error: profileError } = await db.from("profiles").insert({
    id: created.user.id,
    establishment_id: null,
    role_id: role!.id,
    first_name,
    last_name,
    email,
    phone: phone ?? null,
    status: "active",
    admin_verified_at: new Date().toISOString(),
  });

  if (profileError) {
    await db.auth.admin.deleteUser(created.user.id); // rollback manuel (pas de transaction inter-schémas)
    return jsonResponse(req, { error: "server_error" }, 500);
  }

  await auditLog({
    profileId: created.user.id,
    action: "national_admin.bootstrap_registered",
    entityType: "profile",
    entityId: created.user.id,
    ipAddress: requestIp(req),
  });

  return jsonResponse(req, { success: true, message: "national_admin_registered", data: {} }, 201);
});
