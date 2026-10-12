import type { Lancamento } from "../types";
import { dvAddMes, dvDiasNoMes, dvLabel, mesComp, valorGasto, valorReceita } from "./finance";
import { type Plano, contribNoMes, ehReceitaTipo, fimEfetivo, mesAtual, mesesEntre } from "./projecao";

/* ============================================================
   Agenda de pagamentos do Planejamento — lógica pura (sem React).

   Cada item do plano (`planos`) vira uma OCORRÊNCIA por mês, com
   vencimento, status e valores previsto × realizado. O registro do
   mês (`plano_mensal`) guarda o valor e se foi pago. Como no resto
   do app, o mesmo `valor_real` tem dois papéis:
     • mês que já começou (atual/passado) → o valor REAL pago;
     • mês futuro                          → AJUSTE do previsto só naquele mês.
   ============================================================ */

export interface Mensal { valor_real: number | null; pago: boolean; nota?: string | null }
/** competência ('AAAA-MM') → plano_id → registro do mês */
export type MensalMap = Record<string, Record<number, Mensal>>;
/** plano_id → competência → soma dos lançamentos vinculados */
export type AutosMap = Record<number, Record<string, number>>;

export type Status = "pago" | "atrasado" | "hoje" | "proximo" | "pendente" | "projetado" | "sem_registro";

export const STATUS_INFO: Record<Status, { label: string; icon: string; cls: string }> = {
  pago: { label: "Pago", icon: "✓", cls: "bg-green/10 text-green" },
  atrasado: { label: "Atrasado", icon: "!", cls: "bg-red/10 text-red" },
  hoje: { label: "Vence hoje", icon: "●", cls: "bg-amber/15 text-amber" },
  proximo: { label: "Em breve", icon: "◔", cls: "bg-amber/15 text-amber" },
  pendente: { label: "A pagar", icon: "○", cls: "bg-accent/10 text-accent" },
  projetado: { label: "Previsto", icon: "…", cls: "bg-fill text-muted" },
  sem_registro: { label: "Sem registro", icon: "–", cls: "bg-fill text-muted" },
};

export interface Ocorrencia {
  p: Plano;
  k: string;              // competência
  key: string;            // `${plano_id}|${k}`
  dia: number | null;     // dia do vencimento no mês (null = item sem dia definido)
  venc: Date | null;
  previsto: number;       // pela regra do item
  ajuste: number | null;  // mês futuro: valor ajustado só naquele mês
  real: number | null;    // mês iniciado: valor pago (digitado, senão lançado vinculado)
  auto: number | null;    // soma dos lançamentos vinculados no mês
  valor: number;          // o que mostrar/somar: real ?? ajuste ?? previsto
  pago: boolean;
  nota: string;
  parcela: string | null; // "3/10" em parcelamentos e metas
  status: Status;
}

export const FORMAS = ["Pix", "Boleto", "Cartão de crédito", "Débito automático", "Transferência", "Dinheiro"];
export const LEMBRAR_OPCOES: { v: number; label: string }[] = [
  { v: 0, label: "No dia" }, { v: 1, label: "1 dia antes" }, { v: 3, label: "3 dias antes" },
  { v: 5, label: "5 dias antes" }, { v: 7, label: "7 dias antes" },
];
export const DIAS_SEM = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MESES_LONGO = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export const mesLongo = (k: string) => `${MESES_LONGO[+k.slice(5, 7) - 1]} ${k.slice(0, 4)}`;

export const hoje0 = () => { const h = new Date(); return new Date(h.getFullYear(), h.getMonth(), h.getDate()); };
export const diasAte = (d: Date, ref = hoje0()) => Math.round((d.getTime() - ref.getTime()) / 86400000);
export const dataCurta = (d: Date) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;

/** despesa programada (exclui receitas e as linhas especiais de orçamento) */
export const ehDespesa = (p: Plano) => !ehReceitaTipo(p.tipo);
/** recorrente = gasto fixo mensal; o resto (parcelamento, pagamento, meta) é não recorrente */
export const ehRecorrente = (p: Plano) => p.tipo === "fixo";

