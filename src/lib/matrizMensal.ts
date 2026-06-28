// Matriz mensal (categorias x meses) — modulo PURO, sem React.
// Eixo do mes = COMPETENCIA (via mesComp). Agrega receita, gasto e investido,
// alimentando a tabela de calor e o drill-down por celula.
import type { Lancamento } from "../types";
import {
  catKey, mesComp, valorGasto, valorReceita, valorAporte, valorReceitaInvest,
  corCategoria, CATEGORIAS,
} from "./finance";

export type SecaoMatriz = "receita" | "gasto" | "investido";

export interface LinhaMatriz {
  key: string;                 // estavel: "gasto:Moradia", "total:gasto", "saldo", "investido:aporte"
  label: string;
  secao: SecaoMatriz | "saldo";
  catRaw: string | null;       // categoria canonica p/ drill-down (null em totais/saldo)
  cor: string | null;          // corCategoria(cat) p/ a bolinha, ou null
  ehTotal: boolean;            // linha de total/saldo (negrito, nao arrasta, nao recebe cor de categoria)
  valores: Record<string, number>;   // mesKey "YYYY-MM" -> valor (presente p/ TODOS os meses visiveis)
  total: number;               // soma nos meses visiveis
  delta: number;               // ultimo mes - penultimo (0 se <2 meses)
  deltaPct: number | null;     // % vs penultimo (null se base 0 ou <2 meses)
}

export interface SecaoInfo {
  secao: SecaoMatriz;
  titulo: string;              // "Receita" / "Gastos" / "Investido"
  linhas: LinhaMatriz[];       // linhas de categoria (SEM a de total)
  totalLinha: LinhaMatriz;     // linha "Total ..."
  maxAbs: number;              // max |valor| entre celulas das linhas de categoria (p/ tintSequencial)
  maxDeltaAbs: number;         // max |delta| entre linhas de categoria (p/ tintDivergente)
  bomQuandoSobe: boolean;      // receita/investido: true; gasto: false
}

export interface MatrizMensal {
  meses: string[];             // mesKeys "YYYY-MM" mais antigo->recente; ultimo = selecionado
  secoes: SecaoInfo[];         // ordem: receita, gasto, e investido (so se houver dados)
  saldo: LinhaMatriz;          // Saldo = totalReceita - totalGasto por mes
}

export interface MatrizOpts { mesSelecionado: string; nMeses: number; }

// categoria de RECEITA — receitas nao tem taxonomia fixa (ver contrato).
export function recCat(d: Lancamento): string {
  return d.categoria_manual || d.categoria_auto || d.subtipo || d.detalhe || "Outros";
}

// Receita exibida em apenas 2 grupos: "Salario" (fontes recorrentes) e "Outros".
// As categorias abaixo (entre contas proprias, transfers, salario) viram "Salario";
// qualquer outra receita cai em "Outros".
const RECEITA_SALARIO = new Set(["salario", "entre contas proprias", "transfers"]);
function normReceita(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();
}
export function grupoReceita(d: Lancamento): string {
  return RECEITA_SALARIO.has(normReceita(recCat(d))) ? "Salário" : "Outros";
}

// meses unicos com dados (competencia "YYYY-MM"), ordenados asc.
export function mesesDisponiveis(dados: Lancamento[]): string[] {
  return [...new Set(dados.map(mesComp))].filter((k) => /^\d{4}-\d{2}$/.test(k)).sort();
}

// preenche valores[mes]=0 p/ todos os meses visiveis (presenca garantida).
function zerados(meses: string[]): Record<string, number> {
  const v: Record<string, number> = {};
  for (const m of meses) v[m] = 0;
  return v;
}

// completa total/delta/deltaPct de uma linha a partir de seus valores e dos meses.
function finalizaLinha(linha: LinhaMatriz, meses: string[]): LinhaMatriz {
  let total = 0;
  for (const m of meses) total += linha.valores[m] || 0;
  linha.total = total;
  const last = meses[meses.length - 1];
  const prev = meses[meses.length - 2];
  if (meses.length < 2) {
    linha.delta = 0;
    linha.deltaPct = null;
  } else {
    const vLast = linha.valores[last] || 0;
    const vPrev = linha.valores[prev] || 0;
    linha.delta = vLast - vPrev;
    linha.deltaPct = vPrev !== 0 ? (linha.delta / Math.abs(vPrev)) * 100 : null;
  }
  return linha;
}

