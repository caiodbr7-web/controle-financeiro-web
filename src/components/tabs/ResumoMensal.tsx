import { useState, useMemo, useEffect } from "react";
import { ResponsiveContainer, BarChart, Bar, PieChart, Pie, XAxis, YAxis, CartesianGrid, Tooltip, Cell, LabelList } from "recharts";
import type { Lancamento } from "../../types";
import { Panel, Kpi, Select, Toolbar } from "../ui";
import { useChart, ChartTip } from "../../lib/theme";
import {
  BRL, brlShort, ehGasto, ehReceita, ehTransfer, catKey, corChave, corCategoria,
  deltaTxt, dvLabel, dvParcialLimite, mesReal,
} from "../../lib/finance";

interface Props { dados: Lancamento[]; allDados: Lancamento[]; months: string[]; openModal: (t: string, r: Lancamento[]) => void; }

// rótulo de % dentro do segmento — só mostra se o pedaço for grande o bastante
function PctLabel(props: any) {
  const { x, y, width, height, value } = props;
  if (value == null || value < 7 || height < 13) return null;
  return <text x={x + width / 2} y={y + height / 2} fill="#fff" fontSize={10} fontWeight={600} textAnchor="middle" dominantBaseline="central">{Math.round(value)}%</text>;
}

/* Toda esta aba agrupa pelo MÊS REAL da compra/movimento (não pela competência da fatura). */
export function ResumoMensal({ dados, allDados, openModal }: Props) {
  const [mes, setMes] = useState("");
  const cc = useChart();

  // lançamentos decorados com o mês real (1 passada)
  const rows = useMemo(() => dados.map((d) => ({ d, mk: mesReal(d) })), [dados]);
  const mesesReais = useMemo(() => [...new Set(rows.map((r) => r.mk))].sort(), [rows]);
  const lim = useMemo(() => dvParcialLimite(allDados), [allDados]);

  const hoje = new Date();
  const mesAtualK = hoje.getFullYear() + "-" + String(hoje.getMonth() + 1).padStart(2, "0");

  // default: o mês anterior ao atual (o atual está sempre incompleto)
  useEffect(() => {
    if (!mesesReais.length) return;
    if (mes && mesesReais.includes(mes)) return;
    const antes = mesesReais.filter((k) => k < mesAtualK);
    setMes(antes.length ? antes[antes.length - 1] : mesesReais[mesesReais.length - 1]);
  }, [mesesReais]);

  const m = mes && mesesReais.includes(mes)
    ? mes
    : (mesesReais.filter((k) => k < mesAtualK).slice(-1)[0] || mesesReais[mesesReais.length - 1] || "");
  const idx = mesesReais.indexOf(m), prev = idx > 0 ? mesesReais[idx - 1] : null;
  const parcial = m >= lim;

  const agg = (k: string) => {
    let rec = 0, gas = 0, tr = 0;
    for (const r of rows) {
      if (r.mk !== k) continue;
      if (ehGasto(r.d.classe)) gas += Math.abs(r.d.valor);
      else if (ehReceita(r.d.classe)) rec += Math.abs(r.d.valor);
      else if (ehTransfer(r.d.classe)) tr += r.d.valor;
    }
    return { rec, gas, tr, saldo: rec - gas };
  };
  const a = useMemo(() => agg(m), [rows, m]);
  const pa = useMemo(() => (prev ? agg(prev) : null), [rows, prev]);

  const gRows = useMemo(() => rows.filter((r) => r.mk === m && ehGasto(r.d.classe)).map((r) => r.d), [rows, m]);
  const rRows = useMemo(() => rows.filter((r) => r.mk === m && ehReceita(r.d.classe)).map((r) => r.d), [rows, m]);

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

  // insights: maiores gastos + onde está acima da média dos 3 meses reais anteriores
  const insights = useMemo(() => {
    const prevMeses = mesesReais.slice(Math.max(0, idx - 3), idx);
    const catMes = (cat: string, k: string) => rows
      .filter((r) => r.mk === k && ehGasto(r.d.classe) && catKey(r.d) === cat)
      .reduce((s, r) => s + Math.abs(r.d.valor), 0);
    const oport = catData.map((c) => {
      const avg = prevMeses.length ? prevMeses.reduce((s, pm) => s + catMes(c.cat, pm), 0) / prevMeses.length : 0;
      return { cat: c.cat, atual: c.valor, avg, delta: c.valor - avg };
    }).filter((o) => o.delta > 30 && o.avg > 0).sort((x, y) => y.delta - x.delta);
    const economia = oport.reduce((s, o) => s + o.delta, 0);
    return { top: catData.slice(0, 4), oport: oport.slice(0, 3), economia, temPrev: prevMeses.length > 0 };
  }, [catData, rows, mesesReais, idx]);

  // composição empilhada: 6 meses reais terminando no mês selecionado (% e R$)
  const stack6 = useMemo(() => {
    const meses6 = mesesReais.filter((k) => k <= m).slice(-6);
    const catTot: Record<string, number> = {};
    const porMes = meses6.map((k) => {
      const cat: Record<string, number> = {};
      rows.forEach((r) => { if (r.mk !== k || !ehGasto(r.d.classe)) return; const ck = catKey(r.d); cat[ck] = (cat[ck] || 0) + Math.abs(r.d.valor); catTot[ck] = (catTot[ck] || 0) + Math.abs(r.d.valor); });
      return { k, cat, total: Object.values(cat).reduce((s, v) => s + v, 0) };
    });
    const cats = Object.keys(catTot).sort((a, b) => catTot[b] - catTot[a]);
    const dataPct = porMes.map(({ k, cat, total }) => { const row: any = { mes: dvLabel(k), _c: k }; cats.forEach((c) => { row[c] = total ? +(((cat[c] || 0) / total) * 100).toFixed(2) : 0; }); return row; });
    const dataVal = porMes.map(({ k, cat }) => { const row: any = { mes: dvLabel(k), _c: k }; cats.forEach((c) => { row[c] = cat[c] || 0; }); return row; });
    return { cats, dataPct, dataVal };
  }, [rows, mesesReais, m]);

  const segClick = (c: string, comp: string) =>
    openModal(c + " · " + dvLabel(comp), rows.filter((r) => r.mk === comp && ehGasto(r.d.classe) && catKey(r.d) === c).map((r) => r.d));

  if (!m) return <div className="text-muted">Sem dados.</div>;

  return (
    <div>
      <Toolbar
        right={
          <span className="text-muted text-[12px]">
            pela data da compra · {gRows.length + rRows.length} transações
            {parcial ? " · mês parcial (faturas por vir)" : prev ? ` · vs ${dvLabel(prev)}` : ""}
          </span>
        }
      >
        <Select value={m} onChange={setMes}>
          {mesesReais.map((x) => <option key={x} value={x}>{dvLabel(x)}{x >= lim ? " *" : ""}</option>)}
        </Select>
      </Toolbar>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-[14px] mb-[18px]">
        <Kpi title="Receitas" value={BRL(a.rec)} sub={deltaTxt(a.rec, pa?.rec)} color="text-green" />
        <Kpi title="Despesas" value={BRL(a.gas)} sub={deltaTxt(a.gas, pa?.gas)} color="text-red" />
        <Kpi title="Saldo" value={BRL(a.saldo)} sub={deltaTxt(a.saldo, pa?.saldo)} color={a.saldo >= 0 ? "text-green" : "text-red"} />
        <Kpi title="Transf. / Pagtos" value={BRL(a.tr)} sub={deltaTxt(a.tr, pa?.tr)} color="text-violet" />
      </div>

      {/* ---- topo: 3 colunas (barras · rosca · insights), tudo do mês selecionado ---- */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-[18px]">
        <Panel title="Despesas por categoria" sub={`(${dvLabel(m)} · clique p/ detalhar)`}>
          <div className="h-[clamp(280px,40vh,400px)] mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={catData} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 4 }}>
                <CartesianGrid stroke={cc.grid} horizontal={false} />
                <XAxis type="number" tick={cc.tick} tickFormatter={(v) => brlShort(v)} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="cat" tick={cc.tickStrong} width={92} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTip />} cursor={cc.cursor} />
                <Bar dataKey="valor" name="Gasto" radius={[0, 4, 4, 0]} cursor="pointer"
                  onClick={(d: any) => { const k = d?.payload?.cat ?? d?.cat; if (k) openModal(k + " · " + dvLabel(m), gRows.filter((x) => catKey(x) === k)); }}>
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
                  onClick={(d: any) => { const k = d?.payload?.cat ?? d?.cat; if (k) openModal(k + " · " + dvLabel(m), gRows.filter((x) => catKey(x) === k)); }}>
                  {catData.map((e) => <Cell key={e.cat} fill={corCategoria(e.cat)} stroke={cc.cardStroke} strokeWidth={1} />)}
                </Pie>
                <Tooltip content={<ChartTip pctOf={totalGasto} />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-2 text-[12px]">
            {catData.slice(0, 8).map((c) => (
              <div key={c.cat} className="flex items-center gap-[6px] min-w-0">
                <span className="w-[10px] h-[10px] rounded-full shrink-0" style={{ background: corCategoria(c.cat) }} />
                <span className="truncate text-muted">{c.cat}</span>
                <span className="ml-auto font-medium tabular-nums">{totalGasto ? ((c.valor / totalGasto) * 100).toFixed(0) : 0}%</span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Insights do mês" sub={`(${dvLabel(m)})`}>
          <div className="mt-2">
            <div className="text-[11px] uppercase tracking-[.05em] text-muted font-semibold mb-1">Maiores gastos</div>
            {insights.top.map((c) => (
              <div key={c.cat} className="flex items-center gap-2 py-[3px] text-[13.5px]">
                <span className="w-[10px] h-[10px] rounded-full shrink-0" style={{ background: corCategoria(c.cat) }} />
                <span>{c.cat}</span>
                <span className="ml-auto font-medium text-red tabular-nums">{BRL(c.valor)}</span>
                <span className="text-muted text-[11.5px] w-[42px] text-right tabular-nums">{totalGasto ? ((c.valor / totalGasto) * 100).toFixed(0) : 0}%</span>
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
                      <span className="ml-auto text-red font-medium tabular-nums">▲ {BRL(o.delta)}</span>
                    </div>
                    <div className="text-muted text-[11.5px] ml-[16px]">{BRL(o.atual)} vs média {BRL(o.avg)}</div>
                  </div>
                ))}
                <div className="mt-2 p-2 rounded-[10px] bg-green/10 text-green text-[12.5px]">
                  Voltando à média, sobrariam <b>{BRL(insights.economia)}</b> este mês.
                </div>
              </>
            )}
          </div>
        </Panel>
      </div>

      {/* ---- composição: 6 meses reais até o mês selecionado, 100% e em R$ ---- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[18px] mt-1">
        <Panel title="Composição mensal" sub="(% por categoria · 6 meses até o selecionado · clique p/ detalhar)">
          <div className="h-[clamp(260px,34vh,360px)] mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stack6.dataPct} margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
                <CartesianGrid stroke={cc.grid} vertical={false} />
                <XAxis dataKey="mes" tick={cc.tick} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => v + "%"} tick={cc.tickSm} width={44} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTip pct />} cursor={cc.cursor} />
                {stack6.cats.map((c) => (
                  <Bar key={c} dataKey={c} stackId="a" fill={corCategoria(c)} isAnimationActive={false} cursor="pointer"
                    onClick={(d: any) => { const comp = d?.payload?._c; if (comp) segClick(c, comp); }}>
                    <LabelList content={PctLabel} />
                  </Bar>
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Composição mensal" sub="(em R$ · 6 meses até o selecionado · clique p/ detalhar)">
          <div className="h-[clamp(260px,34vh,360px)] mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stack6.dataVal} margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
                <CartesianGrid stroke={cc.grid} vertical={false} />
                <XAxis dataKey="mes" tick={cc.tick} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v) => brlShort(v)} tick={cc.tickSm} width={56} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTip />} cursor={cc.cursor} />
                {stack6.cats.map((c) => (
                  <Bar key={c} dataKey={c} stackId="a" fill={corCategoria(c)} isAnimationActive={false} cursor="pointer"
                    onClick={(d: any) => { const comp = d?.payload?._c; if (comp) segClick(c, comp); }} />
                ))}
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
        <Panel title="Despesas por cartão / conta" sub={`(${dvLabel(m)})`}>
          <div className="h-[clamp(220px,30vh,320px)] mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={origData} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 4 }}>
                <CartesianGrid stroke={cc.grid} horizontal={false} />
                <XAxis type="number" tick={cc.tick} tickFormatter={(v) => brlShort(v)} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="origem" tick={cc.tickStrong} width={110} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTip />} cursor={cc.cursor} />
                <Bar dataKey="valor" name="Gasto" radius={[0, 4, 4, 0]} cursor="pointer"
                  onClick={(d: any) => { const k = d?.payload?.origem ?? d?.origem; if (k) openModal(k + " · " + dvLabel(m), gRows.filter((x) => x.origem === k)); }}>
                  {origData.map((e) => <Cell key={e.origem} fill={e.cor} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Receitas por categoria / origem" sub={`(${dvLabel(m)})`}>
          <div className="overflow-x-auto scroll-thin mt-2">
            <table className="tbl">
              <thead><tr>
                <th>Categoria / origem</th>
                <th className="num">Valor</th>
                <th className="num">%</th>
              </tr></thead>
              <tbody>
                {recData.rows.map((r) => (
                  <tr key={r.k}>
                    <td>{r.k}</td>
                    <td className="num text-green">{BRL(r.v)}</td>
                    <td className="num">{recData.tot ? ((r.v / recData.tot) * 100).toFixed(1) : 0}%</td>
                  </tr>
                ))}
                {!recData.rows.length && <tr><td className="text-muted" colSpan={3}>Sem receitas neste mês.</td></tr>}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
      <div className="text-muted text-[12px] mt-1">
        Tudo nesta aba é agrupado pela <b>data real da compra/movimento</b>, não pela competência da fatura. Meses marcados com * ainda podem receber compras das próximas faturas.
      </div>
    </div>
  );
}
