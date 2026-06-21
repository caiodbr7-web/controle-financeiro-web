// ============================================================================
// Conciliação PDF × Open Finance (Pluggy)
// ----------------------------------------------------------------------------
// Compara os lançamentos que vieram de arquivo (fonte_dados != 'pluggy') com os
// que vieram do Open Finance ('pluggy') e classifica em três baldes:
//   - pares       : a MESMA transação aparece nas duas fontes (duplicata provável)
//   - soOF        : só no Open Finance (PDF não tinha / parser não pegou / futuro)
//   - soPDF       : só no PDF, DENTRO da janela de sobreposição (OF não trouxe)
//
// REGRA DE OURO: o casamento exige MÚLTIPLOS sinais (valor + data próxima + tipo
// + banco/descrição) e devolve um nível de CONFIANÇA. Nada é apagado aqui — a
// resolução é decisão do usuário. Casar só por valor+data gera falso-positivo
// (valores redondos coincidem), então isso nunca basta sozinho para "alta".
//
// MITIGAÇÕES (atenuam divergências comuns sem inflar a confiança alta):
//   (6) VALOR APROXIMADO  — além do valor exato, casa com uma pequena tolerância
//       de reais (arredondamento de parcela, estorno parcial, gorjeta). Match
//       aproximado SÓ vale se houver banco ou descrição confirmando, e nunca
//       chega a "alta".
//   (7) MOEDA ESTRANGEIRA — OF em moeda != BRL não dá para casar por valor em
//       real, mas tentamos por DESCRIÇÃO + DATA + CÂMBIO PLAUSÍVEL (a taxa
//       implícita BRL/moeda tem que cair numa faixa sã). O que casar vira par;
//       o que sobrar fica em `ofEstrangeiro`.
//   (8) CARTÃO × CONTA    — antes "cartão só casa com cartão" descartava o par.
//       Agora casa mesmo com tipo diferente, porém vira só um SINAL de confiança
//       (tipo diferente não pode ser "alta").
//
// Cada par carrega `via`, dizendo COMO casou (exato / valor~ / moeda / tipo),
// para o diagnóstico deixar claro quando a regra foi relaxada.
// ============================================================================
import type { Lancamento } from "../types";
import { dvDataReal, bankOf, normEstab, mesReal, ehGasto, ehReceita } from "./finance";

export type Conf = "alta" | "media" | "baixa";
/** Como o par casou — "exato" é o caminho estrito; os demais são relaxamentos. */
export type Via = "exato" | "valor" | "moeda" | "tipo";

/** True se o `valor` da linha está em BRL (sem moeda definida = BRL, retrocompat). */
const ehBRL = (d: Lancamento) => !d.moeda || d.moeda.toUpperCase() === "BRL";

export interface Par {
  of: Lancamento;
  pdf: Lancamento;
  dias: number;          // diferença de dias entre as datas reais
  conf: Conf;
  mesmoBanco: boolean;
  descParecida: boolean;
  tipoIgual: boolean;    // cartão↔cartão / conta↔conta (false = casou tipos diferentes)
  via: Via;              // como casou (relaxamento aplicado)
}

export interface Resultado {
  pares: Par[];
  soOF: Lancamento[];
  soPDF: Lancamento[];
  ofEstrangeiro: Lancamento[]; // OF em moeda != BRL que NEM ASSIM casou — fora do cruzamento
  janela: { ini: number; fim: number } | null; // sobreposição (ms epoch)
}

// ----------------------------------------------------------------------------
// Totais por mês × fonte (gastos e receitas) — base do "placar" PDF × Pluggy.
// Agrupa pela DATA REAL do movimento (mesReal), e não pela competência: assim
// uma compra de maio entra em maio nas duas fontes, mesmo que a fatura do PDF
// caia numa competência diferente. Só soma valores em BRL (o `valor` de linhas
// em moeda estrangeira não é comparável em real); essas ficam contadas à parte.
// ----------------------------------------------------------------------------
export interface TotaisFonte {
  gas: number;   // soma de gastos (R$, positivo)
  rec: number;   // soma de receitas (R$, positivo)
  nGas: number;  // qtd de lançamentos de gasto
  nRec: number;  // qtd de lançamentos de receita
  estrangeiro: number; // qtd de linhas em moeda != BRL ignoradas na soma
}
export interface TotaisMes { mes: string; pdf: TotaisFonte; of: TotaisFonte; }

