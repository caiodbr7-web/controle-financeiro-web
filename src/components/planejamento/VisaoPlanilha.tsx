import { Fragment, useMemo, useState, type ReactNode } from "react";
import { BRL, corCategoria, dvAddMes, dvLabel } from "../../lib/finance";
import { type Plano, contribNoMes, mesAtual } from "../../lib/projecao";
import {
  type AutosMap, type Ocorrencia, STATUS_INFO, TIPO_LABEL, descreveRegra, ehDespesa, ehRecorrente, ocorrencia, progresso, realizado,
} from "../../lib/agenda";
import { Legenda, Seg } from "../ui";
import { useIsMobile } from "../../lib/theme";
import { fmtN } from "./comum";
import type { PlanejamentoApi } from "./usePlanejamento";

type Escopo = "todas" | "recorrentes" | "nao";
type Periodo = "3" | "6" | "ano" | "12";
type ModoHist = "ambos" | "real" | "dif";

const NAO_REC_GRUPOS: { tipo: Plano["tipo"]; titulo: string }[] = [
  { tipo: "parcelamento", titulo: "Parcelamentos" },
  { tipo: "pagamento", titulo: "Pagamentos únicos" },
  { tipo: "meta", titulo: "Metas / caixinhas" },
];

/** real acima/abaixo do previsto além de 3% (ou R$ 1) */
function desvio(prev: number, real: number | null): "acima" | "abaixo" | null {
  if (real == null || !prev) return null;
  const tol = Math.max(1, prev * 0.03);
  return real > prev + tol ? "acima" : real < prev - tol ? "abaixo" : null;
}

