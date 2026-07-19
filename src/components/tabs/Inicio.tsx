import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, Tooltip } from "recharts";
import type { Aba, Lancamento } from "../../types";
import { Panel, BarRow, Select, Seg } from "../ui";
import { useChart, ChartTip } from "../../lib/theme";
import { sb } from "../../lib/supabase";
import {
  BRL0, catKey, corCategoria, ehGasto, ehReceita, dvGasto, dvDataReal, dataCompleta,
  dvDiasNoMes, dvLabel, mesComp, diaDoMov, ehParcelaAnterior,
  normEstab, valorAporte, valorReceitaInvest, precisaClassificar,
} from "../../lib/finance";
import { ehInterna } from "../../lib/lancClasses";
import { type Plano, projetar } from "../../lib/projecao";

interface Props {
  dados: Lancamento[];
  allDados: Lancamento[];
  months: string[];
  openModal: (t: string, r: Lancamento[]) => void;
  go: (a: Aba) => void;
}

// valor grande da coluna da direita
function BigVal({
  label, value, sub, extra, accent = "", dot, onClick,
}: { label: string; value: string; sub?: string; extra?: ReactNode; accent?: string; dot?: string; onClick?: () => void }) {
  const Tag: any = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={`w-full text-left block py-[14px] first:pt-0 last:pb-0 bg-transparent border-0 ${onClick ? "cursor-pointer group" : ""}`}
    >
      <div className="flex items-center gap-[6px] text-muted text-[12px] font-medium">
        {dot && <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: dot }} />}
        <span className={onClick ? "group-hover:text-accent transition-colors" : ""}>{label}</span>
        {onClick && <span className="text-muted text-[14px] leading-none ml-auto" aria-hidden>›</span>}
      </div>
      <div className={`text-[25px] sm:text-[29px] font-semibold tracking-tight tabular-nums mt-[3px] leading-none ${accent}`}>{value}</div>
      {sub && <div className="text-[11.5px] text-muted mt-[3px]">{sub}</div>}
      {extra}
    </Tag>
  );
}

const JANELAS = [{ v: "3", label: "3m" }, { v: "6", label: "6m" }, { v: "12", label: "12m" }];

