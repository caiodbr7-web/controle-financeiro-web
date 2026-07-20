// Cabecalhos CORS reutilizados pelas Edge Functions.
// O front (Netlify) chama estas funcoes via fetch, entao precisamos liberar CORS.
// Defina o secret ALLOWED_ORIGIN (ex.: https://seu-app.netlify.app) para
// restringir ao seu dominio; sem ele mantem "*" para nao quebrar nada.
export const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
