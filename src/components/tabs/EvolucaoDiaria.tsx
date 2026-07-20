import { useEffect, useState, useMemo } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ComposedChart, Bar, Area,
} from "recharts";
import type { Lancamento, Modo } from "../../types";
import { Panel, Kpi, Seg, Select, Legenda } from "../ui";
import { useChart, useTheme, ChartTip, useIsMobile } from "../../lib/theme";
import {
  BRL0, kBRL, brlShort, dvLabel, dvGasto, mesComp, dvDiasNoMes, diaDoMov, ehParcelaAnterior,
  catKey, mvSeriesMensal, mvOrigemOk, MODOS, deltaTxt,
} from "../../lib/finance";

// categorias tratadas como "gasto de casa fixo" — somadas numa faixa própria,
// independente de terem caído no cartão ou em conta.
const CASA_FIXO = new Set(["Moradia - Contas Mensais", "Moradia - Aluguel + IPTU"]);
const ehCasaFixo = (d: Lancamento) => CASA_FIXO.has(catKey(d));

interface Props {
  dados: Lancamento[]; allDados: Lancamento[]; months: string[];
  openModal: (title: string, rows: Lancamento[]) => void;
}
const MODO_OPTS: { v: Modo; label: string }[] = [
  { v: "ambos", label: "Cartão + contas" }, { v: "cartao", label: "Só cartão" }, { v: "conta", label: "Só contas" },
];
const MESES_OPTS = [
  { v: "3", label: "3m" }, { v: "6", label: "6m" }, { v: "12", label: "12m" }, { v: "all", label: "Tudo" },
];
const JANELAS = [{ v: "3", label: "3m" }, { v: "6", label: "6m" }, { v: "12", label: "12m" }];