export function VisaoPlanilha({ api, autos, receitaReal, onAbrir, onEditar }: {
  api: PlanejamentoApi; autos: AutosMap; receitaReal: Record<string, number>;
  onAbrir: (o: Ocorrencia) => void; onEditar: (p: Plano) => void;
}) {
  const atual = mesAtual();
  const mobile = useIsMobile();
  const [escopo, setEscopo] = useState<Escopo>("todas");
  // celular: janela curta e só o realizado, para caber sem rolar tanto
  const [periodo, setPeriodo] = useState<Periodo>(() => (mobile ? "3" : "6"));
  const [modo, setModo] = useState<ModoHist>(() => (mobile ? "real" : "ambos"));
  const [fechados, setFechados] = useState<Set<string>>(new Set());
  const { planos, mensal, receitaPlano } = api;

  const meses = useMemo(() => {
    const [a, b] = periodo === "ano" ? [`${atual.slice(0, 4)}-01`, `${atual.slice(0, 4)}-12`]
      : periodo === "12" ? [dvAddMes(atual, -12), dvAddMes(atual, 12)]
      : periodo === "3" ? [dvAddMes(atual, -3), dvAddMes(atual, 3)]
      : [dvAddMes(atual, -6), dvAddMes(atual, 6)];
    const out: string[] = [];
    for (let k = a; k <= b; k = dvAddMes(k, 1)) out.push(k);
    return out;
  }, [periodo, atual]);
  const hist = meses.filter((k) => k <= atual);
  const fut = meses.filter((k) => k > atual);
  const split = modo === "ambos";

  // itens do escopo que lançam algo na janela, com as ocorrências já calculadas
  const linhas = useMemo(() => {
    return planos
      .filter((p) => p.ativo && ehDespesa(p))
      .filter((p) => (escopo === "todas" ? true : escopo === "recorrentes" ? ehRecorrente(p) : !ehRecorrente(p)))
      .map((p) => ({ p, oc: Object.fromEntries(meses.map((k) => [k, ocorrencia(p, k, mensal, autos)])) as Record<string, Ocorrencia | null> }))
      .filter((l) => meses.some((k) => l.oc[k]));
  }, [planos, mensal, autos, meses, escopo]);

  // grupos: por categoria (todas/recorrentes) ou por tipo (não recorrentes)
  const grupos = useMemo(() => {
    if (escopo === "nao") {
      return NAO_REC_GRUPOS.map((g) => ({ id: g.tipo, titulo: g.titulo, cor: null as string | null, itens: linhas.filter((l) => l.p.tipo === g.tipo) }))
        .filter((g) => g.itens.length);
    }
    const by = new Map<string, typeof linhas>();
    for (const l of linhas) {
      const c = l.p.categoria || "Sem categoria";
      if (!by.has(c)) by.set(c, []);
      by.get(c)!.push(l);
    }
    return [...by.entries()]
      .map(([c, itens]) => ({ id: c, titulo: c, cor: corCategoria(c), itens }))
      .sort((a, b) => sumPrev(b.itens) - sumPrev(a.itens));
    function sumPrev(it: typeof linhas) { return it.reduce((s, l) => s + meses.reduce((ss, k) => ss + (l.oc[k]?.previsto || 0), 0), 0); }
  }, [linhas, escopo, meses]);

  // somas por mês de um conjunto de linhas
  const somaPrev = (ls: typeof linhas, k: string) => ls.reduce((s, l) => s + (l.oc[k]?.previsto || 0), 0);
  const somaReal = (ls: typeof linhas, k: string) => {
    let s = 0, algum = false;
    for (const l of ls) { const o = l.oc[k]; const r = o ? realizado(o) : null; if (r != null) { s += r; algum = true; } }
    return algum ? s : null;
  };
  const somaFut = (ls: typeof linhas, k: string) => ls.reduce((s, l) => s + (l.oc[k]?.valor || 0), 0);

  // receita prevista × real
  const receitaPrev = (k: string) => {
    let v = 0;
    for (const p of planos) if (p.ativo && p.tipo === "receita") v += ocorrencia(p, k, mensal, autos)?.[k > atual ? "valor" : "previsto"] || 0;
    if (receitaPlano?.ativo) v += (k > atual ? mensal[k]?.[receitaPlano.id]?.valor_real : null) ?? contribNoMes(receitaPlano, k);
    return v;
  };

  const naoRec = escopo === "nao";
  const nColsHist = hist.length * (split ? 2 : 1);
  const extraCols = naoRec ? 4 : 1; // não recorrentes: quando, total, pago, falta · demais: vencimento

  // ---------- células ----------
  const tdBase = "border-b border-r border-line px-[8px] py-[5px] whitespace-nowrap tabular-nums text-right text-[12.5px]";
  const colAtual = (k: string) => (k === atual ? "bg-accent/5" : "");

  function celulasHist(o: Ocorrencia | null, k: string): ReactNode {
    const prev = o?.previsto || 0;
    const real = o ? realizado(o) : null;
    const dv = desvio(prev, real);
    const corReal = dv === "acima" ? "text-red font-semibold" : dv === "abaixo" ? "text-green" : "";
    const clic = o ? "cursor-pointer hover:outline hover:outline-2 hover:outline-accent/40 hover:-outline-offset-2" : "";
    const nota = o?.nota ? <span title={o.nota} className="absolute top-0 right-0 w-0 h-0 border-t-[7px] border-l-[7px] border-t-red border-l-transparent" /> : null;
    const semReal = o && real == null
      ? (k === atual
        ? <span className={o.status === "atrasado" ? "text-red font-semibold" : "text-muted"}>{o.status === "atrasado" ? "atrasado" : "a pagar"}</span>
        : <span className="text-muted">—</span>)
      : null;
    const tip = o ? `${o.p.nome} · ${dvLabel(k)}\nPrevisto ${BRL(prev)}${real != null ? `\nRealizado ${BRL(real)}` : ""}\n${STATUS_INFO[o.status].label}${o.nota ? `\n📝 ${o.nota}` : ""}` : undefined;
    const onClick = o ? () => onAbrir(o) : undefined;
    if (modo === "ambos") {
      return (
        <>
          <td className={`${tdBase} text-muted ${colAtual(k)} ${clic}`} onClick={onClick} title={tip}>{o && prev ? fmtN(prev) : ""}</td>
          <td className={`${tdBase} relative ${corReal} ${colAtual(k)} ${clic} !border-r-line`} onClick={onClick} title={tip}>
            {o ? (real != null ? <>{dv === "acima" ? "▲ " : dv === "abaixo" ? "▼ " : ""}{fmtN(real)}</> : semReal) : ""}{nota}
          </td>
        </>
      );
    }
    if (modo === "real") {
      return <td className={`${tdBase} relative ${corReal} ${colAtual(k)} ${clic}`} onClick={onClick} title={tip}>{o ? (real != null ? fmtN(real) : semReal) : ""}{nota}</td>;
    }
    const d = real != null ? real - prev : null;
    return (
      <td className={`${tdBase} relative ${colAtual(k)} ${clic} ${d == null ? "" : d > Math.max(1, prev * 0.03) ? "text-red font-semibold" : d < -Math.max(1, prev * 0.03) ? "text-green" : "text-muted"}`} onClick={onClick} title={tip}>
        {o ? (d != null ? (d > 0 ? "+" : "") + fmtN(d) : semReal) : ""}{nota}
      </td>
    );
  }
  function celulaFut(o: Ocorrencia | null, k: string) {
    return (
      <td key={k} onClick={o ? () => onAbrir(o) : undefined}
        title={o ? `${o.p.nome} · ${dvLabel(k)} · ${BRL(o.valor)}${o.ajuste != null ? " (ajustado neste mês)" : ""}${o.nota ? `\n📝 ${o.nota}` : ""}` : undefined}
        className={`${tdBase} relative italic text-muted ${o ? "cursor-pointer hover:outline hover:outline-2 hover:outline-accent/40 hover:-outline-offset-2" : ""} ${o?.ajuste != null ? "!text-accent underline decoration-dotted underline-offset-2 not-italic" : ""}`}>
        {o ? <>{o.p.variavel ? "≈" : ""}{fmtN(o.valor)}</> : ""}
        {o?.nota && <span className="absolute top-0 right-0 w-0 h-0 border-t-[7px] border-l-[7px] border-t-red border-l-transparent" />}
      </td>
    );
  }
  // linha de totais/subtotais
  function linhaTotal(titulo: ReactNode, prev: (k: string) => number, real: (k: string) => number | null, cls = "", fmtSaldo = false, vazioZero = false) {
    const cor = (v: number | null) => (fmtSaldo && v != null ? (v < 0 ? "text-red" : "text-green") : "");
    // linhas de grupo: mês sem nada fica em branco em vez de "0 / —"
    const z = (v: number | null, f: () => string) => (v == null ? "—" : vazioZero && !v ? "" : f());
    const zr = (p: number, r: number | null) => (vazioZero && !p && r == null ? "" : z(r, () => fmtN(r as number)));
    const tp = hist.reduce((s, k) => s + prev(k), 0);
    const trVals = hist.map(real).filter((v): v is number => v != null);
    const tr = trVals.length ? trVals.reduce((a, b) => a + b, 0) : null;
    const tf = fut.reduce((s, k) => s + prev(k), 0);
    return (
      <tr className={cls}>
        <td className="sticky left-0 z-10 bg-inherit border-b border-r border-line px-[10px] py-[6px] font-semibold whitespace-nowrap" colSpan={1 + extraCols}>{titulo}</td>
        {hist.map((k) => {
          const p = prev(k), r = real(k);
          if (modo === "ambos") return (
            <Fragment key={k}>
              <td className={`${tdBase} ${colAtual(k)} ${cor(p)}`}>{z(p, () => fmtN(p))}</td>
              <td className={`${tdBase} ${colAtual(k)} ${cor(r)}`}>{zr(p, r)}</td>
            </Fragment>
          );
          if (modo === "real") return <td key={k} className={`${tdBase} ${colAtual(k)} ${cor(r)}`}>{zr(p, r)}</td>;
          const d = r == null ? null : r - p;
          return <td key={k} className={`${tdBase} ${colAtual(k)} ${d == null ? "" : fmtSaldo ? cor(d) : d > 0 ? "text-red" : d < 0 ? "text-green" : ""}`}>{d == null ? "—" : (d > 0 ? "+" : "") + fmtN(d)}</td>;
        })}
        {fut.map((k) => <td key={k} className={`${tdBase} italic ${cor(prev(k))}`}>{z(prev(k), () => fmtN(prev(k)))}</td>)}
        <td className={`${tdBase} ${cor(tp)}`}>{fmtN(tp)}</td>
        <td className={`${tdBase} ${cor(tr)}`}>{tr == null ? "—" : fmtN(tr)}</td>
        <td className={`${tdBase} italic ${cor(tf)}`}>{fmtN(tf)}</td>
      </tr>
    );
  }

  function exportar() {
    const head = ["Despesa", "Para quem", "Categoria", "Tipo",
      ...hist.flatMap((k) => [`${dvLabel(k)} previsto`, `${dvLabel(k)} realizado`]), ...fut.map((k) => `${dvLabel(k)} projetado`)];
    const n = (v: number | null | undefined) => (v == null ? "" : v.toFixed(2).replace(".", ","));
    const rows = linhas.map((l) => [l.p.nome, l.p.favorecido || "", l.p.categoria || "", TIPO_LABEL[l.p.tipo],
      ...hist.flatMap((k) => { const o = l.oc[k]; return [n(o?.previsto), n(o ? realizado(o) : null)]; }),
      ...fut.map((k) => n(l.oc[k]?.valor))]);
    const csv = "﻿" + [head, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `planejamento-${escopo}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const todas = linhas;
  const thBase = "border-b border-r border-line px-[8px] py-[6px] text-[10.5px] font-bold uppercase tracking-[0.05em] text-muted whitespace-nowrap bg-card2";

  return (
    <div>
      <div className="flex flex-wrap gap-x-3 gap-y-2 items-center mb-3">
        <Seg<Escopo> value={escopo} onChange={setEscopo} options={[{ v: "todas", label: "Todas" }, { v: "recorrentes", label: "Recorrentes" }, { v: "nao", label: "Não recorrentes" }]} />
        <Seg<Periodo> size="sm" value={periodo} onChange={setPeriodo} options={[{ v: "3", label: "±3m" }, { v: "6", label: "±6m" }, { v: "ano", label: `Ano ${atual.slice(0, 4)}` }, { v: "12", label: "±12m" }]} />
        <span className="inline-flex items-center gap-2 text-[12px] text-muted">Histórico
          <Seg<ModoHist> size="sm" value={modo} onChange={setModo} options={[{ v: "ambos", label: "Previsto × Real" }, { v: "real", label: "Só real" }, { v: "dif", label: "Diferença" }]} />
        </span>
        <button onClick={exportar} className="btn-ghost !py-[6px] ml-auto hidden md:inline-flex">⬇ CSV</button>
      </div>

      {naoRec && (
        <div className="text-muted text-[12.5px] mb-3">
          Só o que não se repete todo mês: parcelamentos, pagamentos únicos e metas. As colunas da esquerda mostram o compromisso inteiro (total, quanto já foi pago e quanto falta).
        </div>
      )}

      <div className="bg-card border border-line rounded-[16px] shadow-card overflow-auto scroll-thin max-h-[72vh]">
        <table className="border-separate border-spacing-0 w-max min-w-full text-[13px]">
          <thead className="sticky top-0 z-20">
            <tr>
              <th className={`${thBase} sticky left-0 z-30 text-left`} rowSpan={split ? 3 : 2}>Despesa</th>
              {naoRec ? (
                <>
                  <th className={thBase} rowSpan={split ? 3 : 2}>Quando</th>
                  <th className={`${thBase} text-right`} rowSpan={split ? 3 : 2}>Total</th>
                  <th className={`${thBase} text-right`} rowSpan={split ? 3 : 2}>Pago</th>
                  <th className={`${thBase} text-right`} rowSpan={split ? 3 : 2}>Falta</th>
                </>
              ) : <th className={thBase} rowSpan={split ? 3 : 2}>Venc.</th>}
              {hist.length > 0 && <th className={`${thBase} !text-txt bg-fill`} colSpan={nColsHist}>Histórico · {modo === "ambos" ? "previsto × realizado" : modo === "real" ? "realizado" : "realizado − previsto"}</th>}
              {fut.length > 0 && <th className={`${thBase}`} colSpan={fut.length} style={{ backgroundImage: "repeating-linear-gradient(135deg, transparent 0 6px, rgb(var(--c-line)) 6px 7px)" }}>Projeção</th>}
              <th className={thBase} colSpan={3}>Total do período</th>
            </tr>
            <tr>
              {hist.map((k) => <th key={k} colSpan={split ? 2 : 1} className={`${thBase} ${k === atual ? "!bg-accent !text-onaccent" : ""}`}>{dvLabel(k)}{k === atual ? " · atual" : ""}</th>)}
              {fut.map((k) => <th key={k} rowSpan={split ? 2 : 1} className={`${thBase} !font-semibold`}>{dvLabel(k)}</th>)}
              <th className={`${thBase} text-right`} rowSpan={split ? 2 : 1}>Prev. hist.</th>
              <th className={`${thBase} text-right`} rowSpan={split ? 2 : 1}>Real hist.</th>
              <th className={`${thBase} text-right`} rowSpan={split ? 2 : 1}>Projetado</th>
            </tr>
            {split && (
              <tr>
                {hist.map((k) => (
                  <Fragment key={k}>
                    <th className={`${thBase} !normal-case !font-medium text-right ${k === atual ? "!bg-accent/10" : ""}`}>prev.</th>
                    <th className={`${thBase} !normal-case !font-semibold !text-txt text-right ${k === atual ? "!bg-accent/10" : ""}`}>real</th>
                  </Fragment>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {grupos.map((g) => {
              const fechado = fechados.has(g.id);
              return (
                <Fragment key={g.id}>
                  {linhaTotal(
                    <button onClick={() => setFechados((s) => { const n = new Set(s); n.has(g.id) ? n.delete(g.id) : n.add(g.id); return n; })}
                      className="bg-transparent border-0 p-0 cursor-pointer inline-flex items-center gap-2 font-bold text-txt">
                      <span className="text-muted text-[10px] w-[10px]">{fechado ? "▶" : "▼"}</span>
                      {g.cor && <span className="w-[8px] h-[8px] rounded-full" style={{ background: g.cor }} />}
                      {g.titulo}<span className="text-muted font-normal text-[11.5px]">· {g.itens.length}</span>
                    </button>,
                    (k) => (k > atual ? somaFut(g.itens, k) : somaPrev(g.itens, k)),
                    (k) => somaReal(g.itens, k),
                    "bg-card2", false, true,
                  )}
                  {!fechado && g.itens.map((l) => {
                    const p = l.p;
                    const tp = hist.reduce((s, k) => s + (l.oc[k]?.previsto || 0), 0);
                    const trs = hist.map((k) => (l.oc[k] ? realizado(l.oc[k]!) : null)).filter((v): v is number => v != null);
                    const tf = fut.reduce((s, k) => s + (l.oc[k]?.valor || 0), 0);
                    const prog = naoRec ? progresso(p, mensal, autos) : null;
                    return (
                      <tr key={p.id} className="bg-card hover:bg-card2/70">
                        <td className="sticky left-0 z-10 bg-inherit border-b border-r border-line px-[8px] md:px-[10px] py-[5px] min-w-[130px] max-w-[150px] md:min-w-[180px] md:max-w-[260px]">
                          <button onClick={() => onEditar(p)} className="bg-transparent border-0 p-0 cursor-pointer text-left w-full group" title={p.observacoes || "Editar despesa"}>
                            <div className="truncate font-medium group-hover:text-accent pl-[10px] md:pl-[18px]">
                              {p.nome}{p.observacoes && <span className="ml-1 text-[11px]" aria-label="tem observação">📝</span>}
                            </div>
                            {p.favorecido && <div className="truncate text-muted text-[11px] pl-[10px] md:pl-[18px]">{p.favorecido}</div>}
                          </button>
                        </td>
                        {naoRec && prog ? (
                          <>
                            <td className={`${tdBase} !text-left text-muted text-[11.5px]`}>{descreveRegra(p, (v) => BRL(v).replace(",00", ""))}</td>
                            <td className={tdBase}>{fmtN(prog.total)}</td>
                            <td className={`${tdBase} text-green`}>{fmtN(prog.pagoValor)}<div className="text-[10.5px] text-muted">{prog.pagas}/{prog.n}</div></td>
                            <td className={`${tdBase} font-semibold`}>{prog.restante ? fmtN(prog.restante) : "✓"}</td>
                          </>
                        ) : (
                          <td className={`${tdBase} !text-center text-muted text-[11.5px]`}>{p.dia_venc ? `dia ${p.dia_venc}` : "—"}</td>
                        )}
                        {hist.map((k) => <Fragment key={k}>{celulasHist(l.oc[k], k)}</Fragment>)}
                        {fut.map((k) => celulaFut(l.oc[k], k))}
                        <td className={`${tdBase} text-muted`}>{tp ? fmtN(tp) : ""}</td>
                        <td className={tdBase}>{trs.length ? fmtN(trs.reduce((a, b) => a + b, 0)) : ""}</td>
                        <td className={`${tdBase} italic text-muted`}>{tf ? fmtN(tf) : ""}</td>
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
            {!grupos.length && (
              <tr><td colSpan={2 + extraCols + nColsHist + fut.length + 2} className="p-6 text-muted text-center">
                {api.loading ? "Carregando…" : naoRec ? "Nenhuma despesa não recorrente no período." : "Nenhuma despesa no período. Use “+ Nova despesa”."}
              </td></tr>
            )}
          </tbody>
          {grupos.length > 0 && (
            <tfoot className="sticky bottom-0 z-20">
              {linhaTotal(naoRec ? "Σ Não recorrentes" : "Σ Despesas programadas", (k) => (k > atual ? somaFut(todas, k) : somaPrev(todas, k)), (k) => somaReal(todas, k), "bg-fill font-bold [&>td]:border-t-2 [&>td]:border-t-txt/40")}
              {!naoRec && linhaTotal(<span className="text-green">💰 Receita</span>, receitaPrev, (k) => receitaReal[k] ?? null, "bg-card")}
              {!naoRec && linhaTotal("Sobra", (k) => receitaPrev(k) - (k > atual ? somaFut(todas, k) : somaPrev(todas, k)),
                (k) => { const r = receitaReal[k]; const d = somaReal(todas, k); return r == null ? null : r - (d ?? 0); }, "bg-card font-bold", true)}
            </tfoot>
          )}
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-[11.5px] text-muted">
        <span><span className="text-red font-semibold">▲ 123</span> real acima do previsto</span>
        <span><span className="text-green">▼ 123</span> abaixo</span>
        <span>— sem registro de pagamento</span>
        <span><i>123</i> projetado</span>
        <span><span className="text-accent underline decoration-dotted">123</span> ajustado só naquele mês</span>
        <span><span className="inline-block w-0 h-0 border-t-[7px] border-l-[7px] border-t-red border-l-transparent align-middle" /> nota do mês</span>
        <Legenda>
          <b>Previsto</b> é o que a regra de cada despesa manda (valor por mês, parcela, pagamento único). <b>Real</b> é o que foi pago: o valor que você digitou no pagamento, senão o total dos <b>lançamentos vinculados</b> (baixa automática), senão o previsto quando o mês foi só marcado como pago. Sem nada disso, aparece <b>—</b>.
          <br /><br />
          Clique numa célula para abrir o pagamento daquele mês (valor, pago, nota). Nos meses futuros, digitar um valor <b>ajusta o previsto só daquele mês</b>. Clique no nome para editar a despesa.
          <br /><br />
          A planilha mostra as <b>despesas programadas</b>. O orçamento variável do cartão e da conta continua na aba <b>Orçamento</b>. A linha <b>Receita</b> usa a receita prevista (itens de receita e a receita prevista do Orçamento) e, no histórico, o que de fato entrou pelos lançamentos.
        </Legenda>
      </div>
    </div>
  );
}
