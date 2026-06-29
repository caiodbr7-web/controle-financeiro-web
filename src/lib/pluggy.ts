import { sb, SUPABASE_URL, SUPABASE_ANON } from "./supabase";
import type { Investimento, InvestimentoHist, InvestimentoHistTipo } from "../types";

const FN_BASE = `${SUPABASE_URL}/functions/v1`;

async function authHeaders() {
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token ?? "";
  return {
    "Content-Type": "application/json",
    apikey: SUPABASE_ANON,
    Authorization: `Bearer ${token}`,
  };
}

/** Pede ao backend um Connect Token para abrir o widget Pluggy. */
export async function getConnectToken(itemId?: string): Promise<string> {
  const r = await fetch(`${FN_BASE}/pluggy-connect-token`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(itemId ? { itemId } : {}),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error || "Falha ao gerar token");
  return data.accessToken as string;
}

export interface SyncResult {
  ok: boolean;
  contas: number;
  transacoes: number;
  /** lançamentos traduzidos; null quando o sync foi só de download (translate=false) */
  inseridos: number | null;
  from: string;
  por_conta: Record<string, number>;
  /** status do item na Pluggy apos o sync (UPDATED, WAITING_USER_INPUT, LOGIN_ERROR, ...) */
  status?: string | null;
}

export interface SyncOpts {
  /** força a Pluggy a buscar dados frescos no banco antes de ler (mais lento) */
  refresh?: boolean;
  /** roda a tradução CRU->lancamentos + saldos ao final (default true). Passe
   *  false ao sincronizar várias conexões em paralelo e traduza uma vez só
   *  depois (via translateLancamentos), evitando timeout no banco. */
  translate?: boolean;
}

/** Dispara a sincronizacao (contas + transacoes) de um item Pluggy. */
export async function syncItem(itemId: string, from?: string, opts: SyncOpts = {}): Promise<SyncResult> {
  const r = await fetch(`${FN_BASE}/pluggy-sync`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ itemId, from, refresh: opts.refresh ?? false, translate: opts.translate ?? true }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error || "Falha ao sincronizar");
  return data as SyncResult;
}

/** Roda a tradução CRU->lancamentos (+ saldos) UMA vez, sem baixar nada da Pluggy.
 *  Passo final após sincronizar várias conexões com translate=false. */
export async function translateLancamentos(): Promise<{ inseridos: number }> {
  const r = await fetch(`${FN_BASE}/pluggy-sync`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ translateOnly: true }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error || "Falha ao traduzir lançamentos");
  return data as { inseridos: number };
}

export interface PluggyItemRow {
  item_id: string;
  connector_name: string | null;
  status: string | null;
  sync_from: string | null;
  last_synced_at: string | null;
  last_result:
    | { contas?: number; transacoes?: number; lancamentos?: number; por_conta?: Record<string, number> }
    | null;
}

