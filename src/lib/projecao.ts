import { dvAddMes, dvLabel } from "./finance";

/* ============================================================
   Planejamento / projeção de gastos futuros.
   Lógica pura (sem React, sem Supabase) — fácil de testar.

   Tipos de item:
     fixo         valor = quanto gasta por mês (recorrente até mes_fim ou indefinido)
     parcelamento valor = valor da parcela; lança por `parcelas` meses a partir do início
     pagamento    valor = valor único, lança só no mês de início
     meta         valor = valor TOTAL; diluído igualmente entre início e mes_fim (mês-alvo)
     receita      valor = quanto entra por mês (recorrente; conta como entrada)
   ============================================================ */

export type TipoPlano = "fixo" | "parcelamento" | "pagamento" | "meta" | "receita";

export interface Plano {
  id: number;
  tipo: TipoPlano;
  nome: string;
  categoria: string | null;
  valor: number;
  mes_inicio: string; // 'AAAA-MM'
  mes_fim: string | null; // 'AAAA-MM' (opcional)
  parcelas: number | null; // só parcelamento
  ativo: boolean;
  ordem: number;
  // item pago no cartão de crédito (entra no total do cartão, sem somar em dobro)
  no_cartao?: boolean;
  // linha especial: representa o TOTAL do cartão (orçamento mensal digitado), não é um item comum
  eh_cartao_total?: boolean;
  // linha especial: orçamento mensal previsto da conta variável (gastos fora dos recorrentes)
  eh_conta_total?: boolean;
  // vínculo opcional a lançamentos reais (usado na visão "Mês": previsto × realizado)
  link_categoria?: string | null;
  link_texto?: string | null;
}

export const TIPOS: { v: TipoPlano; label: string; icon: string; receita?: boolean }[] = [
  { v: "fixo", label: "Gastos fixos", icon: "🔁" },
  { v: "parcelamento", label: "Parcelamentos", icon: "💳" },
  { v: "pagamento", label: "Pagamentos futuros", icon: "📌" },
  { v: "meta", label: "Metas / caixinhas", icon: "✈️" },
  { v: "receita", label: "Receitas previstas", icon: "💰", receita: true },
];

export const ehReceitaTipo = (t: TipoPlano) => t === "receita";

/** Mês corrente no formato 'AAAA-MM'. */
export const mesAtual = () => {
  const h = new Date();
  return h.getFullYear() + "-" + String(h.getMonth() + 1).padStart(2, "0");
};

/** Diferença em meses entre dois 'AAAA-MM' (b - a). */
export const mesesEntre = (a: string, b: string) =>
  (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7));

/** Último mês em que o item ainda lança (ou null se for indefinido). */
export function fimEfetivo(p: Plano): string | null {
  switch (p.tipo) {
    case "parcelamento":
      return dvAddMes(p.mes_inicio, Math.max(1, p.parcelas || 1) - 1);
    case "pagamento":
      return p.mes_inicio;
    case "meta":
      return p.mes_fim || p.mes_inicio;
    default: // fixo / receita: pode não ter fim
      return p.mes_fim;
  }
}

/** Quanto o item contribui no mês `mk` (sempre o "tamanho" positivo do item). */
export function contribNoMes(p: Plano, mk: string): number {
  if (mk < p.mes_inicio) return 0;
  switch (p.tipo) {
    case "fixo":
    case "receita":
      return p.mes_fim && mk > p.mes_fim ? 0 : p.valor;
    case "pagamento":
      return mk === p.mes_inicio ? p.valor : 0;
    case "parcelamento": {
      const fim = dvAddMes(p.mes_inicio, Math.max(1, p.parcelas || 1) - 1);
      return mk <= fim ? p.valor : 0;
    }
    case "meta": {
      const fim = p.mes_fim || p.mes_inicio;
      if (mk > fim) return 0;
      const n = mesesEntre(p.mes_inicio, fim) + 1; // inclusivo
      return n > 0 ? p.valor / n : 0;
    }
  }
  return 0;
}

