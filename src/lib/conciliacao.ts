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
// ============================================================================
import type { Lancamento } from "../types";
import { dvDataReal, bankOf, normEstab } from "./finance";

export type Conf = "alta" | "media" | "baixa";

export interface Par {
  of: Lancamento;
  pdf: Lancamento;
  dias: number;          // diferença de dias entre as datas reais
  conf: Conf;
  mesmoBanco: boolean;
  descParecida: boolean;
}

export interface Resultado {
  pares: Par[];
  soOF: Lancamento[];
  soPDF: Lancamento[];
  janela: { ini: number; fim: number } | null; // sobreposição (ms epoch)
}

const DIA = 86_400_000;
const cent = (v: number) => Math.round(Math.abs(v) * 100);

/** Data real do movimento (compra) em ms epoch; null se data_mov inválida. */
export function realMs(d: Lancamento): number | null {
  const r = dvDataReal(d);
  if (!r) return null;
  return new Date(+r.k.slice(0, 4), +r.k.slice(5, 7) - 1, r.d).getTime();
}

const ehCartao = (o: string) => String(o || "").startsWith("Cartao");

export function conciliar(rows: Lancamento[], tolDias = 3): Resultado {
  const of = rows.filter((d) => d.fonte_dados === "pluggy");
  const pdf = rows.filter((d) => d.fonte_dados !== "pluggy");

  // janela de sobreposição (interseção dos intervalos de data real das fontes)
  const msOf = of.map(realMs).filter((x): x is number => x != null);
  const msPdf = pdf.map(realMs).filter((x): x is number => x != null);
  let janela: { ini: number; fim: number } | null = null;
  if (msOf.length && msPdf.length) {
    const ini = Math.max(Math.min(...msOf), Math.min(...msPdf));
    const fim = Math.min(Math.max(...msOf), Math.max(...msPdf));
    if (ini <= fim) janela = { ini, fim };
  }

  // indexa PDFs por valor (centavos) para achar candidatos rápido
  const idx = new Map<number, { row: Lancamento; ms: number | null; usado: boolean }[]>();
  for (const d of pdf) {
    const k = cent(d.valor);
    (idx.get(k) ?? idx.set(k, []).get(k)!).push({ row: d, ms: realMs(d), usado: false });
  }

  const pares: Par[] = [];
  const soOF: Lancamento[] = [];

  // OF ordenado por data → casamento determinístico
  const ofOrd = [...of].sort((a, b) => (realMs(a) ?? 0) - (realMs(b) ?? 0));
  for (const p of ofOrd) {
    const pm = realMs(p);
    const cands = idx.get(cent(p.valor)) ?? [];
    let melhor: { c: (typeof cands)[number]; dias: number; banco: boolean; desc: boolean; score: number } | null = null;

    for (const c of cands) {
      if (c.usado || pm == null || c.ms == null) continue;
      const dias = Math.abs(pm - c.ms) / DIA;
      if (dias > tolDias) continue;
      if (ehCartao(p.origem) !== ehCartao(c.row.origem)) continue; // cartão só casa com cartão

      const banco = bankOf(p.banco) === bankOf(c.row.banco) && bankOf(p.banco) !== "outro";
      const np = normEstab(p.descricao);
      const desc = np.length > 2 && np === normEstab(c.row.descricao);
      const score = (tolDias - dias) + (banco ? 5 : 0) + (desc ? 5 : 0);
      if (!melhor || score > melhor.score) melhor = { c, dias, banco, desc, score };
    }

    if (melhor) {
      melhor.c.usado = true;
      const conf: Conf =
        melhor.banco && melhor.desc ? "alta" : melhor.banco || melhor.desc ? "media" : "baixa";
      pares.push({
        of: p,
        pdf: melhor.c.row,
        dias: Math.round(melhor.dias),
        conf,
        mesmoBanco: melhor.banco,
        descParecida: melhor.desc,
      });
    } else {
      soOF.push(p);
    }
  }

  // só PDF: não-casados, mas dentro da janela de sobreposição
  const soPDF: Lancamento[] = [];
  if (janela) {
    for (const arr of idx.values())
      for (const c of arr)
        if (!c.usado && c.ms != null && c.ms >= janela.ini && c.ms <= janela.fim) soPDF.push(c.row);
  }

  return { pares, soOF, soPDF, janela };
}