/** Lista os bancos ja conectados (tabela pluggy_items). */
export async function listItems(): Promise<PluggyItemRow[]> {
  const { data, error } = await sb
    .from("pluggy_items")
    .select("item_id, connector_name, status, sync_from, last_synced_at, last_result")
    .order("atualizado_em", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as PluggyItemRow[];
}

/** Conta quantos lançamentos já foram importados por uma conexão. */
export async function countLancamentosDoItem(itemId: string): Promise<number> {
  const { count, error } = await sb
    .from("lancamentos")
    .select("id", { count: "exact", head: true })
    .eq("pluggy_item_id", itemId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Remove uma conexão Pluggy e TODOS os dados importados por ela (lançamentos,
 *  camada crua, saldos e investimentos). A RLS isola por usuário. Retorna a
 *  lista de avisos não-críticos (tabelas auxiliares que falharam ao limpar). */
export async function deleteItem(itemId: string): Promise<string[]> {
  // ordem: filhos primeiro, conexão (pluggy_items) por último
  const alvos: { tabela: string; col: string; critico?: boolean }[] = [
    { tabela: "lancamentos", col: "pluggy_item_id", critico: true },
    { tabela: "pluggy_transacoes_raw", col: "item_id" },
    { tabela: "pluggy_contas_raw", col: "item_id" },
    { tabela: "pluggy_saldos", col: "item_id" },
    { tabela: "pluggy_investments", col: "item_id" },
    { tabela: "pluggy_items", col: "item_id", critico: true },
  ];
  const avisos: string[] = [];
  for (const a of alvos) {
    const { error } = await sb.from(a.tabela).delete().eq(a.col, itemId);
    if (error) {
      if (a.critico) throw new Error(`Erro ao limpar ${a.tabela}: ${error.message}`);
      avisos.push(`${a.tabela}: ${error.message}`);
    }
  }
  return avisos;
}

export interface InvestSyncResult {
  ok: boolean;
  itens: number;
  investimentos: number;
  inseridos: number;
  por_item: Record<string, number>;
}

/** Dispara a sincronizacao das posicoes de investimento (endpoint /investments).
 *  Sem itemId, sincroniza todas as conexoes do usuario. */
export async function syncInvestments(itemId?: string): Promise<InvestSyncResult> {
  const r = await fetch(`${FN_BASE}/pluggy-investments`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(itemId ? { itemId } : {}),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error || "Falha ao sincronizar investimentos");
  return data as InvestSyncResult;
}

// colunas lidas/retornadas para uma posição de investimento (fonte única)
const INV_COLS =
  "investment_id,item_id,banco,tipo,subtipo,nome,emissor,saldo,valor_aplicado,lucro,quantidade,moeda,vencimento,taxa,status,tipo_manual,liquidez_d1_manual,fonte,manual,ticker,moeda_cotacao,preco_unitario,preco_em,atualizado_em";

/** Lista as posicoes de investimento ja sincronizadas (tabela pluggy_investments). */
export async function listInvestments(): Promise<Investimento[]> {
  const { data, error } = await sb
    .from("pluggy_investments")
    .select(INV_COLS)
    .order("saldo", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Investimento[];
}

/** Histórico diário do patrimônio investido (tabela pluggy_investments_hist). */
export async function listInvestmentHistory(): Promise<InvestimentoHist[]> {
  const { data, error } = await sb
    .from("pluggy_investments_hist")
    .select("dia,valor_total,valor_aplicado,lucro,posicoes")
    .order("dia", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as InvestimentoHist[];
}

/** Histórico diário do patrimônio POR CATEGORIA (tabela pluggy_investments_hist_tipo).
 *  Alimenta o gráfico stackado de evolução por tipo. Se a tabela ainda não existir
 *  (migração não aplicada), devolve [] para o front cair na estimativa pela composição
 *  atual em vez de quebrar. */
export async function listInvestmentHistoryByTipo(): Promise<InvestimentoHistTipo[]> {
  const { data, error } = await sb
    .from("pluggy_investments_hist_tipo")
    .select("dia,tipo,valor_total,valor_aplicado,posicoes")
    .order("dia", { ascending: true });
  if (error) {
    // tabela/relação inexistente -> degrada graciosamente (front sintetiza a série)
    if (/relation|does not exist|could not find|schema cache|not exist/i.test(error.message)) return [];
    throw new Error(error.message);
  }
  return (data ?? []) as InvestimentoHistTipo[];
}

// Saldo ATUAL de uma conta bancária (caixa líquido), vindo do Open Banking.
export interface SaldoConta {
  account_id: string;
  banco: string | null;
  conta_nome: string | null;
  saldo: number;   // saldo do último dia disponível
  dia: string;     // "YYYY-MM-DD"
  moeda: string;
}

/** Saldo ATUAL de cada conta bancária (tabela public.pluggy_saldos) — o "caixa":
 *  dinheiro líquido em conta, somado ao patrimônio na aba Investimentos.
 *  Pega o retrato mais recente de cada conta (dedupe por account_id sobre os
 *  dias mais recentes). Tabela inexistente -> [] (degrada sem quebrar). */
export async function listSaldoCaixa(): Promise<SaldoConta[]> {
  const { data, error } = await sb
    .from("pluggy_saldos")
    .select("account_id,banco,conta_nome,saldo,dia,moeda")
    .order("dia", { ascending: false })
    .limit(500);
  if (error) {
    if (/relation|does not exist|could not find|schema cache|not exist/i.test(error.message)) return [];
    throw new Error(error.message);
  }
  // ordenado por dia desc -> a 1ª linha de cada conta é o saldo mais recente
  const ultimo = new Map<string, SaldoConta>();
  for (const r of (data ?? []) as SaldoConta[]) {
    if (!ultimo.has(r.account_id)) ultimo.set(r.account_id, r);
  }
  return [...ultimo.values()];
}

/** Define (ou limpa, com null) a classificação manual de um ativo. */
export async function setTipoManual(investmentId: string, tipoManual: string | null): Promise<void> {
  const { error } = await sb
    .from("pluggy_investments")
    .update({ tipo_manual: tipoManual })
    .eq("investment_id", investmentId);
  if (error) throw new Error(error.message);
}

/** Define o override de liquidez D+1 de um ativo (true=Sim, false=Não, null=heurística). */
export async function setLiquidezD1Manual(investmentId: string, valor: boolean | null): Promise<void> {
  const { error } = await sb
    .from("pluggy_investments")
    .update({ liquidez_d1_manual: valor })
    .eq("investment_id", investmentId);
  if (error) throw new Error(error.message);
}

/* ====================== Posições MANUAIS (fora do Open Finance) ============== */

export interface ManualInvestmentInput {
  nome: string;
  banco?: string | null;          // instituição
  tipo_manual?: string | null;    // classe (FIXED_INCOME, ETF_US, ...)
  ticker?: string | null;         // símbolo p/ cotação ao vivo (ex.: 'VT')
  moeda_cotacao?: string | null;  // moeda do ticker (ex.: 'USD'); null = BRL
  quantidade?: number | null;
  preco_unitario?: number | null; // preço unitário (na moeda_cotacao); opcional
  valor_aplicado?: number | null; // em BRL
  saldo?: number | null;          // valor atual em BRL (calculado para ticker)
}

// id estável para uma linha manual (sem id da Pluggy)
function genManualId(): string {
  const rnd = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `manual-${rnd}`;
}

// campos que o usuário edita numa posição manual (não toca em colunas da Pluggy)
function manualPayload(inp: ManualInvestmentInput) {
  const saldo = inp.saldo ?? null;
  const aplicado = inp.valor_aplicado ?? null;
  return {
    banco: inp.banco ?? null,
    nome: inp.nome,
    tipo_manual: inp.tipo_manual ?? null,
    ticker: inp.ticker?.trim() ? inp.ticker.trim().toUpperCase() : null,
    moeda_cotacao: inp.moeda_cotacao ?? null,
    quantidade: inp.quantidade ?? null,
    preco_unitario: inp.preco_unitario ?? null,
    valor_aplicado: aplicado,
    saldo,
    lucro: saldo != null && aplicado != null ? saldo - aplicado : null,
  };
}

/** Cria uma posição manual (saldo/valor_aplicado em BRL). */
export async function addManualInvestment(inp: ManualInvestmentInput): Promise<Investimento> {
  const { data, error } = await sb
    .from("pluggy_investments")
    .insert({ investment_id: genManualId(), manual: true, fonte: "manual", item_id: null, tipo: null, moeda: "BRL", ...manualPayload(inp) })
    .select(INV_COLS)
    .single();
  if (error) throw new Error(error.message);
  return data as Investimento;
}

/** Atualiza uma posição manual existente. */
export async function updateManualInvestment(investmentId: string, inp: ManualInvestmentInput): Promise<void> {
  const { error } = await sb
    .from("pluggy_investments")
    .update(manualPayload(inp))
    .eq("investment_id", investmentId)
    .eq("manual", true);
  if (error) throw new Error(error.message);
}

/** Remove uma posição manual (não permite apagar linhas vindas da Pluggy). */
export async function deleteManualInvestment(investmentId: string): Promise<void> {
  const { error } = await sb
    .from("pluggy_investments")
    .delete()
    .eq("investment_id", investmentId)
    .eq("manual", true);
  if (error) throw new Error(error.message);
}

/** Persiste o preço/saldo recalculado de uma posição (após buscar a cotação). */
export async function setInvestmentCotacao(
  investmentId: string,
  patch: { saldo: number | null; preco_unitario: number | null; preco_em: string; lucro: number | null },
): Promise<void> {
  const { error } = await sb
    .from("pluggy_investments")
    .update(patch)
    .eq("investment_id", investmentId);
  if (error) throw new Error(error.message);
}

export interface CotacaoResp {
  usdbrl: number | null;
  quotes: Record<string, { price: number; currency: string }>;
}

/** Busca cotações de tickers + câmbio USD->BRL (Edge Function `cotacao`/Stooq). */
export async function fetchCotacoes(tickers: string[]): Promise<CotacaoResp> {
  const r = await fetch(`${FN_BASE}/cotacao`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ tickers }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error || "Falha ao buscar cotações");
  return { usdbrl: data.usdbrl ?? null, quotes: data.quotes ?? {} };
}

/* ============================ IBKR (Flex Web Service) ====================== */

export interface IbkrCredencial {
  flex_query_id: string;
  account_id: string | null;
  status: string | null;
  last_synced_at: string | null;
  last_result: unknown;
}

/** Lê a credencial IBKR do usuário (sem o token). null se não conectado. */
export async function getIbkrCredencial(): Promise<IbkrCredencial | null> {
  const { data, error } = await sb
    .from("ibkr_flex")
    .select("flex_query_id, account_id, status, last_synced_at, last_result")
    .maybeSingle();
  if (error) {
    // tabela ainda não criada (migração não rodou) -> trata como "não conectado"
    if (/relation|does not exist|could not find|schema cache|not exist/i.test(error.message)) return null;
    throw new Error(error.message);
  }
  return (data as IbkrCredencial) ?? null;
}

/** Salva (cria/atualiza) o token + query id da IBKR do usuário. */
export async function saveIbkrCredencial(token: string, queryId: string): Promise<void> {
  const { data: u } = await sb.auth.getUser();
  const user_id = u.user?.id;
  if (!user_id) throw new Error("Sessão expirada — entre novamente.");
  const { error } = await sb
    .from("ibkr_flex")
    .upsert(
      { user_id, flex_token: token.trim(), flex_query_id: queryId.trim(), atualizado_em: new Date().toISOString() },
      { onConflict: "user_id" },
    );
  if (error) throw new Error(error.message);
}

/** Desconecta a IBKR (remove a credencial). As posições importadas continuam. */
export async function deleteIbkrCredencial(): Promise<void> {
  const { data: u } = await sb.auth.getUser();
  const user_id = u.user?.id;
  if (!user_id) return;
  const { error } = await sb.from("ibkr_flex").delete().eq("user_id", user_id);
  if (error) throw new Error(error.message);
}

export interface IbkrImportResult { ok: boolean; posicoes: number; accountId?: string | null; aviso?: string }

/** Dispara a importação das posições da IBKR (Edge Function `ibkr-flex`). */
export async function importIbkr(): Promise<IbkrImportResult> {
  const r = await fetch(`${FN_BASE}/ibkr-flex`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({}),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error || "Falha ao importar da IBKR");
  return data as IbkrImportResult;
}
