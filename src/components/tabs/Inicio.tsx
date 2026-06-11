import { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, Tooltip } from "recharts";
import type { Aba, Lancamento } from "../../types";
import { Panel, BarRow } from "../ui";
import { useChart, ChartTip } from "../../lib/theme";
import { sb } from "../../lib/supabase";
import {
  BRL, catKey, corCategoria, ehGasto, ehReceita, dvGasto, dvDataReal, dvSeries,
  dvAddMes, dvDiasNoMes, dvLabel, dvParcialLimite, MES_ABREV, mesCurto, normEstab,
} from "../../lib/finance";

interface Props {
  dados: Lancamento[];
  allDados: Lancamento[];
  months: string[];
  openModal: (t: string, r: Lancamento[]) => void;
  go: (a: Aba) => void;
}

function Stat({ label, value, sub, color = "" }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="py-[10px] first:pt-0 last:pb-0">
      <div className="text-muted text-[11.5px] font-medium">{label}</div>
      <div className={`text-[17px] font-semibold tracking-tight tabular-nums mt-[2px] ${color}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted mt-[1px]">{sub}</div>}
    </div>
  );
}

function ActionRow({ label, detail, onClick, tone = "amber" }: { label: string; detail?: string; onClick: () => void; tone?: "amber" | "red" }) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 px-0 py-[11px] bg-transparent border-0 cursor-pointer text-left group">
      <span className={`w-[7px] h-[7px] rounded-full shrink-0 ${tone === "red" ? "bg-red" : "bg-amber"}`} />
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-medium group-hover:text-accent transition-colors">{label}</span>
        {detail && <span className="block text-[11.5px] text-muted mt-[1px]">{detail}</span>}
      </span>
      <span className="text-muted text-[16px] leading-none shrink-0" aria-hidden>›</span>
    </button>
  );
}

export function Inicio({ dados, allDados, months, openModal, go }: Props) {
  const cc = useChart();
  const hoje = new Date();
  const mesAtual = hoje.getFullYear() + "-" + String(hoje.getMonth() + 1).padStart(2, "0");

  /* ---------- gasto do mês de referência: sempre o mês ANTERIOR ao atual ---------- */
  const calc = useMemo(() => {
    const { map } = dvSeries(dados, months, "ambos");
    const lim = dvParcialLimite(allDados);

    const cum = (k: string) => {
      const nd = dvDiasNoMes(k); const out: number[] = []; let s = 0;
      for (let j = 0; j < nd; j++) { s += map[k]?.[j] || 0; out.push(Math.round(s * 100) / 100); }
      return out;
    };

    // mês de referência: o anterior ao mês civil atual; se sem dados, o último com dados antes do atual
    let refKey = dvAddMes(mesAtual, -1);
    if (!map[refKey]) {
      const cand = Object.keys(map).filter((k) => k < mesAtual).sort();
      if (!cand.length) return null;
      refKey = cand[cand.length - 1];
    }
    const completo = refKey < lim;

    // benchmark: média acumulada dos 3 meses completos ANTERIORES ao mês de referência
    const base3 = Object.keys(map).filter((k) => k < refKey && k < lim).sort().slice(-3);
    const bench: (number | null)[] = [];
    for (let j = 0; j < 31; j++) {
      let s = 0, c = 0;
      base3.forEach((k) => { const a = cum(k); const v = j < a.length ? a[j] : a[a.length - 1]; if (v != null) { s += v; c++; } });
      bench.push(c ? Math.round((s / c) * 100) / 100 : null);
    }
    let benchFim = 0;
    for (let j = 30; j >= 0; j--) if (bench[j] != null) { benchFim = bench[j] as number; break; }

    const refArr = cum(refKey);
    const nd = dvDiasNoMes(refKey);
    const refTot = refArr[nd - 1] || 0;
    const delta = base3.length ? refTot - benchFim : null;

    // mês com dados imediatamente anterior ao de referência
    const antCand = Object.keys(map).filter((k) => k < refKey).sort();
    const antKey = antCand.length ? antCand[antCand.length - 1] : null;
    const antTot = antKey ? (cum(antKey).slice(-1)[0] || 0) : null;

    const serieNome = dvLabel(refKey);
    const chart = Array.from({ length: nd }, (_, i) => ({
      dia: i + 1,
      [serieNome]: refArr[i],
      "Média 3 meses": bench[i],
    }));

    return {
      refKey, completo, refTot, delta, benchFim, antKey, antTot, chart, nd, serieNome,
      mediaDia: nd ? refTot / nd : 0,
      temBench: base3.length > 0,
    };
  }, [dados, allDados, months, mesAtual]);

  /* ---------- top categorias do mês de referência ---------- */
  const topCats = useMemo(() => {
    if (!calc) return { rows: [] as { cat: string; val: number; itens: Lancamento[] }[], total: 0 };
    const tot: Record<string, number> = {};
    const itens: Record<string, Lancamento[]> = {};
    dados.forEach((d) => {
      const g = dvGasto(d); if (!g) return;
      const r = dvDataReal(d); if (!r || r.k !== calc.refKey) return;
      const k = catKey(d);
      tot[k] = (tot[k] || 0) + g;
      (itens[k] = itens[k] || []).push(d);
    });
    const rows = Object.keys(tot)
      .map((cat) => ({ cat, val: tot[cat], itens: itens[cat] }))
      .filter((x) => x.val > 0)
      .sort((a, b) => b.val - a.val);
    return { rows: rows.slice(0, 6), total: rows.reduce((s, x) => s + x.val, 0) };
  }, [dados, calc]);

  /* ---------- últimos lançamentos conhecidos ---------- */
  const ultimos = useMemo(() => {
    const arr: { d: Lancamento; k: string; dia: number }[] = [];
    dados.forEach((d) => {
      if (!ehGasto(d.classe) && !ehReceita(d.classe)) return;
      const r = dvDataReal(d); if (!r) return;
      arr.push({ d, k: r.k, dia: r.d });
    });
    arr.sort((a, b) => (b.k.localeCompare(a.k)) || (b.dia - a.dia) || (b.d.id - a.d.id));
    return arr.slice(0, 7).map((x) => x.d);
  }, [dados]);

  /* ---------- pendências ---------- */
  const pend = useMemo(() => {
    const grupos = new Set<string>(); let classTotal = 0, classN = 0;
    allDados.forEach((d) => {
      if (ehGasto(d.classe) && !d.categoria_manual) { grupos.add(normEstab(d.descricao)); classTotal += Math.abs(d.valor); classN++; }
    });
    const comps = [...new Set(allDados.map((d) => d.competencia))].sort();
    const ult = comps[comps.length - 1];
    const bancos = ["Nubank", "PicPay", "Itau"].filter((b) => allDados.some((d) => d.banco === b));
    let arqFaltam = 0;
    if (ult) bancos.forEach((b) => {
      if (!allDados.some((d) => d.competencia === ult && d.banco === b && String(d.origem || "").startsWith("Cartao"))) arqFaltam++;
      if (!allDados.some((d) => d.competencia === ult && d.banco === b && String(d.origem || "").startsWith("Conta"))) arqFaltam++;
    });
    return { classGrupos: grupos.size, classTotal, classN, arqFaltam, arqMes: ult ? mesCurto(ult) : "" };
  }, [allDados]);

  const [orc, setOrc] = useState<{ pend: number; total: number } | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const { data: itens, error } = await sb.from("orcamento_itens").select("id").eq("ativo", true);
        if (error || !itens || !itens.length) { setOrc(null); return; }
        const { data: mensal } = await sb.from("orcamento_mensal").select("item_id,valor_real").eq("competencia", mesAtual);
        const ok = new Set((mensal || []).filter((x: any) => x.valor_real != null).map((x: any) => x.item_id));
        setOrc({ pend: (itens as any[]).filter((i) => !ok.has(i.id)).length, total: itens.length });
      } catch { setOrc(null); }
    })();
  }, [mesAtual]);

  if (!calc) return <div className="text-muted p-4">Sem dados ainda — importe os primeiros PDFs para começar.</div>;

  const temPend = pend.classGrupos > 0 || (orc?.pend || 0) > 0 || pend.arqFaltam > 0;
  const roxo = cc.roxoLinha("1");

  return (
    <div>
      {/* ---------- hero + pendências ---------- */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-[18px]">
        <Panel className="lg:col-span-2 !mb-0">
          <div className="grid grid-cols-1 md:grid-cols-[1.7fr_1fr] gap-5">
            <div className="min-w-0">
              <div className="text-muted text-[12.5px] font-medium">
                Gasto em {dvLabel(calc.refKey)} · {calc.completo ? "mês fechado" : "parcial · faturas por vir"}
              </div>
              <div className="text-[34px] sm:text-[42px] font-semibold tracking-tight tabular-nums leading-tight mt-1">
                {BRL(calc.refTot)}
              </div>
              {calc.delta != null && (
                <div className="mt-[6px]">
                  <span className={`inline-flex items-center gap-1 rounded-full px-[10px] py-[3px] text-[12px] font-semibold ${
                    calc.delta <= 0 ? "bg-green/10 text-green" : "bg-red/10 text-red"
                  }`}>
                    {calc.delta <= 0 ? "▼" : "▲"} {BRL(Math.abs(calc.delta))} vs média 3m
                  </span>
                </div>
              )}
              <div className="h-[150px] sm:h-[170px] mt-4 -ml-1 min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={calc.chart} margin={{ top: 6, right: 4, left: 4, bottom: 0 }}>
                    <defs>
                      <linearGradient id="heroGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={roxo} stopOpacity={0.28} />
                        <stop offset="100%" stopColor={roxo} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="dia" hide />
                    <YAxis hide domain={[0, "auto"]} />
                    <Tooltip content={<ChartTip labelPrefix="Dia " />} />
                    <Line type="monotone" dataKey="Média 3 meses" stroke={cc.media} strokeWidth={2} strokeDasharray="4 4" dot={false} connectNulls isAnimationActive={false} />
                    <Area type="monotone" dataKey={calc.serieNome} stroke={roxo} strokeWidth={2.5} fill="url(#heroGrad)" dot={false} connectNulls={false} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="text-[11.5px] text-muted mt-2">
                Pela data real da compra, cartão + contas.{!calc.completo ? " Parte das compras deste mês ainda pode chegar na próxima fatura." : ""}
              </div>
            </div>

            <div className="md:border-l md:border-line md:pl-5 divide-y divide-line self-center w-full">
              <Stat label="Patamar (média 3 meses)" value={BRL(calc.benchFim)} sub="3 meses completos anteriores" />
              <Stat label="Média por dia" value={BRL(calc.mediaDia)} sub={`${calc.nd} dias`} />
              {calc.antTot != null && calc.antKey && (
                <Stat label={`Mês anterior · ${dvLabel(calc.antKey)}`} value={BRL(calc.antTot)} />
              )}
            </div>
          </div>
        </Panel>

        <Panel title="Pendências" className="!mb-0">
          {temPend ? (
            <div className="divide-y divide-line">
              {pend.classGrupos > 0 && (
                <ActionRow
                  label={`Classificar ${pend.classGrupos} ${pend.classGrupos === 1 ? "estabelecimento" : "estabelecimentos"}`}
                  detail={`${pend.classN} lançamentos · ${BRL(pend.classTotal)}`}
                  onClick={() => go("classificar")}
                />
              )}
              {(orc?.pend || 0) > 0 && (
                <ActionRow
                  label={`Orçamento: ${orc!.pend} ${orc!.pend === 1 ? "conta sem valor" : "contas sem valor"} em ${MES_ABREV[hoje.getMonth()]}`}
                  detail={`${orc!.total - orc!.pend} de ${orc!.total} preenchidas`}
                  onClick={() => go("orcamento")}
                />
              )}
              {pend.arqFaltam > 0 && (
                <ActionRow
                  label={`${pend.arqFaltam} ${pend.arqFaltam === 1 ? "documento pendente" : "documentos pendentes"} · ${pend.arqMes}`}
                  detail="faturas/extratos ainda não importados"
                  onClick={() => go("lanc")}
                />
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-green text-[13.5px] py-2">
              <span className="w-[20px] h-[20px] rounded-full bg-green/10 flex items-center justify-center text-[11px]">✓</span>
              Tudo em dia — nada pendente.
            </div>
          )}
        </Panel>
      </div>

      {/* ---------- top categorias + últimos lançamentos ---------- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[18px] mt-[18px]">
        <Panel
          title="Onde foi o dinheiro"
          sub={`(${dvLabel(calc.refKey)} · clique p/ detalhar)`}
          right={
            <button onClick={() => go("mensal")} className="bg-transparent border-0 text-accent text-[12.5px] font-medium cursor-pointer p-0 hover:underline">
              Resumo completo ›
            </button>
          }
        >
          {topCats.rows.length ? (
            <div className="space-y-[14px] mt-2">
              {topCats.rows.map((c) => (
                <BarRow
                  key={c.cat}
                  label={c.cat}
                  value={c.val}
                  max={topCats.rows[0].val}
                  color={corCategoria(c.cat)}
                  right={`${BRL(c.val)} · ${topCats.total ? Math.round((c.val / topCats.total) * 100) : 0}%`}
                  onClick={() => openModal(`${c.cat} · ${dvLabel(calc.refKey)}`, c.itens)}
                />
              ))}
            </div>
          ) : (
            <div className="text-muted text-[13px] py-2">Sem gastos registrados neste mês.</div>
          )}
        </Panel>

        <Panel
          title="Últimos lançamentos"
          sub="(pela data da compra)"
          right={
            <button onClick={() => go("lanc")} className="bg-transparent border-0 text-accent text-[12.5px] font-medium cursor-pointer p-0 hover:underline">
              Ver todos ›
            </button>
          }
        >
          <div className="divide-y divide-line">
            {ultimos.map((d) => (
              <div key={d.id} className="flex items-center gap-3 py-[9px] min-w-0">
                <span className="w-[8px] h-[8px] rounded-full shrink-0" style={{ background: corCategoria(catKey(d)) }} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium truncate">{d.descricao}</div>
                  <div className="text-[11.5px] text-muted truncate">{d.data_mov} · {catKey(d)} · {d.origem}</div>
                </div>
                <div className={`tabular-nums text-[13px] font-medium shrink-0 ${ehReceita(d.classe) || d.valor > 0 ? "text-green" : ""}`}>
                  {BRL(d.valor)}
                </div>
              </div>
            ))}
            {!ultimos.length && <div className="text-muted text-[13px] py-2">Nada por aqui ainda.</div>}
          </div>
        </Panel>
      </div>
    </div>
  );
}