const novoTotal = (): TotaisFonte => ({ gas: 0, rec: 0, nGas: 0, nRec: 0, estrangeiro: 0 });

function acumula(t: TotaisFonte, d: Lancamento) {
  if (!ehBRL(d)) { t.estrangeiro++; return; }
  if (ehGasto(d.classe)) { t.gas += Math.abs(d.valor); t.nGas++; }
  else if (ehReceita(d.classe)) { t.rec += Math.abs(d.valor); t.nRec++; }
}

/** Totais de gastos/receitas por mês (YYYY-MM), separados em PDF × Open Finance. */
export function totaisPorMes(rows: Lancamento[]): TotaisMes[] {
  const mapa = new Map<string, TotaisMes>();
  for (const d of rows) {
    const m = mesReal(d);
    if (!m) continue;
    let t = mapa.get(m);
    if (!t) { t = { mes: m, pdf: novoTotal(), of: novoTotal() }; mapa.set(m, t); }
    acumula(d.fonte_dados === "pluggy" ? t.of : t.pdf, d);
  }
  return [...mapa.values()].sort((a, b) => b.mes.localeCompare(a.mes));
}

const DIA = 86_400_000;
const abs = (v: number) => Math.abs(v);
const cent = (v: number) => Math.round(abs(v) * 100);

// (6) tolerância de valor (R$) para casar quando não bate exato: 2% do valor,
// limitada a [R$1, R$50]. Pequena de propósito — e sempre exige corroboração.
const tolValor = (v: number) => Math.min(50, Math.max(1, abs(v) * 0.02));

// (7) faixa de câmbio plausível (BRL por unidade estrangeira). Cobre USD≈5,
// EUR≈6, GBP≈7 e afins; descarta coincidências absurdas.
const RATE_MIN = 2.5;
const RATE_MAX = 8;

/** Data real do movimento (compra) em ms epoch; null se data_mov inválida. */
export function realMs(d: Lancamento): number | null {
  const r = dvDataReal(d);
  if (!r) return null;
  return new Date(+r.k.slice(0, 4), +r.k.slice(5, 7) - 1, r.d).getTime();
}

const ehCartao = (o: string) => String(o || "").startsWith("Cartao");

/** primeiro índice de `arr` (ordenado asc) com valor >= alvo. */
function lowerBound(arr: number[], alvo: number): number {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < alvo) lo = mid + 1; else hi = mid; }
  return lo;
}

interface Cand { row: Lancamento; ms: number | null; v: number; usado: boolean }