export const TIPO_LABEL: Record<Plano["tipo"], string> = {
  fixo: "Recorrente", parcelamento: "Parcelado", pagamento: "Pagamento único", meta: "Meta / caixinha", receita: "Receita",
};

/** Mapa de lançamentos vinculados (link_categoria / link_texto) somados por item e mês. */
export function calcAutos(planos: Plano[], lancamentos: Lancamento[], comps: Set<string>): AutosMap {
  const linkados = planos.filter((p) => p.link_categoria || p.link_texto);
  const out: AutosMap = {};
  if (!linkados.length) return out;
  for (const d of lancamentos) {
    const c = mesComp(d);
    if (!comps.has(c)) continue;
    const g = valorGasto(d);
    if (g <= 0) continue; // só gasto real (não interno, não estorno)
    const desc = String(d.descricao || "").toLowerCase();
    for (const p of linkados) {
      if (p.link_categoria && d.categoria_manual !== p.link_categoria) continue;
      if (p.link_texto && !desc.includes(p.link_texto.toLowerCase())) continue;
      const m = (out[p.id] ||= {});
      m[c] = Math.round(((m[c] || 0) + g) * 100) / 100;
    }
  }
  return out;
}

/** Receita que de fato entrou (lançamentos classe Receita, não internos) por competência. */
export function receitasReais(lancamentos: Lancamento[], comps: Set<string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of lancamentos) {
    const c = mesComp(d);
    if (!comps.has(c)) continue;
    const r = valorReceita(d);
    if (r > 0) out[c] = (out[c] || 0) + r;
  }
  return out;
}

function parcelaDe(p: Plano, k: string): string | null {
  if (p.tipo === "parcelamento") return `${mesesEntre(p.mes_inicio, k) + 1}/${Math.max(1, p.parcelas || 1)}`;
  if (p.tipo === "meta") {
    const fim = p.mes_fim || p.mes_inicio;
    return `${mesesEntre(p.mes_inicio, k) + 1}/${mesesEntre(p.mes_inicio, fim) + 1}`;
  }
  return null;
}

/** Ocorrência do item `p` no mês `k` (null quando o item não lança nada naquele mês). */
export function ocorrencia(p: Plano, k: string, mensal: MensalMap, autos: AutosMap, ref = hoje0()): Ocorrencia | null {
  if (!p.ativo) return null;
  const atual = `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, "0")}`;
  const reg = mensal[k]?.[p.id];
  const previsto = contribNoMes(p, k);
  const auto = autos[p.id]?.[k] ?? null;
  const vr = reg?.valor_real ?? null;
  if (!previsto && vr == null && auto == null) return null;

  const futuro = k > atual;
  const ajuste = futuro ? vr : null;
  const real = futuro ? null : (vr ?? auto);
  const pago = !!reg?.pago || real != null;
  const dia = p.dia_venc ? Math.min(p.dia_venc, dvDiasNoMes(k)) : null;
  const venc = dia ? new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, dia) : null;

  let status: Status;
  if (pago) status = "pago";
  else if (k < atual) status = "sem_registro";
  else if (!venc) status = futuro ? "projetado" : "pendente";
  else {
    const d = diasAte(venc, ref);
    status = d < 0 ? "atrasado" : d === 0 ? "hoje" : d <= Math.max(7, p.lembrar_dias || 0) ? "proximo" : futuro ? "projetado" : "pendente";
  }
  return {
    p, k, key: `${p.id}|${k}`, dia, venc, previsto, ajuste, real, auto,
    valor: real ?? ajuste ?? previsto, pago, nota: reg?.nota || "", parcela: parcelaDe(p, k), status,
  };
}

/** Ocorrências de despesas de um mês, ordenadas por vencimento (itens sem dia no fim). */
export function ocorrenciasMes(planos: Plano[], k: string, mensal: MensalMap, autos: AutosMap): Ocorrencia[] {
  return planos
    .filter(ehDespesa)
    .map((p) => ocorrencia(p, k, mensal, autos))
    .filter((o): o is Ocorrencia => !!o)
    .sort((a, b) => (a.dia ?? 99) - (b.dia ?? 99) || b.valor - a.valor);
}

