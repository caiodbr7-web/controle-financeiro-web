import { useState, useMemo, useEffect } from "react";
import { ResponsiveContainer, BarChart, Bar, PieChart, Pie, XAxis, YAxis, CartesianGrid, Tooltip, Cell, LabelList } from "recharts";
import type { Lancamento } from "../../types";
import { Panel, Kpi } from "../ui";
import { BRL, brlShort, mesCurto, monthAgg, ehGasto, ehReceita, catKey, corChave, corCategoria, deltaTxt } from "../../lib/finance";

interface Props { dados: Lancamento[]; months: string[]; openModal: (t: string, r: Lancamento[]) => void; }

// rótulo de % dentro do segmento — só mostra se o pedaço for grande o bastante
function PctLabel(props: any) {
  const { x, y, width, height, value } = props;
  if (value == null || value < 7 || height < 13) return null;
  return <text x={x + width / 2} y={y + height / 2} fill="#fff" fontSize={10} fontWeight={600} textAnchor="middle" dominantBaseline="central">{Math.round(value)}%</text>;
}

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
  const totalGasto = catData.reduce((s, c) => s + c.valor, 0);

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

  // insights: maiores gastos + onde está acima da média dos 3 meses anteriores
  const insights = useMemo(() => {
    const prevMeses = months.slice(Math.max(0, idx - 3), idx);
    const catMes = (cat: string, comp: string) => dados
      .filter((d) => d.competencia === comp && ehGasto(d.classe) && catKey(d) === cat)
      .reduce((s, d) => s + Math.abs(d.valor), 0);
    const oport = catData.map((c) => {
      const avg = prevMeses.length ? prevMeses.reduce((s, pm) => s + catMes(c.cat, pm), 0) / prevMeses.length : 0;
      return { cat: c.cat, atual: c.valor, avg, delta: c.valor - avg };
    }).filter((o) => o.delta > 30 && o.avg > 0).sort((x, y) => y.delta - x.delta);
    const economia = oport.reduce((s, o) => s + o.delta, 0);
    return { top: catData.slice(0, 4), oport: oport.slice(0, 3), economia, temPrev: prevMeses.length > 0 };
  }, [catData, dados, months, idx]);

  // composição empilhada dos últimos 6 meses (% e R$)
  const stack6 = useMemo(() => {
    const meses6 = months.slice(-6);
    const catTot: Record<string, number> = {};
    const porMes = meses6.map((c) => {
      const cat: Record<string, number> = {};
      dados.forEach((d) => { if (String(d.competencia) !== c || !ehGasto(d.classe)) return; const k = catKey(d); cat[k] = (cat[k] || 0) + Math.abs(d.valor); catTot[k] = (catTot[k] || 0) + Math.abs(d.valor); });
      return { c, cat, total: Object.values(cat).reduce((s, v) => s + v, 0) };
    });
    const cats = Object.keys(catTot).sort((a, b) => catTot[b] - catTot[a]);
    const dataPct = porMes.map(({ c, cat, total }) => { const row: any = { mes: mesCurto(c) }; cats.forEach((k) => { row[k] = total ? +(((cat[k] || 0) / total) * 100).toFixed(2) : 0; }); return row; });
    const dataVal = porMes.map(({ c, cat }) => { const row: any = { mes: mesCurto(c) }; cats.forEach((k) => { row[k] = cat[k] || 0; }); return row; });
    return { cats, dataPct, dataVal };
  }, [dados, months]);

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

      {/* ---- topo: 3 colunas (barras · rosca · insights), tudo do mês selecionado ---- */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-[18px]">
        <Panel title="Despesas por categoria" sub={`(${mesCurto(m)} · clique p/ detalhar)`}>
          <div className="h-[clamp(280px,40vh,400px)] mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={catData} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 4 }}>
                <CartesianGrid stroke="#e6e6eb" horizontal={false} />
                <XAxis type="number" tick={{ fill: "#86868b", fontSize: 11 }} tickFormatter={(v) => brlShort(v)} />
                <YAxis type="category" dataKey="cat" tick={{ fill: "#1d1d1f", fontSize: 11 }} width={92} />
                <Tooltip formatter={(v: any) => BRL(Number(v))} />
                <Bar dataKey="valor" radius={[0, 4, 4, 0]} cursor="pointer"
                  onClick={(d: any) => { const k = d?.payload?.cat ?? d?.cat; if (k) openModal(k + " · " + mesCurto(m), gRows.filter((x) => catKey(x) === k)); }}>
                  {catData.map((e) => <Cell key={e.cat} fill={corCategoria(e.cat)} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Distribuição" sub="(% por categoria)">
          <div className="h-[clamp(200px,28vh,260px)] mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={catData} dataKey="valor" nameKey="cat" innerRadius="58%" outerRadius="86%" paddingAngle={1}
                  onClick={(d: any) => { const k = d?.payload?.cat ?? d?.cat; if (k) openModal(k + " · " + mesCurto(m), gRows.filter((x) => catKey(x) === k)); }}>
                  {catData.map((e) => <Cell key={e.cat} fill={corCategoria(e.cat)} stroke="#fff" strokeWidth={1} />)}
                </Pie>
                <Tooltip formatter={(v: any, n: any) => [`${BRL(Number(v))} (${totalGasto ? ((Number(v) / totalGasto) * 100).toFixed(1) : 0}%)`, n]} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-2 text-[12px]">
            {catData.slice(0, 8).map((c) => (
              <div key={c.cat} className="flex items-center gap-[6px] min-w-0">
                <span className="w-[10px] h-[10px] rounded-full shrink-0" style={{ background: corCategoria(c.cat) }} />
                <span className="truncate text-muted">{c.cat}</span>
                <span className="ml-auto font-medium">{totalGasto ? ((c.valor / totalGasto) * 100).toFixed(0) : 0}%</span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Insights do mês" sub={`(${mesCurto(m)})`}>
          <div className="mt-2">
            <div className="text-[11px] uppercase tracking-[.05em] text-muted font-semibold mb-1">Maiores gastos</div>
            {insights.top.map((c) => (
              <div key={c.cat} className="flex items-center gap-2 py-[3px] text-[13.5px]">
                <span className="w-[10px] h-[10px] rounded-full shrink-0" style={{ background: corCategoria(c.cat) }} />
                <span>{c.cat}</span>
                <span className="ml-auto font-medium text-red">{BRL(c.valor)}</span>
                <span className="text-muted text-[11.5px] w-[42px] text-right">{totalGasto ? ((c.valor / totalGasto) * 100).toFixed(0) : 0}%</span>
              </div>
            ))}

            <div className="text-[11px] uppercase tracking-[.05em] text-muted font-semibold mt-4 mb-1">Onde economizar</div>
            {!insights.temPrev ? (
              <div className="text-muted text-[12.5px]">Sem meses anteriores para comparar.</div>
            ) : insights.oport.length === 0 ? (
              <div className="text-green text-[12.5px]">Tudo dentro ou abaixo da média dos últimos meses. 👏</div>
            ) : (
              <>
                {insights.oport.map((o) => (
                  <div key={o.cat} className="py-[3px] text-[13px]">
                    <div className="flex items-center gap-2">
                      <span className="w-[10px] h-[10px] rounded-full shrink-0" style={{ background: corCategoria(o.cat) }} />
                      <span>{o.cat}</span>
                      <span className="ml-auto text-red font-medium">▲ {BRL(o.delta)}</span>
                    </div>
                    <div className="text-muted text-[11.5px] ml-[16px]">{BRL(o.atual)} vs média {BRL(o.avg)}</div>
                  </div>
                ))}
                <div className="mt-2 p-2 rounded-[10px] bg-[#f0fdf4] text-green text-[12.5px]">
                  Voltando à média, sobrariam <b>{BRL(insights.economia)}</b> este mês.
                </div>
              </>
            )}
          </div>
        </Panel>
      </div>

      {/* ---- composição dos últimos 6 meses: 100% e em R$ ---- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[18px] mt-1">
        <Panel title="Composição mensal" sub="(% por categoria · últimos 6 meses)">
          <div className="h-[clamp(260px,34vh,360px)] mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stack6.dataPct} margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
                <CartesianGrid stroke="#e6e6eb" vertical={false} />
                <XAxis dataKey="mes" tick={{ fill: "#86868b", fontSize: 11 }} />
                <YAxis domain={[0, 100]} tickFormatter={(v) => v + "%"} tick={{ fill: "#86868b", fontSize: 10 }} width={38} />
                <Tooltip formatter={(v: any, n: any) => [Number(v).toFixed(1) + "%", n]} />
                {stack6.cats.map((c) => (
                  <Bar key={c} dataKey={c} stackId="a" fill={corCategoria(c)} isAnimationActive={false}>
                    <LabelList content={PctLabel} />
                  </Bar>
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Composição mensal" sub="(em R$ · últimos 6 meses)">
          <div className="h-[clamp(260px,34vh,360px)] mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stack6.dataVal} margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
                <CartesianGrid stroke="#e6e6eb" vertical={false} />
                <XAxis dataKey="mes" tick={{ fill: "#86868b", fontSize: 11 }} />
                <YAxis tickFormatter={(v) => brlShort(v)} tick={{ fill: "#86868b", fontSize: 10 }} width={56} />
                <Tooltip formatter={(v: any, n: any) => [BRL(Number(v)), n]} />
                {stack6.cats.map((c) => <Bar key={c} dataKey={c} stackId="a" fill={corCategoria(c)} isAnimationActive={false} />)}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mb-5 mt-2 text-[11.5px]">
        {stack6.cats.map((c) => (
          <span key={c} className="flex items-center gap-[5px] text-muted">
            <span className="w-[10px] h-[10px] rounded-full" style={{ background: corCategoria(c) }} />{c}
          </span>
        ))}
      </div>

      {/* ---- abaixo: cartão/conta + receitas ---- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[18px] mt-1">
        <Panel title="Despesas por cartão / conta" sub={`(${mesCurto(m)})`}>
          <div className="h-[clamp(220px,30vh,320px)] mt-2">
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

        <Panel title="Receitas por categoria / origem" sub={`(${mesCurto(m)})`}>
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
    </div>
  );
}