export function conciliar(rows: Lancamento[], tolDias = 3): Resultado {
  const ofTodos = rows.filter((d) => d.fonte_dados === "pluggy");
  const ofBRL = ofTodos.filter(ehBRL);
  const ofMoeda = ofTodos.filter((d) => !ehBRL(d)); // estrangeiros: tentaremos casar em (7)
  const pdf = rows.filter((d) => d.fonte_dados !== "pluggy" && ehBRL(d));

  // janela de sobreposição (interseção dos intervalos de data real das fontes).
  // usa todo o OF (BRL + estrangeiro), já que ambos têm data válida.
  const msOf = ofTodos.map(realMs).filter((x): x is number => x != null);
  const msPdf = pdf.map(realMs).filter((x): x is number => x != null);
  let janela: { ini: number; fim: number } | null = null;
  if (msOf.length && msPdf.length) {
    const ini = Math.max(Math.min(...msOf), Math.min(...msPdf));
    const fim = Math.min(Math.max(...msOf), Math.max(...msPdf));
    if (ini <= fim) janela = { ini, fim };
  }

  // PDFs ordenados por valor → busca por faixa de valor (binária) para (6)
  const cands: Cand[] = pdf
    .map((d) => ({ row: d, ms: realMs(d), v: abs(d.valor), usado: false }))
    .sort((a, b) => a.v - b.v);
  const valores = cands.map((c) => c.v);

  const pares: Par[] = [];
  const soOF: Lancamento[] = [];

  // ---- fase 1: OF em BRL (valor exato ou aproximado) ----------------------
  const ofBRLord = [...ofBRL].sort((a, b) => (realMs(a) ?? 0) - (realMs(b) ?? 0));
  for (const p of ofBRLord) {
    const pm = realMs(p);
    const pv = abs(p.valor);
    if (pm == null) { soOF.push(p); continue; }
    const tv = tolValor(pv);
    const lo = lowerBound(valores, pv - tv);

    let melhor: { c: Cand; dias: number; banco: boolean; desc: boolean; tipo: boolean; exato: boolean; score: number } | null = null;
    for (let i = lo; i < cands.length && cands[i].v <= pv + tv; i++) {
      const c = cands[i];
      if (c.usado || c.ms == null) continue;
      const dias = Math.abs(pm - c.ms) / DIA;
      if (dias > tolDias) continue;
      const banco = bankOf(p.banco) === bankOf(c.row.banco) && bankOf(p.banco) !== "outro";
      const np = normEstab(p.descricao);
      const desc = np.length > 2 && np === normEstab(c.row.descricao);
      const tipo = ehCartao(p.origem) === ehCartao(c.row.origem);
      const exato = cent(p.valor) === cent(c.row.valor);
      // valor aproximado (6) só é candidato se banco OU descrição confirmam
      if (!exato && !(banco || desc)) continue;
      // quanto mais perto do valor, melhor (penaliza a diferença em reais)
      const proxValor = exato ? 4 : Math.max(0, 4 - Math.abs(pv - c.v));
      const score = (tolDias - dias) + (banco ? 5 : 0) + (desc ? 5 : 0) + (tipo ? 2 : 0) + proxValor;
      if (!melhor || score > melhor.score) melhor = { c, dias, banco, desc, tipo, exato, score };
    }

    if (melhor) {
      melhor.c.usado = true;
      const { banco, desc, tipo, exato } = melhor;
      const conf: Conf =
        exato && banco && desc && tipo ? "alta"
        : (exato && (banco || desc)) || (desc && banco) ? "media"
        : "baixa";
      const via: Via = !tipo ? "tipo" : !exato ? "valor" : "exato";
      pares.push({ of: p, pdf: melhor.c.row, dias: Math.round(melhor.dias), conf, mesmoBanco: banco, descParecida: desc, tipoIgual: tipo, via });
    } else {
      soOF.push(p);
    }
  }

  // ---- fase 2: OF em moeda estrangeira (7) --------------------------------
  // não dá para casar por valor em BRL; usa descrição + data + câmbio plausível.
  const ofEstrangeiro: Lancamento[] = [];
  const ofMoedaOrd = [...ofMoeda].sort((a, b) => (realMs(a) ?? 0) - (realMs(b) ?? 0));
  for (const p of ofMoedaOrd) {
    const pm = realMs(p);
    const pf = abs(p.valor); // valor na moeda estrangeira
    if (pm == null || pf <= 0) { ofEstrangeiro.push(p); continue; }

    let melhor: { c: Cand; dias: number; banco: boolean; desc: boolean; tipo: boolean; score: number } | null = null;
    for (const c of cands) {
      if (c.usado || c.ms == null) continue;
      const dias = Math.abs(pm - c.ms) / DIA;
      if (dias > tolDias) continue;
      const rate = c.v / pf; // BRL por unidade estrangeira
      if (rate < RATE_MIN || rate > RATE_MAX) continue; // câmbio implausível → não é o par
      const banco = bankOf(p.banco) === bankOf(c.row.banco) && bankOf(p.banco) !== "outro";
      const np = normEstab(p.descricao);
      const desc = np.length > 2 && np === normEstab(c.row.descricao);
      const tipo = ehCartao(p.origem) === ehCartao(c.row.origem);
      // estrangeiro exige corroboração forte (banco ou descrição) — valor não confere
      if (!(banco || desc)) continue;
      const score = (tolDias - dias) + (banco ? 5 : 0) + (desc ? 6 : 0) + (tipo ? 2 : 0);
      if (!melhor || score > melhor.score) melhor = { c, dias, banco, desc, tipo, score };
    }

    if (melhor) {
      melhor.c.usado = true;
      const { banco, desc, tipo } = melhor;
      // moeda estrangeira nunca é "alta" (valor em BRL não foi conferido)
      const conf: Conf = banco && desc ? "media" : "baixa";
      pares.push({ of: p, pdf: melhor.c.row, dias: Math.round(melhor.dias), conf, mesmoBanco: banco, descParecida: desc, tipoIgual: tipo, via: "moeda" });
    } else {
      ofEstrangeiro.push(p);
    }
  }

  // só PDF: não-casados, mas dentro da janela de sobreposição
  const soPDF: Lancamento[] = [];
  if (janela) {
    for (const c of cands)
      if (!c.usado && c.ms != null && c.ms >= janela.ini && c.ms <= janela.fim) soPDF.push(c.row);
  }

  return { pares, soOF, soPDF, ofEstrangeiro, janela };
}
