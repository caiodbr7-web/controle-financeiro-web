// ============================================================================
//  Edge Function: ibkr-flex
//
//  Importa as POSIÇÕES da conta IBKR (Interactive Brokers) via "Flex Web
//  Service" (somente leitura — não precisa de TWS/Gateway rodando) para a tabela
//  public.pluggy_investments (fonte = 'ibkr'), junto da carteira do Open Finance.
//
//  Dois modos:
//   • Usuário (Authorization: Bearer <jwt>): importa as posições do próprio user
//     — usado pelo botão "Importar IBKR" na aba Investimentos.
//   • Cron (header x-cron-secret = CRON_SECRET): percorre todos os usuários com
//     credencial IBKR e importa cada um — agendado junto do sync da Pluggy.
//
//  Moeda: `saldo`/`valor_aplicado` são gravados em BRL (igual ao resto). Para
//  posições em US$ etc., o valor nativo (quantidade × preço) é convertido pelo
//  câmbio do dia (open.er-api.com + reserva frankfurter.app/BCE, grátis e sem
//  chave); a linha mostra o valor nativo e o R$ equivalente.
//
//  Secrets usados (já existentes no projeto): SUPABASE_URL,
//  SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET. (Token/Query da IBKR ficam por usuário
//  na tabela public.ibkr_flex, protegida por RLS.)
//
//  Deploy:
//    supabase functions deploy ibkr-flex --no-verify-jwt
//    (a função valida o JWT do usuário OU o x-cron-secret por conta própria)
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

const UA = { "User-Agent": "controle-financeiro/1.0" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const num = (s?: string | null): number | null => {
  if (s == null || s === "") return null;
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : null;
};

/* ---------------------------- IBKR Flex Web Service ------------------------ */
const FLEX_BASE = "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService";

const tagText = (xml: string, tag: string): string | null => {
  const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return m ? m[1].trim() : null;
};

// atributos de um elemento OpenPosition (formato plano key="value")
function attrs(fragment: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Za-z0-9_]+)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fragment)) !== null) out[m[1]] = m[2];
  return out;
}
function openPositions(xml: string): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  const re = /<OpenPosition\b([^>]*?)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(attrs(m[1]));
  return out;
}

// 2 passos: SendRequest -> ReferenceCode -> GetStatement (com polling)
async function flexFetch(token: string, queryId: string): Promise<string> {
  const r1 = await fetch(`${FLEX_BASE}/SendRequest?t=${encodeURIComponent(token)}&q=${encodeURIComponent(queryId)}&v=3`, { headers: UA });
  const x1 = await r1.text();
  if (tagText(x1, "Status") !== "Success") {
    throw new Error(`IBKR SendRequest falhou (${tagText(x1, "ErrorCode") ?? "?"}): ${tagText(x1, "ErrorMessage") ?? x1.slice(0, 200)}`);
  }
  const ref = tagText(x1, "ReferenceCode");
  const url = tagText(x1, "Url") ?? `${FLEX_BASE}/GetStatement`;
  if (!ref) throw new Error("IBKR não retornou ReferenceCode");

  const waits = [3000, 5000, 5000, 10000, 10000, 15000];
  for (let i = 0; i <= waits.length; i++) {
    const r2 = await fetch(`${url}?t=${encodeURIComponent(token)}&q=${encodeURIComponent(ref)}&v=3`, { headers: UA });
    const x2 = await r2.text();
    if (x2.includes("<FlexQueryResponse")) return x2;                 // pronto
    const code = tagText(x2, "ErrorCode");
    if (code === "1009" || code === "1019" || code === "1018") {      // gerando / ocupado / throttle
      if (i === waits.length) break;                                  // última tentativa: não dorme à toa
      await sleep(code === "1018" ? 10000 : waits[i]);
      continue;
    }
    throw new Error(`IBKR GetStatement erro ${code ?? "?"}: ${tagText(x2, "ErrorMessage") ?? x2.slice(0, 200)}`);
  }
  throw new Error("IBKR: tempo esgotado aguardando o relatório Flex");
}

