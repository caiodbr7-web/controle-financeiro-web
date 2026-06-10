import { useState, useMemo, useEffect } from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from "recharts";
import type { Lancamento } from "../../types";
import { Panel, Kpi } from "../ui";
import { BRL, brlShort, mesCurto, monthAgg, ehGasto, ehReceita, catKey, corChave, deltaTxt } from "../../lib/finance";

interface Props { dados: Lancamento[]; months: string[]; openModal: (t: string, r: Lancamento[]) => void; }

export function ResumoMensal({ dados, months, openModal }: Props) {
  const [mes, setMes] = useState("");
  useEffect(() => { if (months.length && !months.includes(mes)) setMes(months[Math.max(0, months.length - 2)]); }, [months]);

  const m = mes || months[months.length - 1] || "";
  const idx = months.indexOf(m), prev = idx > 0 ? months[idx - 1] : null;
  const a = useMemo(() => monthAgg(dados, m), [dados, m]);
  const pa = useMemo(() => (prev ? monthAgg(dados, prev) : null), [dados, prev]);

  const gRows = useMemo(() => dados.filter((d) => d.competencia === m && ehGasto(d.classe)), [dados, m]);
  const rRows = useMemo(() => dados.filter((d) => d.competencia === m && ehReceita(d.classe)), [dados, m]);

  const catData = useMemo(() => {
    const cat: Record<string, number> = {};
    gRows.forEach((d) => { const k = catKey(d); cat[k] = (cat[k] || 0) + Math.abs(d.valor); });
    return Object.keys(cat).map((k) => ({ cat: k, valor: cat[k] })).sort((x, y) => y.valor - x.valor);
  }, [gRows]);

  const origData = useMemo(() => {
    const o: Record<string, number> = {};
    gRows.forEach((d) => { o[d.origem] = (o[d.origem] || 0) + Math.abs(d.valor); });
    return Object.keys(o).map((k) => ({ origem: k, valor: o[k], cor: corChave(k) })).sort((x, y) => y.valor - x.valor);
  }, [gRows]);

  const recData = useMemo(() => {
    const rc: Record<string, number> = {};
    rRows.forEach((d) => { const k = d.categoria_auto || d.detalhe || d.origem || "Receita"; rc[k] = (rc[k] || 0) + Math.abs(d.valor); });
    const tot = Object.values(rc).reduce((s, v) => s + v, 0);
    return { rows: Object.keys(rc).map((k) => ({ k, v: rc[k] })).sort((x, y) => y.v - x.v), tot };
  }, [rRows]);

  if (!m) return <div className="text-muted">Sem dados.</div>;

  return (
    <div>
      <div className="flex flex-wrap gap-[10px] items-center mb-4">
        <label className="text-muted text-[13px]">Mês:</label>
        <select value={m} onChange={(e) => setMes(e.target.value)} className="bg-card border border-line rounded-[10px] px-3 py-[9px] text-[15px]">
          {months.map((x) => <option key={x} value={x}>{mesCurto(x)}</option>)}
        </select>
        <span className="text-muted text-[12.5px]">{gRows.length + rRows.length} transações{prev ? ` · vs ${mesCurto(prev)}` : ""}</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-[14px] mb-5">
        <Kpi title="Receitas" value={BRL(a.rec)} sub={deltaTxt(a.rec, pa?.rec)} color="text-green" />
        <Kpi title="Despesas" value={BRL(a.gas)} sub={deltaTxt(a.gas, pa?.gas)} color="text-red" />
        <Kpi title="Saldo" value={BRL(a.saldo)} sub={deltaTxt(a.saldo, pa?.saldo)} color={a.saldo >= 0 ? "text-green" : "text-red"} />
        <Kpi title="Transf./Pagtos" value={BRL(a.tr)} sub={deltaTxt(a.tr, pa?.tr)} color="text-violet" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[18px]">
        <Panel title="Despesas por categoria" sub="(clique para detalhar)">
          <div className="h-[clamp(260px,36vh,360px)] mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={catData} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 4 }}>
                <CartesianGrid stroke="#e6e6eb" horizontal={false} />
                <XAxis type="number" tick={{ fill: "#86868b", fontSize: 11 }} tickFormatter={(v) => brlShort(v)} />
                <YAxis type="category" dataKey="cat" tick={{ fill: "#1d1d1f", fontSize: 11 }} width={96} />
                <Tooltip formatter={(v: any) => BRL(Number(v))} />
                <Bar dataKey="valor" fill="#820ad1" radius={[0, 4, 4, 0]} cursor="pointer"
                  onClick={(d: any) => { const k = d?.payload?.cat ?? d?.cat; if (k) openModal(k + " · " + mesCurto(m), gRows.filter((x) => catKey(x) === k)); }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Despesas por cartão / conta">
          <div className="h-[clamp(260px,36vh,360px)] mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={origData} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 4 }}>
                <CartesianGrid stroke="#e6e6eb" horizontal={false} />
                <XAxis type="number" tick={{ fill: "#86868b", fontSize: 11 }} tickFormatter={(v) => brlShort(v)} />
                <YAxis type="category" dataKey="origem" tick={{ fill: "#1d1d1f", fontSize: 11 }} width={110} />
                <Tooltip formatter={(v: any) => BRL(Number(v))} />
                <Bar dataKey="valor" radius={[0, 4, 4, 0]} cursor="pointer"
                  onClick={(d: any) => { const k = d?.payload?.origem ?? d?.origem; if (k) openModal(k + " · " + mesCurto(m), gRows.filter((x) => x.origem === k)); }}>
                  {origData.map((e) => <Cell key={e.origem} fill={e.cor} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <Panel title="Receitas por categoria / origem">
        <div className="overflow-x-auto mt-2">
          <table className="w-full border-collapse text-[13.5px]">
            <thead><tr className="text-muted text-[11px] uppercase">
              <th className="text-left p-2 border-b border-line">Categoria / origem</th>
              <th className="text-right p-2 border-b border-line">Valor</th>
              <th className="text-right p-2 border-b border-line">%</th>
            </tr></thead>
            <tbody>
              {recData.rows.map((r) => (
                <tr key={r.k}>
                  <td className="text-left p-2 border-b border-line">{r.k}</td>
                  <td className="text-right p-2 border-b border-line text-green">{BRL(r.v)}</td>
                  <td className="text-right p-2 border-b border-line">{recData.tot ? ((r.v / recData.tot) * 100).toFixed(1) : 0}%</td>
                </tr>
              ))}
              {!recData.rows.length && <tr><td className="p-2 text-muted">Sem receitas neste mês.</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
