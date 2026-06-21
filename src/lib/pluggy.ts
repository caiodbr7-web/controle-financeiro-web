import { sb, SUPABASE_URL, SUPABASE_ANON } from "./supabase";
import type { Investimento } from "../types";

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
  inseridos: number;
  from: string;
  por_conta: Record<string, number>;
}

/** Dispara a sincronizacao (contas + transacoes) de um item Pluggy. */
export async function syncItem(itemId: string, from?: string): Promise<SyncResult> {
  const r = await fetch(`${FN_BASE}/pluggy-sync`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ itemId, from }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error || "Falha ao sincronizar");
  return data as SyncResult;
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
      "investment_id,item_id,banco,tipo,subtipo,nome,emissor,saldo,valor_aplicado,lucro,quantidade,moeda,vencimento,taxa,status,atualizado_em",
    )
    .order("saldo", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Investimento[];
}
