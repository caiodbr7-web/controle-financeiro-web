// ============================================================================
// Cliente Pluggy (Open Finance) + mapeamento para o schema `lancamentos`.
// Roda em Supabase Edge Functions (Deno). Mantem o CLIENT_SECRET no servidor.
// ============================================================================

const PLUGGY_API = "https://api.pluggy.ai";

const CLIENT_ID = Deno.env.get("PLUGGY_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("PLUGGY_CLIENT_SECRET") ?? "";

// --- autenticacao: troca CLIENT_ID/SECRET por uma apiKey (valida ~2h) -------
export async function pluggyAuth(): Promise<string> {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error(
      "Faltam PLUGGY_CLIENT_ID / PLUGGY_CLIENT_SECRET nos secrets da funcao.",
    );
  }
  const r = await fetch(`${PLUGGY_API}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }),
  });
  if (!r.ok) throw new Error(`Pluggy /auth falhou: ${r.status} ${await r.text()}`);
  const data = await r.json();
  return data.apiKey as string;
}

// --- connect token: usado pelo widget no front (valido 30 min) --------------
export async function createConnectToken(
  apiKey: string,
  opts: { clientUserId?: string; itemId?: string } = {},
): Promise<string> {
  const body: Record<string, unknown> = {};
  if (opts.itemId) body.itemId = opts.itemId; // modo "atualizar item"
  if (opts.clientUserId) body.options = { clientUserId: opts.clientUserId };
  const r = await fetch(`${PLUGGY_API}/connect_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    throw new Error(`Pluggy /connect_token falhou: ${r.status} ${await r.text()}`);
  }
  const data = await r.json();
  return data.accessToken as string;
}

// --- leitura de dados -------------------------------------------------------
export async function getItem(apiKey: string, itemId: string) {
  const r = await fetch(`${PLUGGY_API}/items/${itemId}`, {
    headers: { "X-API-KEY": apiKey },
  });
  if (!r.ok) throw new Error(`Pluggy /items falhou: ${r.status} ${await r.text()}`);
  return await r.json();
}