/* ------------------------------- câmbio (grátis, sem chave) ---------------- */
// taxa de UMA moeda -> BRL: open.er-api.com (principal) com reserva no
// frankfurter.app (BCE). Retorna null se as duas fontes falharem.
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

// moeda do instrumento -> BRL (ex.: USD -> 5.43). BRL = 1. Moeda sem taxa fica
// ausente do mapa (o chamador aborta a importação para não gravar saldo zerado).
async function fxParaBRL(moedas: string[]): Promise<Record<string, number>> {
  const fx: Record<string, number> = { BRL: 1 };
  const need = [...new Set(moedas.map((c) => (c || "").toUpperCase()).filter((c) => c && c !== "BRL"))];
  for (const cur of need) {
    const r = await taxaBRL(cur);
    if (r != null) fx[cur] = r;
  }
  return fx;
}

// assetCategory da IBKR -> classe interna (o usuário pode reclassificar; o
// override `tipo_manual` é preservado pois não entra no upsert).
function mapTipo(a?: string): string {
  switch ((a || "").toUpperCase()) {
    case "STK": return "EQUITY";
    case "FUND": return "MUTUAL_FUND";
    case "BOND": return "FIXED_INCOME";
    case "ETF": return "ETF";
    default: return "OUTROS";
  }
}

// soma lotes por conid quando não há linha de resumo (evita dupla contagem)
function agruparPorConid(ps: Record<string, string>[]): Record<string, string>[] {
  const m = new Map<string, Record<string, string>>();
  for (const p of ps) {
    const key = p.conid || p.symbol || JSON.stringify(p);
    const cur = m.get(key);
    if (!cur) { m.set(key, { ...p }); continue; }
    cur.position = String((num(cur.position) ?? 0) + (num(p.position) ?? 0));
    cur.positionValue = String((num(cur.positionValue) ?? 0) + (num(p.positionValue) ?? 0));
    cur.costBasisMoney = String((num(cur.costBasisMoney) ?? 0) + (num(p.costBasisMoney) ?? 0));
  }
  return [...m.values()];
}

/* ----------------------- retrato diário (best-effort) --------------------- */
async function snapshot(admin: any, userId: string, agora: string) {
  try {
    const { data: todas } = await admin
      .from("pluggy_investments")
      .select("saldo, valor_aplicado, lucro, tipo, tipo_manual")
      .eq("user_id", userId);
    if (!todas || !todas.length) return;
    const dia = agora.slice(0, 10);
    const tot = todas.reduce(
      (a: any, p: any) => ({
        valor_total: a.valor_total + (p.saldo ?? 0),
        valor_aplicado: a.valor_aplicado + (p.valor_aplicado ?? 0),
        lucro: a.lucro + (p.lucro ?? 0),
      }),
      { valor_total: 0, valor_aplicado: 0, lucro: 0 },
    );
    await admin.from("pluggy_investments_hist").upsert(
      { user_id: userId, dia, ...tot, posicoes: todas.length, atualizado_em: agora },
      { onConflict: "user_id,dia" },
    );
    const porTipo = new Map<string, { valor_total: number; valor_aplicado: number; posicoes: number }>();
    for (const p of todas as any[]) {
      const k = (p.tipo_manual ?? p.tipo) || "OUTROS";
      const acc = porTipo.get(k) ?? { valor_total: 0, valor_aplicado: 0, posicoes: 0 };
      acc.valor_total += p.saldo ?? 0;
      acc.valor_aplicado += p.valor_aplicado ?? 0;
      acc.posicoes += 1;
      porTipo.set(k, acc);
    }
    const linhasTipo = [...porTipo.entries()].map(([tipo, v]) => ({ user_id: userId, dia, tipo, ...v, atualizado_em: agora }));
    if (linhasTipo.length) {
      // Substitui a quebra do dia inteira: apaga as linhas do dia antes de
      // reinserir. Sem isso, um upsert por (user_id, dia, tipo) deixa presas
      // categorias que sumiram ou trocaram de classificação (reclassificação,
      // posição fechada), inflando o dia e criando o degrau na área stackada.
      try {
        await admin.from("pluggy_investments_hist_tipo").delete().eq("user_id", userId).eq("dia", dia);
        await admin.from("pluggy_investments_hist_tipo").insert(linhasTipo);
      } catch { /* tabela opcional */ }
    }
  } catch { /* histórico é best-effort */ }
}

