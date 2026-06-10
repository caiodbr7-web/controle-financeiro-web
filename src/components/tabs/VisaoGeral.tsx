import { useState, useMemo } from "react";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, BarChart, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import type { Lancamento } from "../../types";
import { Panel, Kpi } from "../ui";
import {
  BRL, brlShort, mesCurto, monthAgg, ehGasto, ehReceita, corChave, ordemChave,
} from "../../lib/finance";

interface Props { dados: Lancamento[]; months: string[]; openModal: (t: string, r: Lancamento[]) => void; }

export function VisaoGeral({ dados, months, openModal }: Props) {
  const [periodo, setPeriodo] = useState("12");

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
      <div className="flex flex-wrap gap-[10px] items-center mb-4">
        <label className="text-muted text-[13px]">Período:</label>
        <select value={periodo} onChange={(e) => setPeriodo(e.target.value)} className="bg-card border border-line rounded-[10px] px-3 py-[9px] text-[15px]">
          <option value="12">Últimos 12 meses</option><option value="6">Últimos 6 meses</option>
          <option value="24">Últimos 24 meses</option><option value="all">Todo o histórico</option>
        </select>
        {vm.length > 0 && <span className="text-muted text-[12.5px]">{mesCurto(vm[0])} — {mesCurto(vm[vm.length - 1])} ({vm.length} meses)</span>}
      </div>

      {kpis && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-[14px] mb-5">
          <Kpi title="Receitas" value={BRL(kpis.cur.rec)} sub={`${kpis.label} · média 3m ${BRL(kpis.av.rec)}`} color="text-green" />
          <Kpi title="Despesas" value={BRL(kpis.cur.gas)} sub={`${kpis.label} · média 3m ${BRL(kpis.av.gas)}`} color="text-red" />
          <Kpi title="Saldo" value={BRL(kpis.cur.saldo)} sub={`receitas − despesas · média 3m ${BRL(kpis.av.saldo)}`} color={kpis.cur.saldo >= 0 ? "text-green" : "text-red"} />
          <Kpi title="Transf./Pagtos" value={BRL(kpis.cur.tr)} sub="não é consumo (líquido)" color="text-violet" />
        </div>
      )}

      <Panel title="Evolução mensal" sub="(receitas, despesas e saldo — clique para detalhar)">
        <div className="h-[clamp(280px,42vh,420px)]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
              <CartesianGrid stroke="#e6e6eb" />
              <XAxis dataKey="mes" tick={{ fill: "#86868b", fontSize: 11 }} />
              <YAxis tick={{ fill: "#86868b", fontSize: 11 }} tickFormatter={(v) => brlShort(v)} width={64} />
              <Tooltip formatter={(v: any, n: any) => [BRL(Number(v)), n]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Receitas" fill="#34c98a" radius={[5, 5, 0, 0]} cursor="pointer"
                onClick={(d: any) => { const m = d?.payload?._m ?? d?._m; if (m) openModal("Receitas · " + mesCurto(m), dados.filter((x) => x.competencia === m && ehReceita(x.classe))); }} />
              <Bar dataKey="Despesas" fill="#f06a6a" radius={[5, 5, 0, 0]} cursor="pointer"
                onClick={(d: any) => { const m = d?.payload?._m ?? d?._m; if (m) openModal("Despesas · " + mesCurto(m), dados.filter((x) => x.competencia === m && ehGasto(x.classe))); }} />
              <Line type="monotone" dataKey="Saldo" stroke="#f2b84b" strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[18px]">
        <Panel title="Gastos por cartão / conta" sub="(empilhado)">
          <StackedBars data={gastoPivot.data} keys={gastoPivot.keys} />
        </Panel>
        <Panel title="Receitas por banco" sub="(empilhado)">
          <StackedBars data={recPivot.data} keys={recPivot.keys} />
        </Panel>
      </div>

      <Panel title="Resumo por mês">
        <div className="overflow-x-auto mt-2">
          <table className="w-full border-collapse text-[13.5px]">
            <thead><tr className="text-muted text-[11px] uppercase">
              <th className="text-left p-2 border-b border-line">Mês</th>
              <th className="text-right p-2 border-b border-line">Receitas</th>
              <th className="text-right p-2 border-b border-line">Despesas</th>
              <th className="text-right p-2 border-b border-line">Saldo</th>
              <th className="text-right p-2 border-b border-line">Transf./Pagtos</th>
            </tr></thead>
            <tbody>
              {aggs.map((a) => (
                <tr key={a.m}>
                  <td className="text-left p-2 border-b border-line">{mesCurto(a.m)}</td>
                  <td className="text-right p-2 border-b border-line text-green">{BRL(a.rec)}</td>
                  <td className="text-right p-2 border-b border-line text-red">{BRL(a.gas)}</td>
                  <td className={`text-right p-2 border-b border-line ${a.saldo >= 0 ? "text-green" : "text-red"}`}>{BRL(a.saldo)}</td>
                  <td className="text-right p-2 border-b border-line">{BRL(a.tr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function StackedBars({ data, keys }: { data: any[]; keys: string[] }) {
  return (
    <div className="h-[clamp(280px,42vh,420px)] mt-2">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
          <CartesianGrid stroke="#e6e6eb" />
          <XAxis dataKey="mes" tick={{ fill: "#86868b", fontSize: 11 }} />
          <YAxis tick={{ fill: "#86868b", fontSize: 11 }} tickFormatter={(v) => brlShort(v)} width={64} />
          <Tooltip formatter={(v: any, n: any) => [BRL(Number(v)), n]} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {keys.map((k) => <Bar key={k} dataKey={k} stackId="s" fill={corChave(k)} radius={[3, 3, 0, 0]} />)}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