export function Inicio({ dados, allDados, months, openModal, go }: Props) {
  const cc = useChart();
  const hoje = new Date();
  const mesAtual = hoje.getFullYear() + "-" + String(hoje.getMonth() + 1).padStart(2, "0");

  // mês escolhido como "atual" e janela da média (em meses)
  const [selKey, setSelKey] = useState("");
  const [janela, setJanela] = useState(3);

  // Série diária por COMPETÊNCIA (mês da fatura/extrato), não pela data da compra.
  // Assim cada parcela conta no mês em que cai na fatura (sofá 12x = 1 parcela/mês),
  // e o total do mês bate com a fatura + extrato — cartão e conta juntos.
  // Duas partes por mês: `novo` = compras do próprio mês, dia a dia pela data da
  // compra (sem data válida, dia 1); `parc` = parcelas/compras de MESES ANTERIORES,
  // que já estavam comprometidas quando o mês abriu e contam desde o dia 1 — é o
  // "platô" da curva. O total do mês = novo acumulado + parc (empilhados no gráfico).
  const compSeries = useMemo(() => {
    const compras: Record<string, number[]> = {}; // compras do próprio mês (g > 0)
    const cred: Record<string, number[]> = {};    // estornos/créditos do mês (magnitude, g < 0)
    const parc: Record<string, number> = {};
    const parcRows: Record<string, Lancamento[]> = {};
    // lançamentos do próprio mês por dia (p/ o detalhamento ao clicar num dia);
    // parcelas de meses anteriores ficam de fora — têm o próprio botão de detalhe.
    const diaRows: Record<string, Lancamento[][]> = {};
    for (const d of dados) {
      const g = dvGasto(d); // já exclui interna/aporte e desconta estorno (lancClasses)
      if (!g) continue;
      const k = mesComp(d);
      if (!/^\d{4}-\d{2}$/.test(k)) continue;
      if (ehParcelaAnterior(d)) {
        parc[k] = (parc[k] || 0) + g;
        (parcRows[k] = parcRows[k] || []).push(d);
      } else {
        const dia = Math.min(diaDoMov(d), dvDiasNoMes(k));
        // separa compra de estorno: a curva roxa empilha SÓ as compras (nunca
        // desce abaixo do platô); estornos entram como termo próprio no total.
        const alvo = g > 0 ? compras : cred;
        (alvo[k] = alvo[k] || new Array(31).fill(0))[dia - 1] += Math.abs(g);
        (diaRows[k] = diaRows[k] || Array.from({ length: 31 }, () => []))[dia - 1].push(d);
      }
    }
    return { compras, cred, parc, parcRows, diaRows };
  }, [dados]);

  // meses disponíveis para escolher (por competência) + o mês civil atual
  const mesesOpc = useMemo(() => {
    const ks = new Set([...Object.keys(compSeries.compras), ...Object.keys(compSeries.cred), ...Object.keys(compSeries.parc)]);
    ks.add(mesAtual);
    return [...ks].filter((k) => k <= mesAtual).sort().reverse();
  }, [compSeries, mesAtual]);

  // default / correção do mês selecionado: o mais recente disponível (= mês atual)
  useEffect(() => {
    if (selKey && mesesOpc.includes(selKey)) return;
    setSelKey(mesesOpc[0] || mesAtual);
  }, [mesesOpc, selKey, mesAtual]);

  /* ---------- gasto do mês selecionado vs média da janela ---------- */
  const calc = useMemo(() => {
    if (!selKey) return null;
    const { compras, cred, parc } = compSeries;
    const r2 = (v: number) => Math.round(v * 100) / 100;

    const cumDe = (m: Record<string, number[]>, k: string) => {
      const nd = dvDiasNoMes(k); const out: number[] = []; let s = 0;
      for (let j = 0; j < nd; j++) { s += m[k]?.[j] || 0; out.push(r2(s)); }
      return out;
    };
    // acumulado TOTAL do mês: platô (desde o dia 1) + compras − estornos
    const cum = (k: string) => {
      const p = parc[k] || 0;
      const cr = cumDe(cred, k);
      return cumDe(compras, k).map((v, j) => r2(v - cr[j] + p));
    };

    const nd = dvDiasNoMes(selKey);
    const isAtual = selKey === mesAtual;
    const completo = selKey < mesAtual; // fatura/extrato do mês já fechou
    const refDay = isAtual ? Math.min(hoje.getDate(), nd) : nd; // "este momento do mês"
    // comparação justa com a média: mês fechado, ou mês corrente comparado no mesmo dia.
    const comparavel = completo || isAtual;

    // benchmark: média acumulada dos N meses fechados ANTERIORES ao selecionado
    const keysAll = new Set([...Object.keys(compras), ...Object.keys(cred), ...Object.keys(parc)]);
    const base = [...keysAll].filter((k) => k < selKey).sort().slice(-janela);
    const bench: (number | null)[] = [];
    for (let j = 0; j < 31; j++) {
      let s = 0, c = 0;
      base.forEach((k) => { const a = cum(k); const v = j < a.length ? a[j] : a[a.length - 1]; if (v != null) { s += v; c++; } });
      bench.push(c ? r2(s / c) : null);
    }
    let benchFim = 0;
    for (let j = nd - 1; j >= 0; j--) if (bench[j] != null) { benchFim = bench[j] as number; break; }
    const benchAtRef = bench[refDay - 1]; // esperado no mesmo ponto do mês

    // platô: parcelas/compras de meses anteriores já comprometidas no dia 1.
    // Banda constante no mês inteiro — mesmo além de hoje, o piso já é conhecido.
    const parcSel = r2(parc[selKey] || 0);
    const comprasArr = cumDe(compras, selKey);
    const credArr = cumDe(cred, selKey);
    const selArr = cum(selKey);
    const gastoAtual = selArr[refDay - 1] || 0;
    const comprasAtual = r2(comprasArr[refDay - 1] || 0); // compras do próprio mês
    const credAtual = r2(credArr[refDay - 1] || 0);       // estornos/créditos do mês
    const delta = benchAtRef != null ? gastoAtual - benchAtRef : null;

    const serieNome = dvLabel(selKey);
    const benchNome = `Média ${janela}m`;
    const parcNome = "Parcelas de meses anteriores";
    // com platô, as áreas EMPILHAM: a curva roxa (só compras, nunca negativa)
    // nasce no topo do platô e só sobe. Estornos entram como termo próprio: o
    // total líquido (platô + compras − estornos) vira a linha "Total gasto" —
    // visível quando há estorno no mês (pode ficar abaixo do platô), invisível
    // (só tooltip) quando não há, já que coincidiria com o topo da pilha.
    const empilhado = parcSel > 0;
    const temCred = credArr[refDay - 1] > 0; // estornos já ocorridos até o ponto de referência
    const chart = Array.from({ length: nd }, (_, i) => ({
      dia: i + 1,
      [serieNome]: isAtual && i + 1 > refDay ? null : (empilhado ? comprasArr[i] : selArr[i]),
      [benchNome]: bench[i],
      ...(empilhado ? { [parcNome]: parcSel, "Total gasto": isAtual && i + 1 > refDay ? null : selArr[i] } : {}),
      ...(empilhado && temCred ? { "Estornos do mês": isAtual && i + 1 > refDay ? null : -credArr[i] } : {}),
    }));

    return {
      selKey, isAtual, completo, comparavel, nd, refDay, gastoAtual, comprasAtual, credAtual, benchAtRef: benchAtRef ?? null, benchFim,
      delta, chart, serieNome, benchNome, parcNome, parcSel, empilhado, temCred, temBench: base.length > 0, nBase: base.length,
    };
  }, [compSeries, selKey, janela, mesAtual, hoje]);

  /* ---------- top categorias do mês selecionado (por competência) ---------- */
  const topCats = useMemo(() => {
    if (!calc) return { rows: [] as { cat: string; val: number; itens: Lancamento[] }[], total: 0 };
    const tot: Record<string, number> = {};
    const itens: Record<string, Lancamento[]> = {};
    dados.forEach((d) => {
      const g = dvGasto(d); if (!g) return;
      if (mesComp(d) !== calc.selKey) return;
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

  /* ---------- investimentos do mês selecionado (por competência) ---------- */
  // Investido (Σ Aporte) e Renda de investimentos (Σ Receita Investimento) — métricas
  // próprias, apartadas de gasto/receita. Só renderiza quando há valor classificado.
  const investMes = useMemo(() => {
    if (!calc) return { inv: 0, recInv: 0 };
    let inv = 0, recInv = 0;
    dados.forEach((d) => {
      if (mesComp(d) !== calc.selKey) return;
      inv += valorAporte(d);
      recInv += valorReceitaInvest(d);
    });
    return { inv, recInv };
  }, [dados, calc]);

  /* ---------- últimos lançamentos conhecidos ---------- */
  const ultimos = useMemo(() => {
    const arr: { d: Lancamento; k: string; dia: number }[] = [];
    dados.forEach((d) => {
      if (ehInterna(d) || (!ehGasto(d.classe) && !ehReceita(d.classe))) return; // esconde movimentos internos (ex.: gasto marcado "entre contas")
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
      if (precisaClassificar(d)) { grupos.add(normEstab(d.descricao)); classTotal += Math.abs(d.valor); classN++; }
    });
    return { classGrupos: grupos.size, classTotal, classN };
  }, [allDados]);

  /* ---------- planos: budget do mês selecionado + pendência de preenchimento ---------- */
  const [planosRaw, setPlanosRaw] = useState<Plano[] | null>(null);
  const [budget, setBudget] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await sb.from("planos").select("*").eq("ativo", true);
        setPlanosRaw(error || !data ? [] : (data as Plano[]));
      } catch { setPlanosRaw([]); }
    })();
  }, []);

  useEffect(() => {
    if (!planosRaw) return;
    if (!planosRaw.length) { setBudget(null); return; }
    (async () => {
      try {
        const card = planosRaw.find((p) => (p as any).eh_cartao_total) || null;
        const conta = planosRaw.find((p) => (p as any).eh_conta_total) || null;
        const rec = planosRaw.find((p) => (p as any).eh_receita_total) || null;
        const comuns = planosRaw.filter((p) => p.id !== card?.id && p.id !== conta?.id && p.id !== rec?.id);

        const meses = [...new Set([mesAtual, selKey].filter(Boolean))];
        const { data: mensal } = await sb.from("plano_mensal").select("plano_id,competencia,valor_real").in("competencia", meses);
        const ovr: Record<string, Record<number, number>> = {};
        (mensal || []).forEach((m: any) => { if (m.valor_real != null) (ovr[m.competencia] = ovr[m.competencia] || {})[m.plano_id] = m.valor_real; });

        // budget total (consolidado, sem contar em dobro) do mês selecionado
        if (selKey) {
          const proj = projetar(comuns, [{ k: selKey }], card, conta, rec, ovr);
          const g = proj[0]?.gerais ?? 0;
          setBudget(g > 0 ? g : null);
        }
      } catch { setBudget(null); }
    })();
  }, [planosRaw, selKey, mesAtual]);

  if (!calc) return <div className="text-muted p-4">Sem dados ainda — importe os primeiros PDFs para começar.</div>;

  const temPend = pend.classGrupos > 0;
  const roxo = cc.roxoLinha("1");

  // clique num dia do gráfico → detalhamento dos lançamentos daquele dia.
  // No mês corrente, só os dias já decorridos (até hoje) têm o que mostrar.
  const abrirDia = (dia?: number | string | null) => {
    const n = typeof dia === "string" ? parseInt(dia, 10) : dia;
    if (!n || n < 1 || n > calc.nd) return;
    if (calc.isAtual && n > calc.refDay) return;
    const rows = compSeries.diaRows[calc.selKey]?.[n - 1] || [];
    if (!rows.length) return;
    openModal(`Lançamentos · dia ${n} · ${dvLabel(calc.selKey)}`, rows);
  };

  // "ainda previsto" — placeholder provisório (cálculo final a definir):
  // o que falta para fechar o budget do mês (ou, sem budget, para alcançar a média).
  const aindaPrev = budget != null ? Math.max(0, budget - calc.gastoAtual)
    : calc.benchFim ? Math.max(0, calc.benchFim - calc.gastoAtual) : null;
  const aindaSub = budget != null ? "provisório · falta p/ o budget"
    : calc.benchFim ? "provisório · falta p/ a média" : "a definir";

  return (
    <div>
      {/* ---------- metade esquerda: gráfico · metade direita: 4 valores ---------- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[18px]">
        {/* gráfico: mês selecionado vs média da janela */}
        <Panel className="!mb-0 flex flex-col">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
            <div className="text-muted text-[12.5px] font-medium min-w-0">
              {dvLabel(calc.selKey)} {calc.completo ? "· fatura fechada" : "· em curso"} vs média {janela}m
            </div>
            <div className="flex items-center gap-[6px] shrink-0">
              <Seg size="sm" value={String(janela)} onChange={(v) => setJanela(+v)} options={JANELAS} />
              <Select value={selKey} onChange={setSelKey} className="!py-[6px] text-[12.5px]">
                {mesesOpc.map((k) => <option key={k} value={k}>{dvLabel(k)}{k === mesAtual ? " (atual)" : ""}</option>)}
              </Select>
            </div>
          </div>

          <div className="h-[200px] sm:h-[230px] mt-2 -ml-1 min-w-0 flex-1 cursor-pointer">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={calc.chart}
                margin={{ top: 6, right: 4, left: 4, bottom: 0 }}
                onClick={(s: any) => abrirDia(s?.activeLabel ?? (s?.activeTooltipIndex != null ? s.activeTooltipIndex + 1 : null))}
              >
                <defs>
                  <linearGradient id="heroGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={roxo} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={roxo} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="dia" hide />
                <YAxis hide domain={[0, "auto"]} />
                <Tooltip content={<ChartTip labelPrefix="Dia " />} />
                <Line type="monotone" dataKey={calc.benchNome} stroke={cc.media} strokeWidth={2} strokeDasharray="4 4" dot={false} connectNulls isAnimationActive={false} />
                {calc.empilhado && (
                  <Area type="monotone" dataKey={calc.parcNome} stackId="gasto" stroke={cc.parcela} strokeWidth={1.5} fill={cc.parcela} fillOpacity={0.13} dot={false} isAnimationActive={false} />
                )}
                <Area type="monotone" dataKey={calc.serieNome} stackId="gasto" stroke={roxo} strokeWidth={2.5} fill="url(#heroGrad)" dot={false} connectNulls={false} isAnimationActive={false} />
                {calc.empilhado && (
                  <Line
                    type="monotone" dataKey="Total gasto"
                    stroke={calc.temCred ? roxo : "transparent"} strokeWidth={1.5} strokeDasharray="5 3"
                    dot={false} activeDot={calc.temCred} connectNulls={false} isAnimationActive={false}
                  />
                )}
                {calc.empilhado && calc.temCred && (
                  <Line type="monotone" dataKey="Estornos do mês" stroke="transparent" dot={false} activeDot={false} connectNulls={false} isAnimationActive={false} />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2">
            <span className="inline-flex items-center gap-[6px] text-[11.5px] text-muted">
              <span className="w-[10px] h-[3px] rounded-full" style={{ background: roxo }} />{dvLabel(calc.selKey)}
            </span>
            <span className="inline-flex items-center gap-[6px] text-[11.5px] text-muted">
              <span className="w-[10px] h-0 border-t-2 border-dashed" style={{ borderColor: cc.media }} />Média {janela}m
            </span>
            {calc.parcSel > 0 && (
              <button
                onClick={() => openModal(`Parcelas de meses anteriores · ${dvLabel(calc.selKey)}`, compSeries.parcRows[calc.selKey] || [])}
                className="inline-flex items-center gap-[6px] text-[11.5px] text-muted bg-transparent border-0 p-0 cursor-pointer hover:text-accent transition-colors"
              >
                <span className="w-[10px] h-[3px] rounded-full" style={{ background: cc.parcela }} />
                Parcelas de meses anteriores · {BRL0(calc.parcSel)} ›
              </button>
            )}
            {calc.empilhado && calc.temCred && (
              <span className="inline-flex items-center gap-[6px] text-[11.5px] text-muted">
                <span className="w-[10px] h-0 border-t-2 border-dashed" style={{ borderColor: roxo }} />Total (após estornos)
              </span>
            )}
            {calc.delta != null && calc.comparavel && (
              <span className={`inline-flex items-center gap-1 rounded-full px-[10px] py-[3px] text-[12px] font-semibold ${
                calc.delta <= 0 ? "bg-green/10 text-green" : "bg-red/10 text-red"
              }`}>
                {calc.delta <= 0 ? "▼" : "▲"} {BRL0(Math.abs(calc.delta))} {calc.delta <= 0 ? "abaixo" : "acima"} da média{calc.isAtual ? " (no mesmo dia)" : ""}
              </span>
            )}
            {calc.delta != null && !calc.comparavel && (
              <span className="inline-flex items-center gap-1 rounded-full px-[10px] py-[3px] text-[12px] font-medium bg-fill text-muted">
                comparação parcial · faltam faturas
              </span>
            )}
          </div>
          <div className="text-[11.5px] text-muted mt-2">
            Pela competência (fatura/extrato do mês), cartão + contas. Parcelas e compras de meses anteriores já contam desde o dia 1º — o platô no início da curva.{!calc.completo ? " Mês ainda em curso." : ""} <span className="text-accent">Clique num dia para ver os lançamentos.</span>
          </div>
        </Panel>

        {/* 4 valores grandes */}
        <Panel className="!mb-0">
          <div className="divide-y divide-line">
            <BigVal
              label={`Gasto atual · ${dvLabel(calc.selKey)}`}
              value={BRL0(calc.gastoAtual)}
              sub={calc.isAtual ? `até hoje · dia ${calc.refDay}/${calc.nd}` : "fatura + extrato do mês"}
              extra={calc.empilhado ? (
                <div className="flex flex-wrap items-center gap-x-[7px] gap-y-[2px] text-[11.5px] text-muted mt-[5px] tabular-nums">
                  <span className="inline-flex items-center gap-[5px]">
                    <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: roxo }} />
                    {/* sem estorno, a parte "compras" deriva dos arredondados p/ a soma fechar */}
                    {BRL0(calc.credAtual > 0 ? Math.round(calc.comprasAtual) : Math.round(calc.gastoAtual) - Math.round(calc.parcSel))} compras do mês
                  </span>
                  <span aria-hidden>+</span>
                  <span className="inline-flex items-center gap-[5px]">
                    <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: cc.parcela }} />
                    {BRL0(calc.parcSel)} parcelas
                  </span>
                  {calc.credAtual > 0 && (
                    <>
                      <span aria-hidden>−</span>
                      {/* estornos derivam dos termos já arredondados p/ a soma fechar */}
                      <span>{BRL0(Math.round(calc.comprasAtual) + Math.round(calc.parcSel) - Math.round(calc.gastoAtual))} estornos</span>
                    </>
                  )}
                  <span aria-hidden>=</span>
                  <b className="font-semibold">{BRL0(calc.gastoAtual)}</b>
                </div>
              ) : undefined}
              dot={roxo}
            />
            <BigVal
              label="Esperado para este momento"
              value={calc.benchAtRef != null ? BRL0(calc.benchAtRef) : "—"}
              sub={calc.temBench ? `média ${janela}m no mesmo ponto · fim ~${BRL0(calc.benchFim)}` : "sem meses completos p/ comparar"}
              dot={cc.media}
            />
            <BigVal
              label="Ainda previsto no mês"
              value={aindaPrev != null ? BRL0(aindaPrev) : "—"}
              sub={aindaSub}
            />
            <BigVal
              label="Budget total do mês"
              value={budget != null ? BRL0(budget) : "—"}
              sub={budget != null ? "planejamento do mês" : "definir no Planejamento"}
              onClick={() => go("planejamento")}
            />
          </div>
        </Panel>
      </div>

      {/* ---------- pendências ---------- */}
      {temPend && (
        <Panel title="Pendências" className="!mb-0 mt-[18px]">
          <button
            onClick={() => go("classificar")}
            className="w-full text-left flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-amber/30 bg-amber/[0.07] px-[18px] py-[16px] cursor-pointer group hover:bg-amber/10 transition-colors"
          >
            <span className="flex items-center gap-[10px] min-w-0">
              <span className="w-[9px] h-[9px] rounded-full shrink-0 bg-amber" />
              <span className="min-w-0">
                <span className="block text-[13px] text-muted font-medium">Classificações pendentes</span>
                <span className="block text-[26px] sm:text-[30px] font-semibold tracking-tight tabular-nums leading-none mt-[3px] text-amber">
                  {pend.classGrupos}
                </span>
                <span className="block text-[12px] text-muted mt-[4px]">
                  {pend.classGrupos === 1 ? "estabelecimento" : "estabelecimentos"} · {pend.classN} {pend.classN === 1 ? "lançamento" : "lançamentos"} · {BRL0(pend.classTotal)}
                </span>
              </span>
            </span>
            <span className="ml-auto inline-flex items-center gap-[6px] rounded-full bg-amber/15 text-amber px-[14px] py-[7px] text-[13px] font-semibold group-hover:bg-amber/25 transition-colors">
              Classificar
              <span className="text-[15px] leading-none" aria-hidden>›</span>
            </span>
          </button>
        </Panel>
      )}

      {/* ---------- top categorias + últimos lançamentos ---------- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[18px] mt-[18px]">
        <Panel
          title="Onde foi o dinheiro"
          sub={`(${dvLabel(calc.selKey)} · clique p/ detalhar)`}
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
                  right={`${BRL0(c.val)} · ${topCats.total ? Math.round((c.val / topCats.total) * 100) : 0}%`}
                  onClick={() => openModal(`${c.cat} · ${dvLabel(calc.selKey)}`, c.itens)}
                />
              ))}
            </div>
          ) : (
            <div className="text-muted text-[13px] py-2">Sem gastos registrados neste mês.</div>
          )}
          {(investMes.inv > 0 || investMes.recInv > 0) && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 pt-3 border-t border-line text-[12px]">
              {investMes.inv > 0 && (
                <span className="text-muted">Investido no mês <b className="text-violet">{BRL0(investMes.inv)}</b></span>
              )}
              {investMes.recInv > 0 && (
                <span className="text-muted">Renda de investimentos <b className="text-green">{BRL0(investMes.recInv)}</b></span>
              )}
            </div>
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
                  <div className="text-[11.5px] text-muted truncate">{dataCompleta(d)} · {catKey(d)} · {d.origem}</div>
                </div>
                <div className={`tabular-nums text-[13px] font-medium shrink-0 ${ehReceita(d.classe) || d.valor > 0 ? "text-green" : ""}`}>
                  {BRL0(d.valor)}
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
