// ============================================================================
//  Edge Function: cotacao
//
//  Cotação de mercado de tickers (ex.: ETF "VT") + câmbio USD->BRL, lidos do
//  Stooq (https://stooq.com) — fonte gratuita, sem API key. Existe porque o
//  navegador não pode chamar provedores de cotação direto (CORS): o front
//  (aba Investimentos) chama esta função para precificar as posições MANUAIS
//  que têm `ticker`.
//
//  Não precisa de secret: o Stooq é público. Requer apenas o JWT do usuário
//  logado (mesmo padrão das outras funções) para não virar um proxy aberto.
//
//  Deploy:
//    supabase functions deploy cotacao
//
//  Chamada (frontend, src/lib/pluggy.ts -> fetchCotacoes):
//    POST /functions/v1/cotacao
//    Authorization: Bearer <jwt do usuário>
//    body: { "tickers": ["VT", "BND"] }
//    resposta: { ok, fonte:"stooq", usdbrl: number|null,
//                quotes: { "VT": { price: 118.34, currency: "USD" }, ... } }
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// "VT" -> "vt.us" (Stooq usa sufixo de bolsa). Se o usuário já mandou um sufixo
// (tem ponto), respeita; senão assume bolsa dos EUA (.us), o caso do VT/BND/etc.
function toStooq(ticker: string): string {
  const t = ticker.trim().toLowerCase();
  return t.includes(".") ? t : `${t}.us`;
}

// moeda inferida pelo sufixo do símbolo (o front também sabe a moeda_cotacao)
function moedaDe(sym: string): string {
  if (sym.endsWith(".us")) return "USD";
  if (sym.endsWith(".sa")) return "BRL";
  if (sym.endsWith(".uk")) return "GBP";
  if (sym.endsWith(".de")) return "EUR";
  return "USD";
}

// baixa o quote "light" do Stooq (CSV) p/ uma lista de símbolos
//   header: Symbol,Date,Time,Open,High,Low,Close,Volume
async function stooqQuotes(symbols: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!symbols.length) return out;
  const s = symbols.join(",");
  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(s)}&f=sd2t2ohlcv&h&e=csv`;
  const r = await fetch(url, { headers: { "User-Agent": "controle-financeiro/1.0" } });
  if (!r.ok) throw new Error(`Stooq respondeu ${r.status}`);
  const txt = await r.text();
  const linhas = txt.trim().split(/\r?\n/);
  for (let i = 1; i < linhas.length; i++) {
    const col = linhas[i].split(",");
    const sym = (col[0] ?? "").trim().toLowerCase(); // ex.: "vt.us"
    const close = parseFloat(col[6]);               // "Close"
    if (sym && Number.isFinite(close)) out.set(sym, close);
  }
  return out;
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

    // dedup + normaliza p/ Stooq; pede também o câmbio USD->BRL numa tacada só
    const mapaStooq = new Map<string, string>(); // stooqSym -> tickerOriginal
    for (const t of tickers) mapaStooq.set(toStooq(t), t);
    const simbolos = [...mapaStooq.keys(), "usdbrl"];

    const closes = await stooqQuotes(simbolos);

    const usdbrl = closes.get("usdbrl") ?? null;
    const quotes: Record<string, { price: number; currency: string }> = {};
    for (const [stooqSym, original] of mapaStooq) {
      const price = closes.get(stooqSym);
      if (price != null) quotes[original] = { price, currency: moedaDe(stooqSym) };
    }

    return json({ ok: true, fonte: "stooq", usdbrl, quotes });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