/* ------------------------------- importação ------------------------------- */
async function importForUser(admin: any, userId: string, token: string, queryId: string) {
  const xml = await flexFetch(token, queryId);
  let posicoes = openPositions(xml);
  const temSummary = posicoes.some((p) => (p.levelOfDetail || "").toUpperCase() === "SUMMARY");
  posicoes = temSummary
    ? posicoes.filter((p) => (p.levelOfDetail || "").toUpperCase() === "SUMMARY")
    : agruparPorConid(posicoes);

  const fx = await fxParaBRL(posicoes.map((p) => p.currency || "USD"));

  // Sem câmbio para alguma moeda estrangeira (fontes de câmbio fora do ar /
  // moeda exótica), ABORTA antes de gravar: senão gravaríamos saldo=NULL,
  // sumindo dos KPIs e corrompendo o retrato diário. Os dados anteriores ficam
  // preservados e o próximo ciclo tenta de novo.
  const semCambio = [...new Set(posicoes.map((p) => (p.currency || "USD").toUpperCase()))]
    .filter((c) => c !== "BRL" && fx[c] == null);
  if (semCambio.length) {
    throw new Error(`Sem câmbio p/ ${semCambio.join(", ")} (fonte de câmbio indisponível). Importação adiada — dados anteriores preservados.`);
  }

  const agora = new Date().toISOString();
  let accountId: string | null = null;

  const rows = posicoes.map((p) => {
    const symbol = p.symbol || p.underlyingSymbol || "";
    const conid = p.conid || symbol || "x";
    const acct = p.accountId || "";
    if (acct) accountId = acct;
    const cur = (p.currency || "USD").toUpperCase();
    const qty = num(p.position);
    const mark = num(p.markPrice);
    let posVal = num(p.positionValue);
    if (posVal == null && qty != null && mark != null) posVal = qty * mark * (num(p.multiplier) ?? 1);
    const rate = fx[cur] ?? null;
    const saldo = posVal != null && rate != null ? posVal * rate : null;
    const custo = num(p.costBasisMoney);
    const aplicado = custo != null && rate != null ? custo * rate : null;
    return {
      // id por USUÁRIO: evita que duas contas do app que apontem para a mesma
      // conta IBKR (família/assessor) colidam no PK global investment_id.
      investment_id: `ibkr-${userId}-${acct || "x"}-${conid}`,
      user_id: userId,
      fonte: "ibkr",
      manual: false,
      item_id: null,
      banco: "Interactive Brokers",
      tipo: mapTipo(p.assetCategory),
      subtipo: p.assetCategory ?? null,
      nome: p.description || symbol || conid,
      emissor: null,
      ticker: symbol || null,
      moeda: "BRL",
      moeda_cotacao: cur !== "BRL" ? cur : null,
      preco_unitario: mark,
      quantidade: qty,
      saldo,
      valor_aplicado: aplicado,
      lucro: saldo != null && aplicado != null ? saldo - aplicado : null,
      preco_em: agora,
      status: "IBKR",
      atualizado_em: agora,
    };
  });

  // dedup por investment_id
  const byId = new Map<string, any>();
  for (const r of rows) byId.set(r.investment_id, r);
  const unicos = [...byId.values()];

  // Conta vazia? NÃO apaga nada (evita zerar por uma Flex Query mal configurada).
  if (!unicos.length) return { posicoes: 0, accountId, aviso: "Nenhuma posição na Flex Query — verifique a seção Open Positions." };

  const { error: upErr } = await admin.from("pluggy_investments").upsert(unicos, { onConflict: "investment_id" });
  if (upErr) throw new Error("upsert ibkr: " + upErr.message);

  // remove posições IBKR que sumiram (fechadas), preservando as que ficaram (com
  // suas reclassificações). Diff explícito + .in() parametrizado — robusto a
  // símbolos com vírgula/aspas (sem montar a lista PostgREST na mão).
  const manter = new Set(unicos.map((r) => r.investment_id));
  const { data: existentes, error: exErr } = await admin
    .from("pluggy_investments").select("investment_id").eq("user_id", userId).eq("fonte", "ibkr");
  if (exErr) throw new Error("leitura ibkr: " + exErr.message);
  const remover = (existentes ?? []).map((r: any) => r.investment_id).filter((id: string) => !manter.has(id));
  if (remover.length) {
    const { error: delErr } = await admin
      .from("pluggy_investments").delete().eq("user_id", userId).eq("fonte", "ibkr").in("investment_id", remover);
    if (delErr) throw new Error("limpeza ibkr: " + delErr.message);
  }

  await snapshot(admin, userId, agora);
  return { posicoes: unicos.length, accountId };
}