// --- forca a Pluggy a buscar dados FRESCOS no banco -------------------------
// Dispara um "update" no item (PATCH /items). Sem isso, a leitura traz apenas o
// ultimo retrato que a Pluggy ja tinha em cache. Retorna o item apos o PATCH.
export async function triggerItemUpdate(apiKey: string, itemId: string) {
  const r = await fetch(`${PLUGGY_API}/items/${itemId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
    body: "{}",
  });
  if (!r.ok) {
    // nao derruba o sync: se nao deu pra disparar, seguimos lendo o cache
    console.error(`Pluggy PATCH /items falhou: ${r.status} ${await r.text()}`);
    return null;
  }
  return await r.json();
}

// ----------------------------------------------------------------------------
// Resolvedor de banco canônico — ESPELHO de src/lib/bancos.ts (e da SQL
// public.pluggy_banco_canonico). Reconhece a instituição pelo conector + nomes
// das contas e devolve um nome CANÔNICO. Usado para nunca gravar o genérico
// "Banco" quando a Pluggy não devolve item.connector.name: nesses casos o nome
// real costuma estar no name/marketingName das contas. Mantenha os três em sincronia.
// ----------------------------------------------------------------------------
const DIACRITICOS = new RegExp("[\\u0300-\\u036f]", "g");
const semAcento = (s: string): string => s.normalize("NFD").replace(DIACRITICOS, "");
const XP = /(^|[^a-z])xp([^a-z]|$)/;

/** Reconhece o banco a partir de um texto livre (conector + contas). null se desconhecido. */
export function bancoCanonico(blob: string): string | null {
  const n = semAcento(blob).toLowerCase();
  if (n.includes("nubank") || n.includes("nu pagamentos") || n.includes("nu financeira")) return "Nubank";
  if (n.includes("itau")) return "Itau";
  if (n.includes("picpay") || n.includes("pic pay")) return "PicPay";
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

/** Nome do banco a gravar, com fallback: conector real (nunca "Pluggy") ou conta. */
export function resolverBanco(connector: string | null, contas: string[]): string {
  const blob = [connector ?? "", ...contas].join(" ");
  const canon = bancoCanonico(blob);
  if (canon) return canon;
  if (connector && !/pluggy/i.test(connector)) return connector;
  return contas.find(Boolean) || connector || "Banco";
}

const normNome = (s: string): string =>
  semAcento(s).toLowerCase().replace(/\s+/g, " ").trim();

// Overrides POR CONTA: cartões do agregador "MeuPluggy" cujo nome do produto não
// cita o banco (ex.: "platinum"), informados pelo dono das contas. Match exato no
// nome normalizado — NÃO entram no bancoCanonico (universal) porque seriam falsos
// positivos (qualquer "platinum" de outro banco cairia aqui).
const OVERRIDE_CONTA: Record<string, string> = {
  "platinum": "Nubank",
  "person multiplo black pontos": "Itau",
};

/**
 * Resolve o banco de UMA conta (não do item). É por-conta de propósito: conectores
 * agregadores da Pluggy (ex.: "MeuPluggy", connector_id 200) trazem, numa única
 * conexão, contas de bancos diferentes — XP, Nubank, PicPay, Itaú… O nome real de
 * cada banco está no name/marketingName da PRÓPRIA conta, não no conector. Resolver
 * no nível do item rotularia todas as contas com um banco só (errado).
 */
export function resolverBancoDaConta(
  connectorName: string | null,
  account: PluggyAccount,
): string {
  const nomes = [account.marketingName, account.name].filter(
    (x): x is string => !!x,
  );
  for (const n of nomes) {
    const ov = OVERRIDE_CONTA[normNome(n)];
    if (ov) return ov; // produto sem nome de banco -> override explícito
  }
  return resolverBanco(connectorName, nomes);
}

export async function getAccounts(apiKey: string, itemId: string) {
  const r = await fetch(`${PLUGGY_API}/accounts?itemId=${itemId}`, {
    headers: { "X-API-KEY": apiKey },
  });
  if (!r.ok) throw new Error(`Pluggy /accounts falhou: ${r.status} ${await r.text()}`);
  const data = await r.json();
  return (data.results ?? []) as PluggyAccount[];
}

// transacoes paginadas (pageSize 500, paginacao por pagina)
export async function getAllTransactions(
  apiKey: string,
  accountId: string,
  from?: string,
): Promise<PluggyTransaction[]> {
  const out: PluggyTransaction[] = [];
  let page = 1;
  while (true) {
    const params = new URLSearchParams({
      accountId,
      pageSize: "500",
      page: String(page),
    });
    if (from) params.set("from", from); // YYYY-MM-DD
    const r = await fetch(`${PLUGGY_API}/transactions?${params}`, {
      headers: { "X-API-KEY": apiKey },
    });
    if (!r.ok) {
      throw new Error(`Pluggy /transactions falhou: ${r.status} ${await r.text()}`);
    }
    const data = await r.json();
    const results = (data.results ?? []) as PluggyTransaction[];
    out.push(...results);
    const totalPages = data.totalPages ?? 1;
    if (page >= totalPages || results.length === 0) break;
    page += 1;
  }
  return out;
}

// ============================================================================
// Mapeamento Pluggy -> camada CRUA (pluggy_contas_raw / pluggy_transacoes_raw)
// ----------------------------------------------------------------------------
// IMPORTANTE: aqui a gente NAO normaliza nada (sinal, classe, competencia...).
// Guardamos o dado como o Pluggy manda + o JSON original em `payload`. A
// traducao para `lancamentos` mora na funcao SQL public.pluggy_traduzir_lancamentos
// (migration 0007), que e a unica fonte de verdade dessas regras.
// ============================================================================
export interface PluggyAccount {
  id: string;
  type: string; // "BANK" | "CREDIT"
  subtype?: string | null;
  name?: string | null;
  marketingName?: string | null;
  number?: string | null;
  owner?: string | null;
  taxNumber?: string | null;
  currencyCode?: string | null;
  balance?: number | null;
}

export interface PluggyTransaction {
  id: string;
  description: string;
  descriptionRaw?: string | null;
  amount: number;
  currencyCode?: string | null;
  date: string; // ISO UTC
  balance?: number | null;
  type?: string; // "DEBIT" | "CREDIT"
  status?: string | null; // "POSTED" | "PENDING"
  category?: string | null;
  categoryId?: string | null;
  operationType?: string | null;
  paymentData?: unknown | null;
}

/** Conta/cartao do Pluggy -> linha de `pluggy_contas_raw` (crua). */
export function mapContaRaw(
  account: PluggyAccount,
  itemId: string,
  connectorName: string,
  userId: string,
): Record<string, unknown> {
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
    payload: account, // objeto /accounts completo
    user_id: userId,
  };
}

/** Transacao do Pluggy -> linha de `pluggy_transacoes_raw` (crua, sinal original). */
export function mapTransacaoRaw(
  tx: PluggyTransaction,
  account: PluggyAccount,
  connectorName: string,
  itemId: string,
  userId: string,
): Record<string, unknown> {
  return {
    tx_id: tx.id,
    item_id: itemId,
    account_id: account.id,
    account_type: account.type ?? null, // denormalizado p/ a traducao SQL
    descricao: tx.description ?? null,
    descricao_raw: tx.descriptionRaw ?? null,
    valor: tx.amount, // BRUTO: sinal NAO normalizado (a SQL normaliza)
    moeda: tx.currencyCode ?? null,
    data_mov: tx.date, // ISO UTC, como vem
    tipo: tx.type ?? null,
    status: tx.status ?? null,
    categoria: tx.category ?? null,
    categoria_id: tx.categoryId ?? null,
    operation_type: tx.operationType ?? null,
    saldo_apos: tx.balance ?? null,
    connector_name: connectorName,
    payload: tx, // objeto /transactions completo
    user_id: userId,
  };
}