export function EvolucaoDiaria({ dados, allDados, months, openModal }: Props) {
  const cc = useChart();
  const mobile = useIsMobile();
  const { dark } = useTheme();
  const hoje = new Date();
  const mesAtual = hoje.getFullYear() + "-" + String(hoje.getMonth() + 1).padStart(2, "0");

  // cores do split da curva diária (bem separadas p/ o empilhamento)
  const corParc = cc.parcela;                       // ciano — parcelamentos
  const corCasa = dark ? "#34d399" : "#059669";     // verde — casa fixo
  const corCartao = dark ? "#a78bfa" : "#6d28d9";   // roxo  — cartão (não casa)
  const corGeral = dark ? "#fb7185" : "#c2334a";    // rosa  — gastos gerais (não casa)

  /* ---------- primeiro gráfico: mês selecionado, quebrado em 4 faixas ---------- */
  const [heroMes, setHeroMes] = useState("");
  const [janela, setJanela] = useState(3);

  // séries diárias por COMPETÊNCIA, separando as compras do PRÓPRIO mês em três
  // faixas — CASA FIXO (Moradia · cotas/aluguel+IPTU, cartão ou conta), CARTÃO
  // (não casa fixo) e GASTOS GERAIS (não casa fixo, em conta) — mais as
  // PARCELAS/compras de meses anteriores (o platô do dia 1). Estornos à parte.
  const compSeries = useMemo(() => {
    const casa: Record<string, number[]> = {};
    const cartao: Record<string, number[]> = {};
    const geral: Record<string, number[]> = {};
    const cred: Record<string, number[]> = {};
    const parc: Record<string, number> = {};
    const parcRows: Record<string, Lancamento[]> = {};
    const diaRows: Record<string, Lancamento[][]> = {};
    for (const d of dados) {
      const g = dvGasto(d);
      if (!g) continue;
      const k = mesComp(d);
      if (!/^\d{4}-\d{2}$/.test(k)) continue;
      if (ehParcelaAnterior(d)) {
        parc[k] = (parc[k] || 0) + g;
        (parcRows[k] = parcRows[k] || []).push(d);
        continue;
      }
      const dia = Math.min(diaDoMov(d), dvDiasNoMes(k));
      (diaRows[k] = diaRows[k] || Array.from({ length: 31 }, () => []))[dia - 1].push(d);
      if (g < 0) {
        (cred[k] = cred[k] || new Array(31).fill(0))[dia - 1] += Math.abs(g);
      } else {
        const alvo = ehCasaFixo(d) ? casa
          : String(d.origem || "").startsWith("Cartao") ? cartao : geral;
        (alvo[k] = alvo[k] || new Array(31).fill(0))[dia - 1] += g;
      }
    }
    return { casa, cartao, geral, cred, parc, parcRows, diaRows };
  }, [dados]);

  const mesesOpc = useMemo(() => {
    const ks = new Set([
      ...Object.keys(compSeries.casa), ...Object.keys(compSeries.cartao),
      ...Object.keys(compSeries.geral), ...Object.keys(compSeries.cred),
      ...Object.keys(compSeries.parc),
    ]);
    ks.add(mesAtual);
    return [...ks].filter((k) => k <= mesAtual).sort().reverse();
  }, [compSeries, mesAtual]);

  useEffect(() => {
    if (heroMes && mesesOpc.includes(heroMes)) return;
    setHeroMes(mesesOpc[0] || mesAtual);
  }, [mesesOpc, heroMes, mesAtual]);

  const hero = useMemo(() => {
    if (!heroMes) return null;
    const { casa, cartao, geral, cred, parc } = compSeries;
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const cumDe = (m: Record<string, number[]>, k: string) => {
      const nd = dvDiasNoMes(k); const out: number[] = []; let s = 0;
      for (let j = 0; j < nd; j++) { s += m[k]?.[j] || 0; out.push(r2(s)); }
      return out;
    };
    // total líquido de um mês num dia j: platô + casa fixo + cartão + geral − estornos
    const totCum = (k: string) => {
      const p = parc[k] || 0;
      const cf = cumDe(casa, k), ca = cumDe(cartao, k), ge = cumDe(geral, k), cr = cumDe(cred, k);
      return ca.map((_, j) => r2(p + cf[j] + ca[j] + ge[j] - cr[j]));
    };

    const nd = dvDiasNoMes(heroMes);
    const isAtual = heroMes === mesAtual;
    const completo = heroMes < mesAtual;
    const refDay = isAtual ? Math.min(hoje.getDate(), nd) : nd;
    const comparavel = completo || isAtual;

    // benchmark: média do total acumulado dos N meses ANTERIORES ao selecionado
    const keysAll = new Set([
      ...Object.keys(casa), ...Object.keys(cartao), ...Object.keys(geral),
      ...Object.keys(cred), ...Object.keys(parc),
    ]);
    const base = [...keysAll].filter((k) => k < heroMes).sort().slice(-janela);
    const bench: (number | null)[] = [];
    for (let j = 0; j < 31; j++) {
      let s = 0, c = 0;
      base.forEach((k) => { const a = totCum(k); const v = j < a.length ? a[j] : a[a.length - 1]; if (v != null) { s += v; c++; } });
      bench.push(c ? r2(s / c) : null);
    }
    let benchFim = 0;
    for (let j = nd - 1; j >= 0; j--) if (bench[j] != null) { benchFim = bench[j] as number; break; }
    const benchAtRef = bench[refDay - 1] ?? null;

    const parcSel = r2(parc[heroMes] || 0);
    const casaArr = cumDe(casa, heroMes);
    const cartaoArr = cumDe(cartao, heroMes);
    const geralArr = cumDe(geral, heroMes);
    const credArr = cumDe(cred, heroMes);
    const totArr = totCum(heroMes);

    const parcNome = "Parcelamentos";
    const casaNome = "Gastos casa fixo";
    const cartaoNome = "Cartão (não casa fixo)";
    const geralNome = "Gastos gerais (não casa fixo)";
    const benchNome = `Média ${janela}m`;
    const temCred = credArr[refDay - 1] > 0;

    // empilha: Parcelamentos (base) + Casa fixo + Cartão + Gastos gerais;
    // estornos como termo separado. no mês atual, dias após hoje ficam nulos.
    const chart = Array.from({ length: nd }, (_, i) => {
      const futuro = isAtual && i + 1 > refDay;
      return {
        dia: i + 1,
        [parcNome]: futuro ? null : parcSel,
        [casaNome]: futuro ? null : casaArr[i],
        [cartaoNome]: futuro ? null : cartaoArr[i],
        [geralNome]: futuro ? null : geralArr[i],
        [benchNome]: bench[i],
        "Total gasto": futuro ? null : totArr[i],
        ...(temCred ? { "Estornos do mês": futuro ? null : -credArr[i] } : {}),
      };
    });

    const casaAtual = r2(casaArr[refDay - 1] || 0);
    const cartaoAtual = r2(cartaoArr[refDay - 1] || 0);
    const geralAtual = r2(geralArr[refDay - 1] || 0);
    const credAtual = r2(credArr[refDay - 1] || 0);
    const totAtual = r2(totArr[refDay - 1] || 0);
    const delta = benchAtRef != null ? r2(totAtual - benchAtRef) : null;

    return {
      heroMes, isAtual, completo, comparavel, nd, refDay, chart,
      parcNome, casaNome, cartaoNome, geralNome, benchNome, temCred,
      parcSel, casaAtual, cartaoAtual, geralAtual, credAtual, totAtual,
      benchAtRef, benchFim, delta, temBench: base.length > 0,
    };
  }, [compSeries, heroMes, janela, mesAtual, hoje]);

  const abrirDia = (dia?: number | string | null) => {
    if (!hero) return;
    const n = typeof dia === "string" ? parseInt(dia, 10) : dia;
    if (!n || n < 1 || n > hero.nd) return;
    if (hero.isAtual && n > hero.refDay) return;
    const rows = compSeries.diaRows[hero.heroMes]?.[n - 1] || [];
    if (!rows.length) return;
    openModal(`Lançamentos · dia ${n} · ${dvLabel(hero.heroMes)}`, rows);
  };

  /* ---------- segundo gráfico: evolução mensal (barras + média móvel) ---------- */
  const [modo, setModo] = useState<Modo>("ambos");
  const [mesesSel, setMesesSel] = useState("6");
  const meta = MODOS[modo];

  const mensal = useMemo(() => {
    const { keys, tot } = mvSeriesMensal(dados, allDados, months, modo);
    const avg = keys.map((k, i) => { const p = keys.slice(Math.max(0, i - 3), i); return p.length ? p.reduce((s, x) => s + tot[x], 0) / p.length : null; });
    const n = mesesSel === "all" ? keys.length : Math.min(keys.length, parseInt(mesesSel, 10) || 6);
    const i0 = keys.length - n;
    const sKeys = keys.slice(i0);
    const data = sKeys.map((k, idx) => ({ mes: dvLabel(k), gasto: tot[k], media: avg[i0 + idx], _k: k }));
    const last3 = keys.slice(-3);
    const patamar = last3.length ? last3.reduce((s, k) => s + tot[k], 0) / last3.length : 0;
    const ult = keys.length - 1, ultVal = ult >= 0 ? tot[keys[ult]] : 0, baseAnt = ult >= 0 ? avg[ult] : null;
    return { data, patamar, ultVal, ultLabel: ult >= 0 ? dvLabel(keys[ult]) : "—", baseAnt };
  }, [dados, allDados, months, modo, mesesSel]);

  if (!hero) return <div className="text-muted p-4">Sem dados ainda — importe os primeiros PDFs para começar.</div>;

  // lançamentos que compõem cada balde do mês-herói, ACUMULADOS até o dia de
  // referência — alimentam o drill-down ao clicar num card.
  const rowsBalde = (balde: "total" | "parc" | "casa" | "cartao" | "geral"): Lancamento[] => {
    if (!hero) return [];
    const mk = hero.heroMes;
    const parcRows = compSeries.parcRows[mk] || [];
    if (balde === "parc") return parcRows;
    const dias = compSeries.diaRows[mk] || [];
    const ateHoje = dias.slice(0, hero.refDay).flat();
    const gastosPos = ateHoje.filter((d) => dvGasto(d) > 0);
    if (balde === "total") return [...parcRows, ...ateHoje];
    if (balde === "casa") return gastosPos.filter((d) => ehCasaFixo(d));
    if (balde === "cartao") return gastosPos.filter((d) => !ehCasaFixo(d) && String(d.origem || "").startsWith("Cartao"));
    // geral
    return gastosPos.filter((d) => !ehCasaFixo(d) && !String(d.origem || "").startsWith("Cartao"));
  };
  const abrirBalde = (balde: "total" | "parc" | "casa" | "cartao" | "geral", titulo: string) => {
    const rows = rowsBalde(balde);
    if (rows.length) openModal(`${titulo} · ${dvLabel(hero.heroMes)}`, rows);
  };

  const splitStats = [
    { t: "Gasto do mês", v: BRL0(hero.totAtual), s: hero.isAtual ? `até hoje · dia ${hero.refDay}/${hero.nd}` : "fatura + extrato do mês", c: "", dot: "", balde: "total" as const },
    { t: "parcelamentos", v: BRL0(hero.parcSel), s: "comprometido no dia 1", c: "", dot: corParc, balde: "parc" as const },
    { t: "casa fixo", v: BRL0(hero.casaAtual), s: "contas mensais + aluguel/IPTU", c: "", dot: corCasa, balde: "casa" as const },
    { t: "cartão (não casa)", v: BRL0(hero.cartaoAtual), s: "compras do próprio mês", c: "", dot: corCartao, balde: "cartao" as const },
    { t: "gastos gerais", v: BRL0(hero.geralAtual), s: "não casa fixo · em conta", c: "", dot: corGeral, balde: "geral" as const },
  ];

  return (
    <div>
      <Panel
        title="Gasto acumulado ao longo do mês"
        sub="por competência"
        right={
          <div className="flex items-center gap-2 flex-wrap">
            <Seg size="sm" value={String(janela)} onChange={(v) => setJanela(+v)} options={JANELAS} />
            <Select value={heroMes} onChange={setHeroMes} className="!py-[6px] text-[12.5px]">
              {mesesOpc.map((k) => <option key={k} value={k}>{dvLabel(k)}{k === mesAtual ? " (atual)" : ""}</option>)}
            </Select>
          </div>
        }
      >
        <div className="text-muted text-[12.5px] font-medium mt-1">
          {dvLabel(hero.heroMes)} {hero.completo ? "· fatura fechada" : "· em curso"} vs média {janela}m
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-[18px] items-stretch mt-2">
          <div className="h-[300px] md:h-[440px] min-w-0 cursor-pointer">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={hero.chart}
                margin={{ top: 8, right: 12, left: 4, bottom: 4 }}
                onClick={(s: any) => abrirDia(s?.activeLabel ?? (s?.activeTooltipIndex != null ? s.activeTooltipIndex + 1 : null))}
              >
                <CartesianGrid stroke={cc.grid} vertical={false} />
                <XAxis dataKey="dia" tick={cc.tickSm} minTickGap={6} axisLine={false} tickLine={false} />
                <YAxis tick={cc.tickSm} tickFormatter={(v) => brlShort(v)} width={56} axisLine={false} tickLine={false} />
                {/* mobile: tooltip ancorado ABAIXO do gráfico (não cobre as curvas) */}
                <Tooltip
                  content={<ChartTip labelPrefix="Dia " />}
                  position={mobile ? { x: 0, y: 308 } : undefined}
                  allowEscapeViewBox={mobile ? { x: false, y: true } : undefined}
                  wrapperStyle={mobile ? { zIndex: 30 } : undefined}
                />
                <Area type="monotone" dataKey={hero.parcNome} stackId="gasto" stroke={corParc} strokeWidth={1.4} fill={corParc} fillOpacity={0.16} dot={false} isAnimationActive={false} />
                <Area type="monotone" dataKey={hero.casaNome} stackId="gasto" stroke={corCasa} strokeWidth={1.8} fill={corCasa} fillOpacity={0.18} dot={false} connectNulls={false} isAnimationActive={false} />
                <Area type="monotone" dataKey={hero.cartaoNome} stackId="gasto" stroke={corCartao} strokeWidth={1.8} fill={corCartao} fillOpacity={0.18} dot={false} connectNulls={false} isAnimationActive={false} />
                <Area type="monotone" dataKey={hero.geralNome} stackId="gasto" stroke={corGeral} strokeWidth={1.8} fill={corGeral} fillOpacity={0.18} dot={false} connectNulls={false} isAnimationActive={false} />
                {hero.temCred && (
                  <Line type="monotone" dataKey="Estornos do mês" stroke="transparent" dot={false} activeDot={false} connectNulls={false} isAnimationActive={false} />
                )}
                <Line type="monotone" dataKey="Total gasto" stroke="transparent" dot={false} activeDot={false} connectNulls={false} isAnimationActive={false} />
                <Line type="monotone" dataKey={hero.benchNome} stroke={cc.media} strokeWidth={2} strokeDasharray="4 4" dot={false} connectNulls isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-2 gap-3 md:flex md:flex-col md:h-full">
            {splitStats.map((s) => (
              <button
                key={s.t}
                onClick={() => abrirBalde(s.balde, s.t)}
                title={`Ver lançamentos · ${s.t}`}
                className="md:flex-1 flex flex-col justify-center bg-card border border-line rounded-[18px] p-4 sm:p-[18px] shadow-card min-w-0 text-left cursor-pointer transition-all hover:-translate-y-[2px] hover:border-accent/50 hover:shadow-card-hover"
              >
                <div className="flex items-center gap-[6px] text-muted text-[12px] font-medium">
                  {s.dot && <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: s.dot }} />}
                  {s.t}
                </div>
                <div className={`text-[22px] sm:text-[28px] font-semibold mt-[5px] tracking-tight tabular-nums ${s.c}`}>{s.v}</div>
                <div className="text-[11.5px] mt-[3px] text-muted">{s.s}</div>
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3">
          <span className="inline-flex items-center gap-[6px] text-[11.5px] text-muted">
            <span className="w-[10px] h-[3px] rounded-full" style={{ background: corParc }} />Parcelamentos
          </span>
          <span className="inline-flex items-center gap-[6px] text-[11.5px] text-muted">
            <span className="w-[10px] h-[3px] rounded-full" style={{ background: corCasa }} />Casa fixo
          </span>
          <span className="inline-flex items-center gap-[6px] text-[11.5px] text-muted">
            <span className="w-[10px] h-[3px] rounded-full" style={{ background: corCartao }} />Cartão
          </span>
          <span className="inline-flex items-center gap-[6px] text-[11.5px] text-muted">
            <span className="w-[10px] h-[3px] rounded-full" style={{ background: corGeral }} />Gastos gerais
          </span>
          <span className="inline-flex items-center gap-[6px] text-[11.5px] text-muted">
            <span className="w-[10px] h-0 border-t-2 border-dashed" style={{ borderColor: cc.media }} />Média {janela}m
          </span>
          {hero.delta != null && hero.comparavel && (
            <span className={`inline-flex items-center gap-1 rounded-full px-[10px] py-[3px] text-[12px] font-semibold ${
              hero.delta <= 0 ? "bg-green/10 text-green" : "bg-red/10 text-red"
            }`}>
              {hero.delta <= 0 ? "▼" : "▲"} {BRL0(Math.abs(hero.delta))} {hero.delta <= 0 ? "abaixo" : "acima"} da média{hero.isAtual ? " (no mesmo dia)" : ""}
            </span>
          )}
        </div>
        <div className="mt-3">
        <Legenda>
          A curva é o gasto do mês empilhado em quatro faixas: <b style={{ color: corParc }}>parcelamentos</b> (o platô de meses anteriores, já comprometido no dia 1),
          <b style={{ color: corCasa }}> casa fixo</b> (contas mensais + aluguel/IPTU),
          <b style={{ color: corCartao }}> cartão</b> (não casa fixo) e <b style={{ color: corGeral }}>gastos gerais</b> (não casa fixo, em conta) — os quatro somados são o gasto total daquele mês.
          A <b className="text-amber">linha tracejada</b> é a média dos últimos {janela} meses no mesmo ponto do mês. <span className="text-accent">Clique num dia para ver os lançamentos.</span>
        </Legenda>
        </div>
      </Panel>

      <Panel
        title="Evolução mensal do gasto"
        sub="(só meses completos · média móvel de 3 meses)"
        right={
          <div className="flex items-center gap-2 flex-wrap">
            <Seg size="sm" value={mesesSel} onChange={setMesesSel} options={MESES_OPTS} />
            <Seg size="sm" value={modo} onChange={(v) => setModo(v as Modo)} options={MODO_OPTS} />
          </div>
        }
      >
        <div className="grid grid-cols-2 md:grid-cols-3 gap-[14px] mt-3 mb-2">
          <Kpi title="Patamar (média 3m)" value={kBRL(mensal.patamar)} sub="média dos últimos 3 meses completos" color="text-accent" />
          <Kpi title={`Último mês · ${mensal.ultLabel}`} value={kBRL(mensal.ultVal)} sub={mensal.baseAnt != null ? deltaTxt(mensal.ultVal, mensal.baseAnt) + " vs média 3m" : "—"} />
          <Kpi title="Meses exibidos" value={mensal.data.length} sub="só meses completos" />
        </div>
        <div className="h-[clamp(260px,38vh,380px)]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={mensal.data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
              <CartesianGrid stroke={cc.grid} vertical={false} />
              <XAxis dataKey="mes" tick={cc.tick} axisLine={false} tickLine={false} />
              <YAxis tick={cc.tick} tickFormatter={(v) => brlShort(v)} width={64} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTip />} cursor={cc.cursor} />
              <Legend wrapperStyle={{ fontSize: 11.5 }} iconType="circle" iconSize={7} />
              <Bar dataKey="gasto" name={"Gasto · " + meta.rotulo} fill={meta.cor} radius={[5, 5, 0, 0]}
                cursor="pointer"
                onClick={(d: any) => {
                  const k = d?.payload?._k ?? d?._k; if (!k) return;
                  const rows = dados.filter((x) => { if (!dvGasto(x)) return false; if (!mvOrigemOk(x.origem, modo)) return false; return mesComp(x) === k; });
                  openModal("Gasto " + meta.rotulo + " · " + dvLabel(k), rows);
                }} />
              <Line type="monotone" dataKey="media" name="Média 3 meses" stroke={cc.saldo} strokeWidth={2.5} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="overflow-x-auto scroll-thin mt-3">
          <table className="tbl">
            <thead><tr>
              <th>Mês</th>
              <th className="num">Gasto</th>
              <th className="num">Média 3m</th>
              <th className="num">vs média</th>
            </tr></thead>
            <tbody>
              {[...mensal.data].reverse().map((r) => {
                const a = r.media as number | null;
                const d = a != null ? r.gasto - a : null;
                return (
                  <tr key={r.mes}>
                    <td>{r.mes}</td>
                    <td className="num text-red">{BRL0(r.gasto)}</td>
                    <td className="num">{a != null ? BRL0(a) : "—"}</td>
                    <td className="num">
                      {d == null ? "—" : d <= 0 ? <span className="text-green">▼ {BRL0(Math.abs(d))}</span> : <span className="text-red">▲ {BRL0(d)}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