/* -------------------------------- handler --------------------------------- */
// comparação em tempo constante (=== vaza timing do prefixo do segredo)
function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a), eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let d = 0;
  for (let i = 0; i < ea.length; i++) d |= ea[i] ^ eb[i];
  return d === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const cronSecret = Deno.env.get("CRON_SECRET");

    // ---- modo CRON: percorre todos os usuários com credencial IBKR ----
    if (cronSecret && safeEqual(req.headers.get("x-cron-secret") ?? "", cronSecret)) {
      const { data: creds, error } = await admin.from("ibkr_flex").select("user_id, flex_token, flex_query_id");
      if (error) { console.error("ibkr-flex creds:", error); return json({ error: "Falha ao ler credenciais." }, 500); }
      const erros: string[] = [];
      let ok = 0;
      for (const c of creds ?? []) {
        const ts = new Date().toISOString();
        try {
          const r = await importForUser(admin, c.user_id, c.flex_token, c.flex_query_id);
          await admin.from("ibkr_flex").update({ status: "OK", last_synced_at: ts, last_result: r, account_id: r.accountId, atualizado_em: ts }).eq("user_id", c.user_id);
          ok++;
        } catch (e) {
          erros.push(`${c.user_id}: ${(e as Error).message}`);
          await admin.from("ibkr_flex").update({ status: "ERRO: " + (e as Error).message, last_synced_at: ts, atualizado_em: ts }).eq("user_id", c.user_id);
        }
      }
      // detalhes (com user_id) só no log; a resposta do cron não precisa deles
      if (erros.length) console.error("ibkr-flex cron erros:", erros);
      return json({ ok: erros.length === 0, usuarios: (creds ?? []).length, importados: ok, falhas: erros.length });
    }

    // ---- modo USUÁRIO: importa a conta do chamador ----
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "Sem token de autenticação" }, 401);
    const { data: userData, error: userErr } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
    if (userErr || !userData?.user) return json({ error: "Usuário inválido" }, 401);
    const userId = userData.user.id;

    const { data: cred, error: credErr } = await admin
      .from("ibkr_flex").select("flex_token, flex_query_id").eq("user_id", userId).maybeSingle();
    if (credErr) { console.error("ibkr-flex cred:", credErr); return json({ error: "Falha ao ler credencial." }, 500); }
    if (!cred) return json({ error: "Conecte a IBKR primeiro (token + query id)." }, 400);

    const ts = new Date().toISOString();
    try {
      const r = await importForUser(admin, userId, cred.flex_token, cred.flex_query_id);
      await admin.from("ibkr_flex").update({ status: "OK", last_synced_at: ts, last_result: r, account_id: r.accountId, atualizado_em: ts }).eq("user_id", userId);
      return json({ ok: true, ...r });
    } catch (e) {
      // o detalhe fica no status da PRÓPRIA linha do usuário (RLS) p/ diagnóstico;
      // a resposta HTTP volta genérica (erros da IBKR podem ecoar o token/query)
      await admin.from("ibkr_flex").update({ status: "ERRO: " + (e as Error).message, last_synced_at: ts, atualizado_em: ts }).eq("user_id", userId);
      console.error("ibkr-flex user:", e);
      return json({ error: "Falha ao importar da IBKR. Confira token e query id em Conectar → IBKR." }, 500);
    }
  } catch (e) {
    console.error("ibkr-flex:", e);
    return json({ error: "Falha interna" }, 500);
  }
});
