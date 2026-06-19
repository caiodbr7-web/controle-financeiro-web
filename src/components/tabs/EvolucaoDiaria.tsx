import { useState, useMemo } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ComposedChart, Bar,
} from "recharts";
import type { Lancamento, Modo } from "../../types";
import { Panel, Kpi, Seg } from "../ui";
import { useChart, ChartTip } from "../../lib/theme";
import {
  BRL, brlShort, dvSeries, dvDiasNoMes, dvLabel, dvGasto, dvDataReal,
  mvLimiteParcial, mvSeriesMensal, mvOrigemOk, MODOS, deltaTxt,
} from "../../lib/finance";

interface Props {
  dados: Lancamento[]; allDados: Lancamento[]; months: string[];
  openModal: (title: string, rows: Lancamento[]) => void;
}
const MODO_OPTS: { v: Modo; label: string }[] = [
  { v: "cartao", label: "Só cartão" }, { v: "ambos", label: "Cartão + contas" }, { v: "conta", label: "Só contas" },
];
const MESES_OPTS = [
  { v: "3", label: "3m" }, { v: "6", label: "6m" }, { v: "12", label: "12m" }, { v: "all", label: "Tudo" },
];
const ALPHA = (i: number, n: number) => (0.2 + 0.45 * (n > 1 ? i / (n - 1) : 1)).toFixed(3);

