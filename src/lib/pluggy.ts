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

/** Lista as posicoes de investimento ja sincronizadas (tabela pluggy_investments). */
export async function listInvestments(): Promise<Investimento[]> {
  const { data, error } = await sb
    .from("pluggy_investments")
    .select(
      "investment_id,item_id,banco,tipo,subtipo,nome,emissor,saldo,valor_aplicado,lucro,quantidade,moeda,vencimento,taxa,status,tipo_manual,atualizado_em",
    )
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

/** Define (ou limpa, com null) a classificação manual de um ativo. */
export async function setTipoManual(investmentId: string, tipoManual: string | null): Promise<void> {
  const { error } = await sb
    .from("pluggy_investments")
    .update({ tipo_manual: tipoManual })
    .eq("investment_id", investmentId);
  if (error) throw new Error(error.message);
}
