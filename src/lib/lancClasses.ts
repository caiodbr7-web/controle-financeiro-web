// ============================================================================
// Contrato de classes de `lancamentos` — fonte única de gasto/receita.
// ----------------------------------------------------------------------------
// Este módulo é o CONTRATO EM CÓDIGO da centralização: toda agregação de
// "gastos e receitas" nos dashboards deve passar por estes predicados, para que
// investimento, rendimento e transferência interna sejam tratados igual em todo
// lugar. Lógica pura — sem React, sem Supabase.
//
// Eixo do mês: TODOS os totais mensais usam `competencia` (a parcela conta no
// mês em que cai). Ver docs/fonte-unica-lancamentos.md.
//
// REGRA ANTI-CONFLITO: este arquivo é a fonte única em código das classes e dos
// critérios de inclusão dos dashboards. W3 refatora finance.ts para DELEGAR aqui
// (não duplicar). Mudou critério? Atualize aqui + o doc do contrato.
// ============================================================================

/** Valores canônicos do campo `classe`. */
export const CLASSE = {
  GASTO: "Gasto",
  ESTORNO: "Estorno/Credito",
  RECEITA: "Receita",
  APORTE: "Aporte",
  RECEITA_INVEST: "Receita Investimento",
  TRANSFER: "Transferencia/Pagamento",
} as const;
export type Classe = (typeof CLASSE)[keyof typeof CLASSE];

/** Lista ordenada das classes (para selects / legendas). */
export const CLASSES: Classe[] = [
  CLASSE.GASTO,
  CLASSE.ESTORNO,
  CLASSE.RECEITA,
  CLASSE.APORTE,
  CLASSE.RECEITA_INVEST,
  CLASSE.TRANSFER,
];

/** Forma mínima de uma linha para os predicados (subconjunto de `Lancamento`). */
export interface LinhaClassificavel {
  classe: string | null;
  interna?: boolean | null;
  valor: number;
}

// ---- predicados de classe (NÃO consideram `interna`) -----------------------
export const ehGasto = (c: string | null): boolean => c === CLASSE.GASTO;
export const ehEstorno = (c: string | null): boolean => c === CLASSE.ESTORNO;
export const ehReceita = (c: string | null): boolean => c === CLASSE.RECEITA;
export const ehAporte = (c: string | null): boolean => c === CLASSE.APORTE;
export const ehReceitaInvest = (c: string | null): boolean => c === CLASSE.RECEITA_INVEST;
/** Cobre "Transferencia/Pagamento" (e variações que comecem com "Transfer"). */
export const ehTransfer = (c: string | null): boolean => String(c || "").startsWith("Transfer");

/** Movimento entre contas próprias (transf. interna, pagamento de fatura, aporte/resgate). */
export const ehInterna = (d: { interna?: boolean | null }): boolean => d.interna === true;

// ---- contrato dos dashboards (INCLUI a regra do `interna`) -----------------
// Estes são os ÚNICOS critérios que os dashboards de gasto/receita devem usar.

/** Gasto real (consumo): classe Gasto e não-interno. Estorno é tratado em `valorGasto`. */
export function contaComoGasto(d: LinhaClassificavel): boolean {
  return !ehInterna(d) && ehGasto(d.classe);
}

/** Receita real (renda): classe Receita e não-interno. Exclui receita de investimento. */
export function contaComoReceita(d: LinhaClassificavel): boolean {
  return !ehInterna(d) && ehReceita(d.classe);
}

export const contaComoAporte = (d: LinhaClassificavel): boolean => ehAporte(d.classe);
export const contaComoReceitaInvest = (d: LinhaClassificavel): boolean => ehReceitaInvest(d.classe);

/**
 * Valor de GASTO de uma linha para somatórios (espelha o antigo `dvGasto`, agora
 * respeitando `interna`): Gasto soma positivo, Estorno/Credito subtrai, resto 0.
 * Transferência interna e aporte NÃO entram em gasto.
 */
export function valorGasto(d: LinhaClassificavel): number {
  if (ehInterna(d)) return 0;
  if (ehGasto(d.classe)) return Math.abs(d.valor);
  if (ehEstorno(d.classe)) return -Math.abs(d.valor);
  return 0;
}

/** Valor de RECEITA real (exclui interna e receita de investimento). */
export function valorReceita(d: LinhaClassificavel): number {
  return contaComoReceita(d) ? Math.abs(d.valor) : 0;
}

/** Valor APORTADO (investido) — classe Aporte, em módulo. */
export function valorAporte(d: LinhaClassificavel): number {
  return ehAporte(d.classe) ? Math.abs(d.valor) : 0;
}

/** Valor de RENDA DE INVESTIMENTO (rendimento/dividendo recebido), em módulo. */
export function valorReceitaInvest(d: LinhaClassificavel): number {
  return ehReceitaInvest(d.classe) ? Math.abs(d.valor) : 0;
}