export interface ProjMes {
  k: string; label: string;
  // mesmos 3 baldes que NÃO se sobrepõem da visão "Mês" (nada conta em dobro):
  recorr: number;   // gastos recorrentes (fixos mensais), qualquer forma de pagamento
  contaVar: number; // gastos na conta FORA os recorrentes (= contaOrc + contaOutros)
  contaOrc: number; // └─ parte "gerais": orçamento previsto da conta
  contaOutros: number; // └─ parte "outros": avulsos na conta (parcelas/metas/pagamentos)
  cartaoVar: number;// gastos no cartão FORA os recorrentes já marcados
  cartao: number;   // total no cartão: orçamento definido, senão soma dos itens marcados
  gerais: number;   // recorr + contaVar + cartaoVar (consolidado, sem contar em dobro)
  receita: number; saldo: number;
}

/** Lista de N meses a partir de `start` (default: mês atual). */
export function horizonte(n: number, start = mesAtual()): { k: string; label: string }[] {
  return Array.from({ length: n }, (_, i) => {
    const k = dvAddMes(start, i);
    return { k, label: dvLabel(k) };
  });
}

/**
 * Projeção consolidada por mês: gastos na conta, total no cartão, gerais e saldo.
 * `cartaoPlano` (opcional) é a linha especial com o orçamento mensal do cartão; quando
 * não há orçamento, o total do cartão cai na soma dos itens marcados (no_cartao).
 * `contaPlano` (opcional) é a linha especial com o orçamento mensal da conta variável
 * (o "previsto" definido na visão Mês via "↑ orçar"); ele SOMA com os itens avulsos
 * não-recorrentes fora do cartão (metas/parcelas/pagamentos) para formar a conta variável.
 * Itens marcados NÃO entram em `conta` — eles já estão dentro do total do cartão.
 * `ovr` (opcional) traz ajustes manuais por mês: ovr[competencia][plano_id] sobrepõe o
 * valor calculado daquele item naquele mês (usado pela edição por duplo clique).
 */
export function projetar(
  planos: Plano[],
  meses: { k: string }[],
  cartaoPlano?: Plano | null,
  contaPlano?: Plano | null,
  receitaPlano?: Plano | null,
  ovr?: Record<string, Record<number, number>>,
): ProjMes[] {
  return meses.map(({ k }) => {
    let recorr = 0, recorrNoCartao = 0, contaVarItens = 0, flag = 0, receita = 0;
    for (const p of planos) {
      if (!p.ativo) continue;
      const o = ovr?.[k]?.[p.id];
      const v = o != null ? o : contribNoMes(p, k);
      if (!v) continue;
      if (ehReceitaTipo(p.tipo)) { receita += v; continue; }
      if (p.no_cartao) flag += v;          // todo item marcado entra no total do cartão
      const recorrente = p.tipo === "fixo"; // recorrente = gasto fixo mensal
      if (recorrente) {
        recorr += v;                        // 1) recorrentes (qualquer forma de pagamento)
        if (p.no_cartao) recorrNoCartao += v;
      } else if (!p.no_cartao) {
        contaVarItens += v;                 // itens não-recorrentes fora do cartão
      }
    }
    const orc = cartaoPlano && cartaoPlano.ativo ? contribNoMes(cartaoPlano, k) : 0;
    const cartao = orc > 0 ? orc : flag;    // orçamento definido; sem ele, soma dos itens marcados
    const cartaoVar = Math.max(0, cartao - recorrNoCartao); // 3) cartão fora dos recorrentes marcados
    // 2) conta variável = orçamento previsto (visão Mês) + itens avulsos na conta
    //    (metas/parcelas/pagamentos fora do cartão). Os dois SOMAM: o orçamento é
    //    o gasto corriqueiro estimado; os itens são despesas planejadas específicas.
    const orcConta = contaPlano && contaPlano.ativo ? contribNoMes(contaPlano, k) : 0;
    const contaVar = orcConta + contaVarItens;
    const gerais = recorr + contaVar + cartaoVar; // baldes disjuntos — nada soma em dobro
    // receita prevista (linha especial): valor-base do mês, com ajuste por mês (override no plano_mensal)
    const recOvr = receitaPlano && receitaPlano.ativo ? ovr?.[k]?.[receitaPlano.id] : undefined;
    const receitaBudget = recOvr != null ? recOvr : (receitaPlano && receitaPlano.ativo ? contribNoMes(receitaPlano, k) : 0);
    const receitaTotal = receita + receitaBudget;
    return { k, label: dvLabel(k), recorr, contaVar, contaOrc: orcConta, contaOutros: contaVarItens, cartaoVar, cartao, gerais, receita: receitaTotal, saldo: receitaTotal - gerais };
  });
}