// monta a totalLinha de uma secao somando as linhas de categoria por mes.
function totalDaSecao(
  secao: SecaoMatriz, label: string, linhas: LinhaMatriz[], meses: string[],
): LinhaMatriz {
  const valores = zerados(meses);
  for (const ln of linhas) for (const m of meses) valores[m] += ln.valores[m] || 0;
  return finalizaLinha({
    key: "total:" + secao, label, secao, catRaw: null, cor: null,
    ehTotal: true, valores, total: 0, delta: 0, deltaPct: null,
  }, meses);
}

// maxAbs e maxDeltaAbs sobre as linhas de categoria (sem o total).
function escalas(linhas: LinhaMatriz[], meses: string[]): { maxAbs: number; maxDeltaAbs: number } {
  let maxAbs = 0, maxDeltaAbs = 0;
  for (const ln of linhas) {
    for (const m of meses) maxAbs = Math.max(maxAbs, Math.abs(ln.valores[m] || 0));
    maxDeltaAbs = Math.max(maxDeltaAbs, Math.abs(ln.delta));
  }
  return { maxAbs, maxDeltaAbs };
}

export function construirMatriz(dados: Lancamento[], opts: MatrizOpts): MatrizMensal {
  const n = Math.max(1, opts.nMeses);
  const meses = mesesDisponiveis(dados)
    .filter((k) => k <= opts.mesSelecionado)
    .slice(-n);
  const mesesSet = new Set(meses);

  // ---- GASTO: todas as CATEGORIAS (mesmo zeradas) + catKeys extras presentes ----
  const catGasto = CATEGORIAS.filter(Boolean) as string[];
  const catGastoSet = new Set(catGasto);
  for (const d of dados) {
    if (!mesesSet.has(mesComp(d))) continue;
    if (valorGasto(d) === 0) continue;
    const c = catKey(d);
    if (!catGastoSet.has(c)) { catGastoSet.add(c); catGasto.push(c); }
  }
  const valoresGasto: Record<string, Record<string, number>> = {};
  for (const c of catGasto) valoresGasto[c] = zerados(meses);
  for (const d of dados) {
    const mk = mesComp(d);
    if (!mesesSet.has(mk)) continue;
    const v = valorGasto(d);
    if (v === 0) continue;
    valoresGasto[catKey(d)][mk] += v;
  }
  const linhasGasto = catGasto
    .map((c) => finalizaLinha({
      key: "gasto:" + c, label: c, secao: "gasto", catRaw: c, cor: corCategoria(c),
      ehTotal: false, valores: valoresGasto[c], total: 0, delta: 0, deltaPct: null,
    }, meses))
    // omite categorias sem nenhum valor nos meses visiveis (linhas 100% zeradas).
    .filter((ln) => meses.some((m) => (ln.valores[m] || 0) !== 0));
  const totalGasto = totalDaSecao("gasto", "Total Gastos", linhasGasto, meses);
  const escGasto = escalas(linhasGasto, meses);
  const secaoGasto: SecaoInfo = {
    secao: "gasto", titulo: "Gastos", linhas: linhasGasto, totalLinha: totalGasto,
    maxAbs: escGasto.maxAbs, maxDeltaAbs: escGasto.maxDeltaAbs, bomQuandoSobe: false,
  };

  // ---- RECEITA: agrupada em 2 baldes (grupoReceita): "Salário" e "Outros" ----
  const valoresRec: Record<string, Record<string, number>> = {};
  for (const d of dados) {
    const mk = mesComp(d);
    if (!mesesSet.has(mk)) continue;
    if (valorReceita(d) <= 0) continue;
    const c = grupoReceita(d);
    (valoresRec[c] = valoresRec[c] || zerados(meses))[mk] += valorReceita(d);
  }
  let linhasRec = Object.keys(valoresRec).map((c) => finalizaLinha({
    key: "receita:" + c, label: c, secao: "receita", catRaw: c, cor: corCategoria(c),
    ehTotal: false, valores: valoresRec[c], total: 0, delta: 0, deltaPct: null,
  }, meses));
  // ordem fixa: "Salário" antes de "Outros"; empate desfeito por total desc.
  linhasRec = linhasRec.sort((a, b) =>
    (a.label === "Salário" ? 0 : 1) - (b.label === "Salário" ? 0 : 1) || b.total - a.total);
  const totalRec = totalDaSecao("receita", "Total Receita", linhasRec, meses);
  const escRec = escalas(linhasRec, meses);
  const secaoRec: SecaoInfo = {
    secao: "receita", titulo: "Receita", linhas: linhasRec, totalLinha: totalRec,
    maxAbs: escRec.maxAbs, maxDeltaAbs: escRec.maxDeltaAbs, bomQuandoSobe: true,
  };

  // ---- INVESTIDO: duas linhas fixas (aporte + renda de investimentos) ----
  const valAporte = zerados(meses), valRecInv = zerados(meses);
  for (const d of dados) {
    const mk = mesComp(d);
    if (!mesesSet.has(mk)) continue;
    valAporte[mk] += valorAporte(d);
    valRecInv[mk] += valorReceitaInvest(d);
  }
  const linhaAporte = finalizaLinha({
    key: "investido:aporte", label: "Investido (aportes)", secao: "investido",
    catRaw: "aporte", cor: null, ehTotal: false, valores: valAporte,
    total: 0, delta: 0, deltaPct: null,
  }, meses);
  const linhaRecInv = finalizaLinha({
    key: "investido:recinv", label: "Renda de investimentos", secao: "investido",
    catRaw: "recinv", cor: null, ehTotal: false, valores: valRecInv,
    total: 0, delta: 0, deltaPct: null,
  }, meses);
  const linhasInv = [linhaAporte, linhaRecInv];
  const totalInv = totalDaSecao("investido", "Total Investido", linhasInv, meses);
  const escInv = escalas(linhasInv, meses);
  const secaoInv: SecaoInfo = {
    secao: "investido", titulo: "Investido", linhas: linhasInv, totalLinha: totalInv,
    maxAbs: escInv.maxAbs, maxDeltaAbs: escInv.maxDeltaAbs, bomQuandoSobe: true,
  };
  // so inclui investido se houver algum valor > 0 em algum mes visivel
  const temInvestido = meses.some((m) => (valAporte[m] || 0) > 0 || (valRecInv[m] || 0) > 0);

  // ---- SALDO = total receita - total gasto, por mes ----
  const valoresSaldo = zerados(meses);
  for (const m of meses) valoresSaldo[m] = (totalRec.valores[m] || 0) - (totalGasto.valores[m] || 0);
  const saldo = finalizaLinha({
    key: "saldo", label: "Saldo", secao: "saldo", catRaw: null, cor: null,
    ehTotal: true, valores: valoresSaldo, total: 0, delta: 0, deltaPct: null,
  }, meses);

  const secoes: SecaoInfo[] = [secaoRec, secaoGasto];
  if (temInvestido) secoes.push(secaoInv);

  return { meses, secoes, saldo };
}

// lancamentos de uma celula (secao x categoria x mes) — drill-down do modal.
// Usa os MESMOS criterios da agregacao (recCat/catKey) p/ consistencia.
export function lancamentosDaCelula(
  dados: Lancamento[], secao: SecaoMatriz | "saldo", catRaw: string | null, mes: string,
): Lancamento[] {
  return dados.filter((d) => {
    if (mesComp(d) !== mes) return false;
    if (secao === "gasto") {
      return valorGasto(d) !== 0 && (catRaw == null || catKey(d) === catRaw);
    }
    if (secao === "receita") {
      return valorReceita(d) > 0 && (catRaw == null || grupoReceita(d) === catRaw);
    }
    if (secao === "investido") {
      if (catRaw === "aporte") return valorAporte(d) > 0;
      if (catRaw === "recinv") return valorReceitaInvest(d) > 0;
      return valorAporte(d) > 0 || valorReceitaInvest(d) > 0;
    }
    // saldo
    return valorGasto(d) !== 0 || valorReceita(d) > 0;
  });
}