export function EvolucaoDiaria({ dados, allDados, months, openModal }: Props) {
  const [modo, setModo] = useState<Modo>("cartao");
  const [mesesSel, setMesesSel] = useState("6");
  const meta = MODOS[modo];
  const cc = useChart();

  const calc = useMemo(() => {
    const { keys, map } = dvSeries(dados, months, modo);
    const limParcial = mvLimiteParcial(allDados, modo);
    const completos = keys.filter((k) => k < limParcial);
    const n = mesesSel === "all" ? completos.length : parseInt(mesesSel, 10) || 6;
    const show = mesesSel === "all" ? completos : completos.slice(-n);

    const cums: Record<string, (number | null)[]> = {};
    completos.forEach((k) => {
      const nd = dvDiasNoMes(k); const c: (number | null)[] = []; let s = 0;
      for (let j = 0; j < 31; j++) { if (j < nd) { s += map[k][j]; c.push(Math.round(s * 100) / 100); } else c.push(null); }
      cums[k] = c;
    });
    const base3 = completos.slice(-3);
    const bench: (number | null)[] = [];
    for (let j = 0; j < 31; j++) {
      let sum = 0, cnt = 0;
      base3.forEach((k) => { const nd = dvDiasNoMes(k); const v = j < nd ? cums[k][j] : cums[k][nd - 1]; if (v != null) { sum += v; cnt++; } });
      bench.push(cnt ? Math.round((sum / cnt) * 100) / 100 : null);
    }
    const data = Array.from({ length: 31 }, (_, i) => {
      const row: any = { dia: i + 1 };
      show.forEach((k) => { row[dvLabel(k)] = cums[k][i]; });
      row["Média 3 meses"] = bench[i];
      return row;
    });

    // grandes números
    let modeTot = 0, diasTot = 0, cardTot = 0, contaTot = 0;
    const showSet = new Set(show);
    show.forEach((k) => { modeTot += (cums[k][dvDiasNoMes(k) - 1] as number) || 0; diasTot += dvDiasNoMes(k); });
    dados.forEach((d) => {
      const g = dvGasto(d); if (!g) return; const r = dvDataReal(d); if (!r || !showSet.has(r.k)) return;
      const o = String(d.origem || ""); if (o.startsWith("Cartao")) cardTot += g; else if (o.startsWith("Conta")) contaTot += g;
    });
    const splitTot = cardTot + contaTot;
    const pctCard = splitTot ? (cardTot / splitTot) * 100 : 0, pctConta = splitTot ? (contaTot / splitTot) * 100 : 0;
    const mediaDia = diasTot ? modeTot / diasTot : 0, mediaMes = show.length ? modeTot / show.length : 0;

    let benchFim = 0; for (let j = 30; j >= 0; j--) { if (bench[j] != null) { benchFim = bench[j] as number; break; } }

    return { show, data, mediaDia, mediaMes, pctCard, pctConta, cardTot, contaTot, benchFim };
  }, [dados, allDados, months, modo, mesesSel]);

  // seção mensal (barras + linha média móvel)
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

  const stats = [
    { t: "Gasto médio / dia", v: BRL(calc.mediaDia), s: `${meta.rotulo.toLowerCase()} · ${calc.show.length} ${calc.show.length === 1 ? "mês" : "meses"}`, c: "" },
    { t: "% no cartão", v: `${calc.pctCard.toFixed(0)}%`, s: `${BRL(calc.cardTot)} do total`, c: "text-accent" },
    { t: "% em conta", v: `${calc.pctConta.toFixed(0)}%`, s: `${BRL(calc.contaTot)} · Pix, boleto, débito`, c: "text-violet" },
    { t: "Gasto médio / mês", v: BRL(calc.mediaMes), s: `${meta.rotulo.toLowerCase()} · meses completos`, c: "text-amber" },
  ];

  return (
    <div>
      <Panel
        title="Gasto acumulado ao longo do mês"
        sub="(pela data real da compra · só meses completos)"
        right={
          <div className="flex items-center gap-2 flex-wrap">
            <Seg size="sm" value={mesesSel} onChange={setMesesSel} options={MESES_OPTS} />
            <Seg size="sm" value={modo} onChange={(v) => setModo(v as Modo)} options={MODO_OPTS} />
          </div>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-[18px] items-stretch mt-2">
          <div className="h-[300px] md:h-[440px] min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={calc.data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
                <CartesianGrid stroke={cc.grid} vertical={false} />
                <XAxis dataKey="dia" tick={cc.tickSm} minTickGap={6} axisLine={false} tickLine={false} />
                <YAxis tick={cc.tickSm} tickFormatter={(v) => brlShort(v)} width={56} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTip labelPrefix="Dia " />} />
                {calc.show.map((k, i) => (
                  <Line key={dvLabel(k)} type="monotone" dataKey={dvLabel(k)}
                    stroke={cc.roxoLinha(ALPHA(i, calc.show.length))} strokeWidth={1.6} dot={false} connectNulls={false} isAnimationActive={false} />
                ))}
                <Line type="monotone" dataKey="Média 3 meses" stroke={cc.media} strokeWidth={4.5} dot={false} connectNulls isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-2 gap-3 md:flex md:flex-col md:h-full">
            {stats.map((s) => (
              <div key={s.t} className="md:flex-1 flex flex-col justify-center bg-card border border-line rounded-[18px] p-4 sm:p-[18px] shadow-card min-w-0">
                <div className="text-muted text-[12px] font-medium">{s.t}</div>
                <div className={`text-[22px] sm:text-[28px] font-semibold mt-[5px] tracking-tight tabular-nums ${s.c}`}>{s.v}</div>
                <div className="text-[11.5px] mt-[3px] text-muted">{s.s}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="text-muted text-[12.5px] mt-4 leading-relaxed">
          A <b className="text-amber">linha laranja grossa</b> é a <b>média dos últimos 3 meses completos</b>, dia a dia — onde você deveria estar.
          As linhas roxas são os meses completos (mais fortes = mais recentes). Meses parciais (mês atual e faturas por vir) ficam de fora.
        </div>
      </Panel>

      <Panel
        title="Evolução mensal do gasto"
        sub="(só meses completos · média móvel de 3 meses)"
      >
        <div className="grid grid-cols-2 md:grid-cols-3 gap-[14px] mt-3 mb-2">
          <Kpi title="Patamar (média 3m)" value={BRL(mensal.patamar)} sub="média dos últimos 3 meses completos" color="text-accent" />
          <Kpi title={`Último mês · ${mensal.ultLabel}`} value={BRL(mensal.ultVal)} sub={mensal.baseAnt != null ? deltaTxt(mensal.ultVal, mensal.baseAnt) + " vs média 3m" : "—"} />
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
                  const rows = dados.filter((x) => { if (!dvGasto(x)) return false; if (!mvOrigemOk(x.origem, modo)) return false; const r = dvDataReal(x); return r && r.k === k; });
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
                    <td className="num text-red">{BRL(r.gasto)}</td>
                    <td className="num">{a != null ? BRL(a) : "—"}</td>
                    <td className="num">
                      {d == null ? "—" : d <= 0 ? <span className="text-green">▼ {BRL(Math.abs(d))}</span> : <span className="text-red">▲ {BRL(d)}</span>}
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
