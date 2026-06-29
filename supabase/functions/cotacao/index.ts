// ============================================================================
//  Edge Function: cotacao
//
//  Cotação de mercado de tickers (ex.: ETF "VT") + câmbio USD->BRL. Existe
//  porque o navegador não pode chamar provedores de cotação direto (CORS): o
//  front (aba Investimentos) chama esta função para precificar as posições
//  MANUAIS que têm `ticker`.
//
//  Fontes gratuitas, sem API key:
//   • Preço dos ativos: Yahoo Finance (endpoint /v8/finance/chart).
//   • Câmbio p/ BRL: open.er-api.com (principal) + frankfurter.app/BCE (reserva).
//
//  Requer apenas o JWT do usuário logado (não vira proxy aberto).
//
//  Deploy:
//    supabase functions deploy cotacao
//
//  Chamada (frontend, src/lib/pluggy.ts -> fetchCotacoes):
//    POST /functions/v1/cotacao
//    Authorization: Bearer <jwt do usuário>
//    body: { "tickers": ["VT", "BND"] }
//    resposta: { ok, fonte:"yahoo", usdbrl: number|null,
//                quotes: { "VT": { price: 118.34, currency: "USD" }, ... } }
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

const UA = { "User-Agent": "Mozilla/5.0 (compatible; controle-financeiro/1.0)" };

// taxa de UMA moeda -> BRL (open.er-api.com principal; frankfurter.app reserva)
async function taxaBRL(cur: string): Promise<number | null> {
  try {
    const r = await fetch(`https://open.er-api.com/v6/latest/${cur}`, { headers: UA });
    if (r.ok) {
      const j = await r.json();
      const p = j?.rates?.BRL;
      if (typeof p === "number" && Number.isFinite(p)) return p;
    }
  } catch { /* tenta a reserva */ }
  try {
    const r = await fetch(`https://api.frankfurter.app/latest?from=${cur}&to=BRL`, { headers: UA });
    if (r.ok) {
      const j = await r.json();
      const p = j?.rates?.BRL;
      if (typeof p === "number" && Number.isFinite(p)) return p;
    }
  } catch { /* desiste */ }
  return null;
}

// preço de mercado via Yahoo Finance. US: ticker puro (VT); outras bolsas usam
// o sufixo do Yahoo (ex.: PETR4.SA). Devolve preço + moeda do ativo.
async function yahooQuote(ticker: string): Promise<{ price: number; currency: string } | null> {
  try {
    const r = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`,
      { headers: UA },
    );
    if (!r.ok) return null;
    const j = await r.json();
    const meta = j?.chart?.result?.[0]?.meta;
    const p = meta?.regularMarketPrice;
    if (typeof p === "number" && Number.isFinite(p)) return { price: p, currency: meta?.currency ?? "USD" };
  } catch { /* ignora -> front mantém o último preço */ }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authorization = req.headers.get("Authorization") ?? "";
    if (!authorization) return json({ error: "Sem token de autenticação" }, 401);

    // valida o usuário (RLS / anti-abuso); a cotação em si não é por usuário
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authorization } },
    });
    const { data: userData, error: userErr } = await sb.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Usuário inválido" }, 401);

    let tickers: string[] = [];
    try {
      const body = await req.json();
      if (Array.isArray(body?.tickers)) tickers = body.tickers.filter((t: unknown) => typeof t === "string" && t.trim());
    } catch { /* corpo vazio -> só o câmbio */ }

    const unicos = [...new Set(tickers.map((t) => t.trim().toUpperCase()).filter(Boolean))];

    // preços (Yahoo, em paralelo) + câmbio USD->BRL — independentes
    const [precos, usdbrl] = await Promise.all([
      Promise.all(unicos.map((t) => yahooQuote(t).then((q) => [t, q] as const))),
      taxaBRL("USD"),
    ]);

    const quotes: Record<string, { price: number; currency: string }> = {};
    for (const [t, q] of precos) if (q) quotes[t] = q;

    return json({ ok: true, fonte: "yahoo", usdbrl, quotes });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
