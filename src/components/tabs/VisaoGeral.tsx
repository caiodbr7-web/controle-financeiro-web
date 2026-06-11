import { useState, useMemo } from "react";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, BarChart, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import type { Lancamento } from "../../types";
import { Panel, Kpi, Seg, Toolbar } from "../ui";
import { useChart, ChartTip } from "../../lib/theme";
import {
  BRL, brlShort, mesCurto, monthAgg, ehGasto, ehReceita, corChave, ordemChave,
} from "../../lib/finance";

interface Props { dados: Lancamento[]; months: string[]; openModal: (t: string, r: Lancamento[]) => void; }

const PERIODOS = [
  { v: "6", label: "6m" }, { v: "12", label: "12m" }, { v: "24", label: "24m" }, { v: "all", label: "Tudo" },
];

export function VisaoGeral({ dados, months, openModal }: Props) {
  const [periodo, setPeriodo] = useState("12");
  const cc = useChart();

  const vm = useMemo(() => {
    if (!months.length) return [];
    if (periodo === "all") return months;
    return months.slice(-(parseInt(periodo, 10) || 12));
  }, [months, periodo]);

  const aggs = useMemo(() => vm.map((m) => ({ m, ...monthAgg(dados, m) })), [dados, vm]);

  const kpis = useMemo(() => {
    let ri = vm.length - 2; if (ri < 0) ri = vm.length - 1;
    const ref = vm[ri]; if (!ref) return null;
    const cur = monthAgg(dados, ref);
    const last3 = vm.slice(Math.max(0, ri - 2), ri + 1); const n = last3.length || 1;
    const av = { rec: 0, gas: 0, saldo: 0 };
    last3.forEach((x) => { const a = monthAgg(dados, x); av.rec += a.rec; av.gas += a.gas; av.saldo += a.saldo; });
    return { label: mesCurto(ref), cur, av: { rec: av.rec / n, gas: av.gas / n, saldo: av.saldo / n } };
  }, [dados, vm]);

  const pivot = (classFn: (c: string | null) => boolean, keyFn: (d: Lancamento) => string) => {
    const keys = [...new Set(dados.filter((d) => classFn(d.classe)).map(keyFn))]
      .sort((a, b) => ordemChave(a) - ordemChave(b) || String(a).localeCompare(String(b)));
    const data = vm.map((m) => {
      const row: any = { mes: mesCurto(m), _m: m };
      keys.forEach((k) => { row[k] = dados.filter((d) => d.competencia === m && classFn(d.classe) && keyFn(d) === k).reduce((s, d) => s + Math.abs(d.valor), 0); });
      return row;
    });
    return { keys, data };
  };
  const gastoPivot = useMemo(() => pivot(ehGasto, (d) => d.origem), [dados, vm]);
  const recPivot = useMemo(() => pivot(ehReceita, (d) => d.banco), [dados, vm]);

  const chartData = aggs.map((a) => ({ mes: mesCurto(a.m), Receitas: a.rec, Despesas: a.gas, Saldo: a.saldo, _m: a.m }));

  return (
    <div>
      <Toolbar
        right={vm.length > 0 && (
          <span className="text-muted text-[12px]">{mesCurto(vm[0])} — {mesCurto(vm[vm.length - 1])} · {vm.length} meses</span>
        )}
      >
        <Seg value={periodo} onChange={setPeriodo} options={PERIODOS} />
      </Toolbar>

      {kpis && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-[14px] mb-[18px]">
          <Kpi title="Receitas" value={BRL(kpis.cur.rec)} sub={`${kpis.label} · média 3m ${BRL(kpis.av.rec)}`} color="text-green" />
          <Kpi title="Despesas" value={BRL(kpis.cur.gas)} sub={`${kpis.label} · média 3m ${BRL(kpis.av.gas)}`} color="text-red" />
          <Kpi title="Saldo" value={BRL(kpis.cur.saldo)} sub={`receitas − despesas · média 3m ${BRL(kpis.av.saldo)}`} color={kpis.cur.saldo >= 0 ? "text-green" : "text-red"} />
          <Kpi title="Transf. / Pagtos" value={BRL(kpis.cur.tr)} sub="não é consumo (líquido)" color="text-violet" />
        </div>
      )}

      <Panel title="Evolução mensal" sub="(receitas, despesas e saldo — clique nas barras p/ detalhar)">
        <div className="h-[clamp(280px,42vh,420px)]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
              <CartesianGrid stroke={cc.grid} vertical={false} />
              <XAxis dataKey="mes" tick={cc.tick} axisLine={false} tickLine={false} />
              <YAxis tick={cc.tick} tickFormatter={(v) => brlShort(v)} width={64} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTip />} cursor={cc.cursor} />
              <Legend wrapperStyle={{ fontSize: 11.5 }} iconType="circle" iconSize={7} />
              <Bar dataKey="Receitas" fill={cc.receita} radius={[5, 5, 0, 0]} cursor="pointer"
                onClick={(d: any) => { const m = d?.payload?._m ?? d?._m; if (m) openModal("Receitas · " + mesCurto(m), dados.filter((x) => x.competencia === m && ehReceita(x.classe))); }} />
              <Bar dataKey="Despesas" fill={cc.despesa} radius={[5, 5, 0, 0]} cursor="pointer"
                onClick={(d: any) => { const m = d?.payload?._m ?? d?._m; if (m) openModal("Despesas · " + mesCurto(m), dados.filter((x) => x.competencia === m && ehGasto(x.classe))); }} />
              <Line type="monotone" dataKey="Saldo" stroke={cc.saldo} strokeWidth={2} dot={{ r: 3.5 }} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[18px]">
        <Panel title="Gastos por cartão / conta" sub="(empilhado · clique p/ detalhar)">
          <StackedBars
            data={gastoPivot.data}
            keys={gastoPivot.keys}
            onSeg={(k, m) => openModal(k + " · " + mesCurto(m), dados.filter((d) => d.competencia === m && ehGasto(d.classe) && d.origem === k))}
          />
        </Panel>
        <Panel title="Receitas por banco" sub="(empilhado · clique p/ detalhar)">
          <StackedBars
            data={recPivot.data}
            keys={recPivot.keys}
            onSeg={(k, m) => openModal(k + " · " + mesCurto(m), dados.filter((d) => d.competencia === m && ehReceita(d.classe) && d.banco === k))}
          />
        </Panel>
      </div>

      <Panel title="Resumo por mês">
        <div className="overflow-x-auto scroll-thin mt-2">
          <table className="tbl">
            <thead><tr>
              <th>Mês</th>
              <th className="num">Receitas</th>
              <th className="num">Despesas</th>
              <th className="num">Saldo</th>
              <th className="num">Transf. / Pagtos</th>
            </tr></thead>
            <tbody>
              {aggs.map((a) => (
                <tr key={a.m}>
                  <td>{mesCurto(a.m)}</td>
                  <td className="num text-green">{BRL(a.rec)}</td>
                  <td className="num text-red">{BRL(a.gas)}</td>
                  <td className={`num ${a.saldo >= 0 ? "text-green" : "text-red"}`}>{BRL(a.saldo)}</td>
                  <td className="num">{BRL(a.tr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function StackedBars({ data, keys, onSeg }: { data: any[]; keys: string[]; onSeg?: (key: string, m: string) => void }) {
  const cc = useChart();
  return (
    <div className="h-[clamp(280px,42vh,420px)] mt-2">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
          <CartesianGrid stroke={cc.grid} vertical={false} />
          <XAxis dataKey="mes" tick={cc.tick} axisLine={false} tickLine={false} />
          <YAxis tick={cc.tick} tickFormatter={(v) => brlShort(v)} width={64} axisLine={false} tickLine={false} />
          <Tooltip content={<ChartTip />} cursor={cc.cursor} />
          <Legend wrapperStyle={{ fontSize: 11.5 }} iconType="circle" iconSize={7} />
          {keys.map((k) => (
            <Bar
              key={k}
              dataKey={k}
              stackId="s"
              fill={corChave(k)}
              radius={[3, 3, 0, 0]}
              cursor={onSeg ? "pointer" : undefined}
              onClick={(d: any) => { const m = d?.payload?._m ?? d?._m; if (m && onSeg) onSeg(k, m); }}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
