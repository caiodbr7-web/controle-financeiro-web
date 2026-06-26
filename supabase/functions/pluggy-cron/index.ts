// ============================================================================
//  Edge Function: pluggy-cron
//
//  Sincronização AUTOMÁTICA (agendada) de TODAS as conexões Pluggy de TODOS os
//  usuários — o "robô" que mantém a base atualizada sozinha, sem ninguém clicar
//  em "Sincronizar".
//
//  É AUTOSSUFICIENTE e roda com SERVICE ROLE: replica, internamente, o mesmo que
//  as funções manuais fazem, sem depender de JWT de usuário (imune à migração de
//  chaves JWT do projeto) e SEM alterar pluggy-sync / pluggy-investments:
//    • transações + saldos  ->  Pluggy -> camada crua -> RPCs
//                               (pluggy_traduzir_lancamentos / _reconstruir_saldos_diarios)
//    • investimentos        ->  /investments -> pluggy_investments (+ histórico)
//
//  Quem autoriza a chamada é o header  x-cron-secret == CRON_SECRET  (não um JWT).
//  O pg_cron a dispara nos horários agendados — ver:
//    db/migrations/2026-06-21-cron-sync.sql
//
//  Secrets necessários (Supabase -> Project Settings -> Edge Functions -> Secrets):
//    CRON_SECRET                              segredo combinado com o agendador
//    PLUGGY_CLIENT_ID / PLUGGY_CLIENT_SECRET  (as MESMAS já usadas pelas outras)
//  SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são injetadas automaticamente.
//
//  Deploy (precisa --no-verify-jwt: quem autoriza é o CRON_SECRET, não um JWT):
//    supabase functions deploy pluggy-cron --no-verify-jwt
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PLUGGY_API = "https://api.pluggy.ai";
const CLIENT_ID = Deno.env.get("PLUGGY_CLIENT_ID") ?? Deno.env.get("CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("PLUGGY_CLIENT_SECRET") ?? Deno.env.get("CLIENT_SECRET") ?? "";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ----------------------------------------------------------------------------
//  Cliente Pluggy (mesma lógica de _shared/pluggy.ts, embutida aqui para a
//  função ser um único arquivo, fácil de colar no painel).
// ----------------------------------------------------------------------------
async function pluggyAuth(): Promise<string> {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error("Faltam PLUGGY_CLIENT_ID / PLUGGY_CLIENT_SECRET nos secrets da função.");
  }
  const r = await fetch(`${PLUGGY_API}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }),
  });
  if (!r.ok) throw new Error(`Pluggy /auth falhou: ${r.status} ${await r.text()}`);
  return (await r.json()).apiKey as string;
}

async function getItem(apiKey: string, itemId: string) {
  const r = await fetch(`${PLUGGY_API}/items/${itemId}`, { headers: { "X-API-KEY": apiKey } });
  if (!r.ok) throw new Error(`Pluggy /items falhou: ${r.status} ${await r.text()}`);
  return await r.json();
}

async function getAccounts(apiKey: string, itemId: string): Promise<any[]> {
  const r = await fetch(`${PLUGGY_API}/accounts?itemId=${itemId}`, { headers: { "X-API-KEY": apiKey } });
  if (!r.ok) throw new Error(`Pluggy /accounts falhou: ${r.status} ${await r.text()}`);
  return ((await r.json()).results ?? []) as any[];
}

// transações paginadas (pageSize 500), igual à sync manual
async function getAllTransactions(apiKey: string, accountId: string, from?: string): Promise<any[]> {
  const out: any[] = [];
  let page = 1;
  while (true) {
    const params = new URLSearchParams({ accountId, pageSize: "500", page: String(page) });
    if (from) params.set("from", from); // YYYY-MM-DD
    const r = await fetch(`${PLUGGY_API}/transactions?${params}`, { headers: { "X-API-KEY": apiKey } });
    if (!r.ok) throw new Error(`Pluggy /transactions falhou: ${r.status} ${await r.text()}`);
    const data = await r.json();
    const results = (data.results ?? []) as any[];
    out.push(...results);
    const totalPages = data.totalPages ?? 1;
    if (page >= totalPages || results.length === 0) break;
    page += 1;
  }
  return out;
}

// investimentos paginados (igual à pluggy-investments)
async function fetchInvestments(apiKey: string, itemId: string): Promise<any[]> {
  const out: any[] = [];
  let page = 1;
  while (true) {
    const url = `${PLUGGY_API}/investments?itemId=${encodeURIComponent(itemId)}&page=${page}&pageSize=200`;
    const r = await fetch(url, { headers: { "X-API-KEY": apiKey } });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.message || `Falha ao buscar investimentos (item ${itemId})`);
    const results: any[] = data.results ?? [];
    out.push(...results);
    const totalPages = data.totalPages ?? 1;
    if (page >= totalPages || results.length === 0) break;
    page += 1;
  }
  return out;
}

function fmtTaxa(inv: any): string | null {
  if (inv.rate != null) return `${inv.rate}${inv.rateType ? " " + inv.rateType : ""}`;
  return inv.rateType ?? null;
}

// mapeamentos CRUS — idênticos a _shared/pluggy.ts (não normalizam nada)
function mapContaRaw(account: any, itemId: string, connectorName: string, userId: string) {
  return {
    account_id: account.id,
    item_id: itemId,
    type: account.type ?? null,
    subtype: account.subtype ?? null,
    name: account.name ?? null,
    marketing_name: account.marketingName ?? null,
    number: account.number ?? null,
    owner: account.owner ?? null,
    tax_number: account.taxNumber ?? null,
    currency_code: account.currencyCode ?? null,
    balance: account.balance ?? null,
    connector_name: connectorName,
    payload: account,
    user_id: userId,
  };
}

function mapTransacaoRaw(tx: any, account: any, connectorName: string, itemId: string, userId: string) {
  return {
    tx_id: tx.id,
    item_id: itemId,
    account_id: account.id,
    account_type: account.type ?? null,
    descricao: tx.description ?? null,
    descricao_raw: tx.descriptionRaw ?? null,
    valor: tx.amount, // BRUTO: a SQL normaliza o sinal
    moeda: tx.currencyCode ?? null,
    data_mov: tx.date,
    tipo: tx.type ?? null,
    status: tx.status ?? null,
    categoria: tx.category ?? null,
    categoria_id: tx.categoryId ?? null,
    operation_type: tx.operationType ?? null,
    saldo_apos: tx.balance ?? null,
    connector_name: connectorName,
    payload: tx,
    user_id: userId,
  };
}

function dozeMesesAtras(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 12);
  return d.toISOString().slice(0, 10);
}

// ----------------------------------------------------------------------------
//  Resolvedor de banco canônico (espelho de src/lib/bancos.ts e _shared/pluggy.ts).
//  Evita gravar o genérico "Banco" quando a Pluggy não devolve connector.name:
//  nesses casos o nome real costuma estar no name/marketingName das contas.
// ----------------------------------------------------------------------------
const DIACRITICOS = new RegExp("[\\u0300-\\u036f]", "g");
const semAcento = (s: string): string => s.normalize("NFD").replace(DIACRITICOS, "");
const XP = /(^|[^a-z])xp([^a-z]|$)/;

function bancoCanonico(blob: string): string | null {
  const n = semAcento(blob).toLowerCase();
  if (n.includes("nubank") || n.includes("nu pagamentos") || n.includes("nu financeira")) return "Nubank";
  if (n.includes("itau")) return "Itau";
  if (n.includes("picpay")) return "PicPay";
  if (n.includes("rico")) return "Rico";
  if (XP.test(n)) return "XP";
  if (n.includes("bradesco")) return "Bradesco";
  if (n.includes("santander")) return "Santander";
  if (n.includes("banco do brasil")) return "Banco do Brasil";
  if (n.includes("caixa")) return "Caixa";
  if (n.includes("inter")) return "Inter";
  if (n.includes("c6")) return "C6";
  if (n.includes("btg")) return "BTG";
  if (n.includes("mercado pago") || n.includes("mercadopago")) return "Mercado Pago";
  if (n.includes("pagbank") || n.includes("pagseguro")) return "PagBank";
  if (n.includes("safra")) return "Safra";
  if (n.includes("neon")) return "Neon";
  if (n.includes("sicoob")) return "Sicoob";
  if (n.includes("sicredi")) return "Sicredi";
  if (n.includes("original")) return "Original";
  return null;
}

function resolverBancoDoItem(connectorName: string | null, accounts: any[]): string {
  const nomes = accounts.flatMap((a) =>
    [a?.marketingName, a?.name].filter((x: unknown): x is string => !!x)
  );
  const blob = [connectorName ?? "", ...nomes].join(" ");
  const canon = bancoCanonico(blob);
  if (canon) return canon;
  if (connectorName && !/pluggy/i.test(connectorName)) return connectorName;
  return nomes.find(Boolean) || connectorName || "Banco";
}

// ----------------------------------------------------------------------------
//  Sincroniza UMA conexão: transações + saldos (espelha pluggy-sync, mas com
//  service role e user_id explícito; a posse já é garantida porque o item veio
//  da própria tabela pluggy_items).
// ----------------------------------------------------------------------------
async function syncTransacoes(admin: any, apiKey: string, userId: string, itemId: string, syncFrom: string | null) {
  const item = await getItem(apiKey, itemId);
  const accounts = await getAccounts(apiKey, itemId);
  // resolve o banco pelos nomes das contas quando a Pluggy não dá connector.name
  const connectorName: string = resolverBancoDoItem(item?.connector?.name ?? null, accounts);
  const from: string = syncFrom ?? dozeMesesAtras();

  const contasRaw = accounts.map((acc) => mapContaRaw(acc, itemId, connectorName, userId));
  let txRaw: Record<string, unknown>[] = [];
  const porConta: Record<string, number> = {};
  for (const acc of accounts) {
    const txs = await getAllTransactions(apiKey, acc.id, from);
    porConta[acc.name ?? acc.id] = txs.length;
    txRaw = txRaw.concat(txs.map((t) => mapTransacaoRaw(t, acc, connectorName, itemId, userId)));
  }

  // dedup dentro do lote (mesmo tx_id não pode repetir no upsert)
  const vistos = new Set<string>();
  txRaw = txRaw.filter((r) => {
    const h = r.tx_id as string;
    if (vistos.has(h)) return false;
    vistos.add(h);
    return true;
  });

  if (contasRaw.length) {
    const { error } = await admin.from("pluggy_contas_raw").upsert(contasRaw, { onConflict: "account_id" });
    if (error) throw new Error("upsert pluggy_contas_raw: " + error.message);
  }
  const LOTE = 500;
  for (let i = 0; i < txRaw.length; i += LOTE) {
    const { error } = await admin
      .from("pluggy_transacoes_raw")
      .upsert(txRaw.slice(i, i + LOTE), { onConflict: "tx_id" });
    if (error) throw new Error("upsert pluggy_transacoes_raw: " + error.message);
  }

  // registra o estado da conexão (igual à sync manual)
  await admin.from("pluggy_items").upsert(
    {
      item_id: itemId,
      user_id: userId,
      connector_id: item?.connector?.id ?? null,
      connector_name: connectorName,
      status: item?.status ?? null,
      sync_from: from,
      last_synced_at: new Date().toISOString(),
      last_result: { contas: accounts.length, por_conta: porConta, transacoes: txRaw.length, from },
    },
    { onConflict: "item_id" },
  );

  return { contas: accounts.length, transacoes: txRaw.length, por_conta: porConta };
}

// ----------------------------------------------------------------------------
//  Sincroniza os investimentos de um usuário (espelha pluggy-investments).
// ----------------------------------------------------------------------------
async function syncInvestimentos(admin: any, apiKey: string, userId: string, itemIds: string[]) {
  const agora = new Date().toISOString();
  const linhas: any[] = [];
  for (const itemId of itemIds) {
    const invs = await fetchInvestments(apiKey, itemId);
    for (const inv of invs) {
      if (inv.id == null) continue;
      linhas.push({
        investment_id: inv.id,
        user_id: userId,
        item_id: itemId,
        tipo: inv.type ?? null,
        subtipo: inv.subtype ?? null,
        nome: inv.name ?? null,
        emissor: inv.issuer ?? null,
        saldo: inv.balance ?? null,
        valor_aplicado: inv.amount ?? inv.amountOriginal ?? null,
        lucro: inv.amountProfit ?? null,
        quantidade: inv.quantity ?? null,
        moeda: inv.currencyCode ?? "BRL",
        vencimento: inv.dueDate ? String(inv.dueDate).slice(0, 10) : null,
        taxa: fmtTaxa(inv),
        status: inv.status ?? null,
        raw: inv,
        atualizado_em: agora,
      });
    }
  }

  // dedup por investment_id (a Pluggy pode repetir um ativo)
  const porId = new Map<string, any>();
  for (const l of linhas) porId.set(l.investment_id, l);
  const unicos = [...porId.values()];

  if (unicos.length) {
    const { error } = await admin
      .from("pluggy_investments")
      .upsert(unicos, { onConflict: "investment_id" });
    if (error) throw new Error("upsert pluggy_investments: " + error.message);
  }

  // retrato DIÁRIO do patrimônio (alimenta o gráfico de evolução)
  try {
    const { data: todas } = await admin
      .from("pluggy_investments")
      .select("saldo, valor_aplicado, lucro")
      .eq("user_id", userId);
    if (todas && todas.length) {
      const tot = todas.reduce(
        (a: any, p: any) => ({
          valor_total: a.valor_total + (p.saldo ?? 0),
          valor_aplicado: a.valor_aplicado + (p.valor_aplicado ?? 0),
          lucro: a.lucro + (p.lucro ?? 0),
        }),
        { valor_total: 0, valor_aplicado: 0, lucro: 0 },
      );
      await admin.from("pluggy_investments_hist").upsert(
        { user_id: userId, dia: agora.slice(0, 10), ...tot, posicoes: todas.length, atualizado_em: agora },
        { onConflict: "user_id,dia" },
      );
    }
  } catch { /* histórico é best-effort */ }

  return { investimentos: unicos.length };
}

Deno.serve(async (req) => {
  try {
    // 1) só o agendador entra (header secreto, não JWT) ----------------------
    const cronSecret = Deno.env.get("CRON_SECRET");
    if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) {
      return json({ error: "não autorizado" }, 401);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // body opcional: { userId?, itemId? } limita o escopo (útil para testar)
    const body = await req.json().catch(() => ({}));

    let q = admin.from("pluggy_items").select("user_id, item_id, sync_from");
    if (body?.userId) q = q.eq("user_id", body.userId);
    if (body?.itemId) q = q.eq("item_id", body.itemId);
    const { data: itens, error } = await q;
    if (error) return json({ error: error.message }, 500);
    if (!itens || itens.length === 0) return json({ ok: true, usuarios: 0, conexoes: 0 });

    // agrupa as conexões por usuário
    const porUsuario = new Map<string, { item_id: string; sync_from: string | null }[]>();
    for (const it of itens as any[]) {
      if (!it.user_id || !it.item_id) continue;
      const arr = porUsuario.get(it.user_id) ?? [];
      arr.push({ item_id: it.item_id, sync_from: it.sync_from ?? null });
      porUsuario.set(it.user_id, arr);
    }

    const apiKey = await pluggyAuth();
    const resumo: Record<string, unknown> = {};
    const erros: string[] = [];

    for (const [userId, conexoes] of porUsuario) {
      const usr: any = { conexoes: conexoes.length, sync: {}, investimentos: 0 };

      // (a) transações + saldos: uma conexão por vez
      for (const c of conexoes) {
        try {
          usr.sync[c.item_id] = await syncTransacoes(admin, apiKey, userId, c.item_id, c.sync_from);
        } catch (e) {
          usr.sync[c.item_id] = { erro: (e as Error).message };
          erros.push(`sync ${c.item_id}: ${(e as Error).message}`);
        }
      }

      // (b) traduz CRU -> lancamentos e reconstrói saldos diários (1x por usuário)
      try {
        const { error: e1 } = await admin.rpc("pluggy_traduzir_lancamentos", { p_user_id: userId });
        if (e1) throw e1;
      } catch (e) { erros.push(`traduzir ${userId}: ${(e as Error).message}`); }
      try {
        const { error: e2 } = await admin.rpc("pluggy_reconstruir_saldos_diarios", { p_user_id: userId, p_meses: 24 });
        if (e2) throw e2;
      } catch (e) { erros.push(`saldos ${userId}: ${(e as Error).message}`); }

      // (c) investimentos
      try {
        const r = await syncInvestimentos(admin, apiKey, userId, conexoes.map((c) => c.item_id));
        usr.investimentos = r.investimentos;
      } catch (e) {
        erros.push(`investimentos ${userId}: ${(e as Error).message}`);
      }

      resumo[userId] = usr;
    }

    return json({ ok: erros.length === 0, usuarios: porUsuario.size, conexoes: itens.length, erros, resumo });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
