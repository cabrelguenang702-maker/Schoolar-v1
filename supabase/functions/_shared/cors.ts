// Autorise le frontend SCHOOLAR (Netlify + previews) à appeler les Edge
// Functions. Reprend le principe multi-origines de l'ancien CORS PHP
// (FRONTEND_ORIGINS séparées par des virgules dans les secrets de la fonction).
const allowedOrigins = (Deno.env.get("FRONTEND_ORIGINS") ?? "*")
  .split(",")
  .map((o) => o.trim());

export function corsHeaders(origin: string | null): HeadersInit {
  const allowOrigin =
    allowedOrigins.includes("*") || (origin && allowedOrigins.includes(origin))
      ? origin ?? "*"
      : allowedOrigins[0];

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-lang",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Content-Type": "application/json",
  };
}

export function jsonResponse(
  req: Request,
  body: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders(req.headers.get("origin")),
  });
}

export function handleOptions(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req.headers.get("origin")) });
  }
  return null;
}
