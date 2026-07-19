export interface Lancamento {
  id: number;
  hash_natural: string;
  competencia: string; // "2026-06 (Jun/26)"
  ano: number;
  mes: number;
  banco: string;
  origem: string; // "Cartao Nubank", "Conta Itau", ...
  data_mov: string; // "dd/mm"
  descricao: string;
  detalhe: string | null;
  classe: string | null; // Gasto / Receita / Estorno/Credito / Transferencia/Pagamento
  categoria_auto: string | null;
  valor: number; // gasto negativo, receita positivo (na moeda `moeda`, normalmente BRL)
  moeda?: string | null; // moeda do campo `valor` (ISO; 'BRL' por padrão)
  valor_origem?: number | null; // valor na moeda estrangeira original (transação internacional)
  moeda_origem?: string | null; // ISO da moeda estrangeira original (ex.: 'USD')
  natureza: string | null; // Pessoal / Corporativo
  categoria_manual: string | null;
  subcategoria_manual?: string | null; // sub opcional, subordinada a categoria_manual
  criado_em?: string;
  atualizado_em?: string;
  // origem do dado (PDF ou Pluggy/Open Finance)
  fonte_dados?: string | null;
  pluggy_tx_id?: string | null;
  pluggy_account_id?: string | null;
  pluggy_item_id?: string | null;
  // classificação unificada (ver src/lib/lancClasses.ts e docs/fonte-unica-lancamentos.md)
  interna?: boolean | null;        // movimento entre contas próprias (transf. interna / fatura / aporte/resgate)
  par_hash?: string | null;        // liga as duas pernas casadas de uma transferência
  subtipo?: string | null;         // rótulo legível: Pagamento de fatura, Entre contas proprias, Aporte, Resgate, Rendimentos, Salario...
  classe_manual?: string | null;   // override do usuário p/ `classe` (a re-tradução respeita)
  interna_manual?: boolean | null; // override do usuário p/ `interna` (a re-tradução respeita)
}

// Posição de investimento (tabela public.pluggy_investments) via Open Finance/Pluggy.
// Cada linha é um ativo/posição: o `saldo` é o valor ATUAL (balance da Pluggy) e
// `valor_aplicado` é o montante aportado (amount). É o "patrimônio investido".
export interface Investimento {
  investment_id: string;
  item_id: string | null;
  banco: string | null;          // connector_name (instituição)
  tipo: string | null;           // FIXED_INCOME, MUTUAL_FUND, EQUITY, ETF, PENSION, ...
  subtipo: string | null;
  nome: string | null;
  emissor: string | null;        // issuer
  saldo: number | null;          // balance — valor ATUAL da posição
  valor_aplicado: number | null; // amount — montante aplicado
  lucro: number | null;          // amountProfit — lucro acumulado
  quantidade: number | null;     // quantity (cotas/papéis)
  moeda: string | null;          // currencyCode (BRL por padrão)
  vencimento: string | null;     // "YYYY-MM-DD" (dueDate)
  taxa: string | null;           // rate + rateType (ex.: "110 CDI")
  status: string | null;
  tipo_manual: string | null;    // classificação SUA do ativo (sobrepõe `tipo`)
  liquidez_d1_manual: boolean | null; // override SEU de "tem liquidez D+1?" (null = heurística)
  // posição MANUAL (fora do Open Finance) + cotação de mercado por ticker.
  // `saldo`/`valor_aplicado` seguem em BRL; o valor nativo é quantidade*preco_unitario.
  fonte?: string | null;         // 'pluggy' | 'manual' | 'ibkr' (origem da posição)
  manual?: boolean | null;       // criada à mão (a sync da Pluggy não toca)
  ticker?: string | null;        // símbolo p/ cotação ao vivo (ex.: 'VT')
  moeda_cotacao?: string | null; // moeda do preço do ticker (ex.: 'USD'); null = BRL
  preco_unitario?: number | null;// último preço unitário (na moeda_cotacao)
  preco_em?: string | null;      // quando o preço foi capturado
  atualizado_em?: string | null;
}

// Retrato diário do patrimônio investido (tabela public.pluggy_investments_hist).
export interface InvestimentoHist {
  dia: string;                   // "YYYY-MM-DD"
  valor_total: number | null;    // soma dos saldos (valor atual)
  valor_aplicado: number | null; // soma dos aportes
  lucro: number | null;          // soma do lucro
  posicoes: number | null;
}

// Retrato diário do patrimônio POR CATEGORIA (tabela public.pluggy_investments_hist_tipo).
// Uma linha por (dia, tipo efetivo) — alimenta o gráfico stackado de evolução por categoria.
export interface InvestimentoHistTipo {
  dia: string;                   // "YYYY-MM-DD"
  tipo: string;                  // tipo efetivo (tipo_manual ?? tipo ?? 'OUTROS')
  valor_total: number | null;    // soma dos saldos da categoria no dia
  valor_aplicado: number | null; // soma dos aportes da categoria no dia
  posicoes: number | null;       // nº de posições da categoria no dia
}

// ---------------------------------------------------------------------------
// Helpers de mutação otimista + fila de escrita (ver src/lib/mutationQueue.ts e
// src/hooks/useLancamentos.ts). Passados às abas p/ ações não-bloqueantes.
// ---------------------------------------------------------------------------
/** Aplica um patch às linhas `ids` na memória, na hora (sem esperar o banco). */
export type PatchLocal = (ids: number[], patch: Partial<Lancamento>) => void;
/** Mutação otimista: patch local imediato + persistência em fila + rollback. */
export type Mutate = (opts: {
  ids: number[];
  patch: Partial<Lancamento>;
  persist: () => Promise<void>;
  onError?: (e: unknown) => void;
}) => Promise<void>;
/** Enfileira uma escrita arbitrária no banco (não mexe no estado local). */
export type Enqueue = (persist: () => Promise<void>) => Promise<void>;

export type Visao = "ALL" | "pessoal" | "corporativo";
export type Modo = "cartao" | "ambos" | "conta";
export type Aba = "inicio" | "geral" | "mensal" | "diario" | "planejamento" | "classificar" | "lanc" | "adicionar" | "openbanking" | "investimentos" | "categorias";