/** Contas ainda não pagas que vencem até `dias` à frente (inclui as atrasadas do mês). */
export function aPagar(planos: Plano[], mensal: MensalMap, autos: AutosMap, dias = 7): Ocorrencia[] {
  const k0 = mesAtual();
  return [k0, dvAddMes(k0, 1)]
    .flatMap((k) => ocorrenciasMes(planos, k, mensal, autos))
    .filter((o) => !o.pago && o.venc && diasAte(o.venc) <= dias);
}

/** Valor realizado de uma ocorrência num mês já iniciado: real, senão o previsto se marcado como pago. */
export const realizado = (o: Ocorrencia): number | null => (o.real != null ? o.real : o.pago ? o.previsto : null);

/** Descrição curta da regra do item ("todo dia 10", "10× de R$ 300 · jun/26 → mar/27"…). */
export function descreveRegra(p: Plano, BRL: (v: number) => string): string {
  const dia = p.dia_venc ? `dia ${p.dia_venc}` : "sem dia definido";
  switch (p.tipo) {
    case "fixo":
    case "receita":
      return `todo mês · ${dia}` + (p.mes_fim ? ` · até ${dvLabel(p.mes_fim)}` : "");
    case "parcelamento":
      return `${p.parcelas || 1}× de ${BRL(p.valor)} · ${dvLabel(p.mes_inicio)} → ${dvLabel(fimEfetivo(p) || p.mes_inicio)} · ${dia}`;
    case "pagamento":
      return `${p.dia_venc ? String(p.dia_venc).padStart(2, "0") + "/" : ""}${dvLabel(p.mes_inicio)} · uma vez`;
    case "meta": {
      const fim = p.mes_fim || p.mes_inicio;
      const n = mesesEntre(p.mes_inicio, fim) + 1;
      return `${BRL(p.valor)} até ${dvLabel(fim)} · ${BRL(p.valor / Math.max(1, n))}/mês`;
    }
  }
  return "";
}

/** Progresso de um compromisso finito (parcelamento/meta/pagamento): meses pagos × total. */
export function progresso(p: Plano, mensal: MensalMap, autos: AutosMap) {
  const fim = fimEfetivo(p) || p.mes_inicio;
  const n = mesesEntre(p.mes_inicio, fim) + 1;
  let pagas = 0, pagoValor = 0, total = 0;
  for (let i = 0; i < n; i++) {
    const k = dvAddMes(p.mes_inicio, i);
    const o = ocorrencia({ ...p, ativo: true }, k, mensal, autos);
    if (!o) continue;
    total += o.valor;
    if (o.pago) { pagas++; pagoValor += realizado(o) ?? 0; }
  }
  return { pagas, n, total, pagoValor, restante: Math.max(0, total - pagoValor), fim };
}

export interface PontoFluxo { dia: number; saldo: number; entradas: number; saidas: number }

/**
 * Saldo em conta dia a dia no mês `k`, a partir de `saldoInicial` no dia `diaInicio`.
 * Saídas = ocorrências ainda não pagas no vencimento (atrasadas e itens sem dia
 * contam no primeiro dia da janela, por prudência); entradas = receitas previstas no dia delas.
 */
export function fluxoMes(
  k: string, ocs: Ocorrencia[], receitas: { dia: number; valor: number }[],
  saldoInicial: number, diaInicio = 1,
): PontoFluxo[] {
  const nd = dvDiasNoMes(k);
  const out: PontoFluxo[] = [];
  let s = saldoInicial;
  for (let d = diaInicio; d <= nd; d++) {
    const saidas = ocs
      .filter((o) => !o.pago && Math.max(o.dia ?? diaInicio, diaInicio) === d)
      .reduce((a, o) => a + o.valor, 0);
    const entradas = receitas.filter((r) => Math.min(r.dia, nd) === d).reduce((a, r) => a + r.valor, 0);
    s += entradas - saidas;
    out.push({ dia: d, saldo: s, entradas, saidas });
  }
  return out;
}
