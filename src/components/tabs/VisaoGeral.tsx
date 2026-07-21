import { useState, useMemo } from "react";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, BarChart, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import type { Lancamento } from "../../types";
import { Panel, Kpi, Seg, Select, Toolbar } from "../ui";
import { useChart, ChartTip } from "../../lib/theme";
import {
  BRL0, kBRL, brlShort, ehGasto, ehReceita, ehTransfer, corChave, ordemChave,
  dvLabel, dvParcialLimite, mesComp, valorGasto, valorReceita, valorAporte, valorReceitaInvest,
} from "../../lib/finance";

interface Props { dados: Lancamento[]; allDados: Lancamento[]; months: string[]; openModal: (t: string, r: Lancamento[]) => void; }

const PERIODOS = [
  { v: "6", label: "6m" }, { v: "12", label: "12m" }, { v: "24", label: "24m" }, { v: "all", label: "Tudo" },
];

// célula de valor clicável (abre o pop-up de detalhamento do mês)
const CLICK = "cursor-pointer hover:bg-fill/60 transition-colors";

/* Toda esta aba agrupa pela COMPETÊNCIA (fatura/extrato do mês), eixo único do contrato.
   Gasto/receita já excluem transferência interna e aporte (ver lancClasses). */
export function VisaoGeral({ dados, allDados, openModal }: Props) {
  const [periodo, setPeriodo] = useState("12");
  const [mesSel, setMesSel] = useState("auto"); // "auto" = último mês completo do recorte
  const cc = useChart();

  const rows = useMemo(() => dados.map((d) => ({ d, mk: mesComp(d) })), [dados]);
  const lim = useMemo(() => dvParcialLimite(allDados), [allDados]);

  // meses de competência disponíveis, sem o mês civil atual (sempre incompleto)
  const mesesReais = useMemo(() => {
    const h = new Date();
    const atual = h.getFullYear() + "-" + String(h.getMonth() + 1).padStart(2, "0");
    return [...new Set(rows.map((r) => r.mk))].filter((k) => k < atual).sort();
  }, [rows]);

  const vm = useMemo(() => {
    if (!mesesReais.length) return [];
    if (periodo === "all") return mesesReais;
    return mesesReais.slice(-(parseInt(periodo, 10) || 12));
  }, [mesesReais, periodo]);

  const rotulo = (k: string) => dvLabel(k) + (k >= lim ? "*" : "");

  const agg = (k: string) => {
    let rec = 0, gas = 0, tr = 0, inv = 0, recInv = 0;
    for (const r of rows) {
      if (r.mk !== k) continue;
      gas += valorGasto(r.d);
      rec += valorReceita(r.d);
      inv += valorAporte(r.d);
      recInv += valorReceitaInvest(r.d);
      if (ehTransfer(r.d.classe)) tr += r.d.valor;
    }
    return { rec, gas, tr, saldo: rec - gas, inv, recInv };
  };
  const aggs = useMemo(() => vm.map((k) => ({ m: k, ...agg(k) })), [rows, vm]);

  // mês de referência dos KPIs: em "auto", o último mês completo (não-parcial) do
  // recorte; senão, o mês escolhido no seletor. A média 3m sempre termina nele.
  const autoIdx = useMemo(() => {
    if (!vm.length) return -1;
    for (let i = vm.length - 1; i >= 0; i--) if (vm[i] < lim) return i;
    return vm.length - 1;
  }, [vm, lim]);
  const refIdx = useMemo(() => {
    const sel = vm.indexOf(mesSel);
    return sel >= 0 ? sel : autoIdx; // mês escolhido fora do recorte cai no auto
  }, [vm, mesSel, autoIdx]);

  const kpis = useMemo(() => {
    if (refIdx < 0) return null;
    const ref = vm[refIdx];
    const cur = agg(ref);
    const last3 = vm.slice(Math.max(0, refIdx - 2), refIdx + 1); const n = last3.length || 1;
    const av = { rec: 0, gas: 0, saldo: 0 };
    last3.forEach((x) => { const aa = agg(x); av.rec += aa.rec; av.gas += aa.gas; av.saldo += aa.saldo; });
    const temInvest = aggs.some((a) => a.inv > 0 || a.recInv > 0);
    return { ref, label: dvLabel(ref), parcial: ref >= lim, cur, temInvest, av: { rec: av.rec / n, gas: av.gas / n, saldo: av.saldo / n } };
  }, [rows, vm, refIdx, lim, aggs]);

  // opções do seletor de mês dos KPIs (mais recente primeiro). "Automático" mostra
  // para qual mês completo caiu; o * marca meses ainda parciais, como no gráfico.
  const mesOpts = useMemo(() => {
    const auto = autoIdx >= 0 ? ` (${dvLabel(vm[autoIdx])})` : "";
    const opts = [{ v: "auto", label: `Automático${auto}` }];
    for (let i = vm.length - 1; i >= 0; i--) opts.push({ v: vm[i], label: rotulo(vm[i]) });
    return opts;
  }, [vm, autoIdx, lim]);
  const mesSelView = vm.includes(mesSel) ? mesSel : "auto";

  // empilhado por cartão/conta (gasto) e por banco (receita). O valor por segmento
  // usa o helper do contrato (valFn): respeita `interna` e desconta estorno no gasto,
  // para o total do empilhado bater com as barras de Despesas/Receitas.
  const pivot = (
    classFn: (c: string | null) => boolean,
    keyFn: (d: Lancamento) => string,
    valFn: (d: Lancamento) => number,
  ) => {
    const keys = [...new Set(rows.filter((r) => classFn(r.d.classe)).map((r) => keyFn(r.d)))]
      .sort((a, b) => ordemChave(a) - ordemChave(b) || String(a).localeCompare(String(b)));
    const data = vm.map((k) => {
      const row: any = { mes: rotulo(k), _m: k };
      keys.forEach((kk) => { row[kk] = rows.filter((r) => r.mk === k && keyFn(r.d) === kk).reduce((s, r) => s + valFn(r.d), 0); });
      return row;
    });
    return { keys, data };
  };
  const gastoPivot = useMemo(() => pivot(ehGasto, (d) => d.origem, valorGasto), [rows, vm, lim]);
  const recPivot = useMemo(() => pivot(ehReceita, (d) => d.banco, valorReceita), [rows, vm, lim]);

  const chartData = aggs.map((a) => ({ mes: rotulo(a.m), Receitas: a.rec, Despesas: a.gas, Saldo: a.saldo, _m: a.m }));

  const rowsDoMes = (k: string, classFn: (c: string | null) => boolean) =>
    rows.filter((r) => r.mk === k && classFn(r.d.classe)).map((r) => r.d);

  return (
    <div>
      <Toolbar
        right={vm.length > 0 && (
          <span className="text-muted text-[12px]">
            por competência · {dvLabel(vm[0])} — {dvLabel(vm[vm.length - 1])} · {vm.length} meses
          </span>
        )}
      >
        <Seg value={periodo} onChange={setPeriodo} options={PERIODOS} />
        {vm.length > 0 && (
          <label className="inline-flex items-center gap-2 text-[12.5px] text-muted">
            <span className="hidden sm:inline">Indicadores de</span>
            <Select value={mesSelView} onChange={setMesSel} className="py-[6px]">
              {mesOpts.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
            </Select>
          </label>
        )}
      </Toolbar>

      {kpis && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-[14px] mb-[18px]">
          <Kpi title="Receitas" value={kBRL(kpis.cur.rec)} sub={`${kpis.label} · média 3m ${BRL0(kpis.av.rec)}`} color="text-green"
            onClick={() => openModal(`Receitas · ${kpis.label}`, rowsDoMes(kpis.ref, ehReceita))} />
          <Kpi title="Despesas" value={kBRL(kpis.cur.gas)} sub={`${kpis.label} · média 3m ${BRL0(kpis.av.gas)}`} color="text-red"
            onClick={() => openModal(`Despesas · ${kpis.label}`, rowsDoMes(kpis.ref, ehGasto))} />
          <Kpi title="Saldo" value={kBRL(kpis.cur.saldo)} sub={`receitas − despesas · média 3m ${BRL0(kpis.av.saldo)}`} color={kpis.cur.saldo >= 0 ? "text-green" : "text-red"}
            onClick={() => openModal(`Receitas e despesas · ${kpis.label}`, rowsDoMes(kpis.ref, (c) => ehReceita(c) || ehGasto(c)))} />
          <Kpi title="Transf. / Pagtos" value={kBRL(kpis.cur.tr)} sub="não é consumo (líquido)" color="text-violet"
            onClick={() => openModal(`Transferências e pagamentos · ${kpis.label}`, rowsDoMes(kpis.ref, ehTransfer))} />
        </div>
      )}

      {kpis?.parcial && (
        <div className="text-muted text-[12px] -mt-[8px] mb-[18px]">
          <b>{kpis.label}*</b> é um mês <b>parcial</b> — ainda pode receber faturas/parcelas futuras, então os valores podem subir.
        </div>
      )}

      {/* investimentos do mês de referência — só aparece quando há aporte/renda classificados */}
      {kpis && kpis.temInvest && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-[14px] mb-[18px]">
          <Kpi title="Investido no mês" value={kBRL(kpis.cur.inv)} sub={`${kpis.label} · aportes (Σ Aporte)`} color="text-violet"
            onClick={() => openModal(`Aportes · ${kpis.label}`, rows.filter((r) => r.mk === kpis.ref && valorAporte(r.d) > 0).map((r) => r.d))} />
          <Kpi title="Renda de investimentos" value={kBRL(kpis.cur.recInv)} sub={`${kpis.label} · rendimentos/dividendos`} color="text-green"
            onClick={() => openModal(`Renda de investimentos · ${kpis.label}`, rows.filter((r) => r.mk === kpis.ref && valorReceitaInvest(r.d) > 0).map((r) => r.d))} />
        </div>
      )}

      <Panel title="Evolução mensal" sub="(por competência · clique nas barras p/ detalhar)">
        <div className="h-[clamp(280px,42vh,420px)]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
              <CartesianGrid stroke={cc.grid} vertical={false} />
              <XAxis dataKey="mes" tick={cc.tick} axisLine={false} tickLine={false} />
              <YAxis tick={cc.tick} tickFormatter={(v) => brlShort(v)} width={64} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTip />} cursor={cc.cursor} />
              <Legend wrapperStyle={{ fontSize: 11.5 }} iconType="circle" iconSize={7} />
              <Bar dataKey="Receitas" fill={cc.receita} radius={[5, 5, 0, 0]} cursor="pointer"
                onClick={(d: any) => { const k = d?.payload?._m ?? d?._m; if (k) openModal("Receitas · " + dvLabel(k), rowsDoMes(k, ehReceita)); }} />
              <Bar dataKey="Despesas" fill={cc.despesa} radius={[5, 5, 0, 0]} cursor="pointer"
                onClick={(d: any) => { const k = d?.payload?._m ?? d?._m; if (k) openModal("Despesas · " + dvLabel(k), rowsDoMes(k, ehGasto)); }} />
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
            onSeg={(k, m) => openModal(k + " · " + dvLabel(m), rows.filter((r) => r.mk === m && ehGasto(r.d.classe) && r.d.origem === k).map((r) => r.d))}
          />
        </Panel>
        <Panel title="Receitas por banco" sub="(empilhado · clique p/ detalhar)">
          <StackedBars
            data={recPivot.data}
            keys={recPivot.keys}
            onSeg={(k, m) => openModal(k + " · " + dvLabel(m), rows.filter((r) => r.mk === m && ehReceita(r.d.classe) && r.d.banco === k).map((r) => r.d))}
          />
        </Panel>
      </div>

      <Panel title="Resumo por mês" sub="(clique nos valores p/ detalhar)">
        <div className="overflow-x-auto scroll-thin mt-2">
          <table className="tbl">
            <thead><tr>
              <th>Mês</th>
              <th className="num">Receitas</th>
              <th className="num">Despesas</th>
              <th className="num">Saldo</th>
              <th className="num">Investido</th>
              <th className="num">Renda invest.</th>
              <th className="num">Transf. / Pagtos</th>
            </tr></thead>
            <tbody>
              {aggs.map((a) => (
                <tr key={a.m}>
                  <td>{rotulo(a.m)}</td>
                  <td className={`num text-green ${CLICK}`} title={`Ver as receitas de ${dvLabel(a.m)}`}
                    onClick={() => openModal(`Receitas · ${dvLabel(a.m)}`, rowsDoMes(a.m, ehReceita))}>{BRL0(a.rec)}</td>
                  <td className={`num text-red ${CLICK}`} title={`Ver as despesas de ${dvLabel(a.m)}`}
                    onClick={() => openModal(`Despesas · ${dvLabel(a.m)}`, rowsDoMes(a.m, ehGasto))}>{BRL0(a.gas)}</td>
                  <td className={`num ${a.saldo >= 0 ? "text-green" : "text-red"} ${CLICK}`} title={`Ver as receitas e despesas de ${dvLabel(a.m)}`}
                    onClick={() => openModal(`Receitas e despesas · ${dvLabel(a.m)}`, rowsDoMes(a.m, (c) => ehReceita(c) || ehGasto(c)))}>{BRL0(a.saldo)}</td>
                  <td className={`num text-violet ${a.inv ? CLICK : ""}`} title={a.inv ? `Ver os aportes de ${dvLabel(a.m)}` : undefined}
                    onClick={a.inv ? () => openModal(`Aportes · ${dvLabel(a.m)}`, rows.filter((r) => r.mk === a.m && valorAporte(r.d) > 0).map((r) => r.d)) : undefined}>{a.inv ? BRL0(a.inv) : "—"}</td>
                  <td className={`num text-green ${a.recInv ? CLICK : ""}`} title={a.recInv ? `Ver a renda de investimentos de ${dvLabel(a.m)}` : undefined}
                    onClick={a.recInv ? () => openModal(`Renda de investimentos · ${dvLabel(a.m)}`, rows.filter((r) => r.mk === a.m && valorReceitaInvest(r.d) > 0).map((r) => r.d)) : undefined}>{a.recInv ? BRL0(a.recInv) : "—"}</td>
                  <td className={`num ${CLICK}`} title={`Ver as transferências e pagamentos de ${dvLabel(a.m)}`}
                    onClick={() => openModal(`Transferências e pagamentos · ${dvLabel(a.m)}`, rowsDoMes(a.m, ehTransfer))}>{BRL0(a.tr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="text-muted text-[12px] mt-2">
          Agrupado pela <b>competência</b> (fatura/extrato do mês) — parcelas contam no mês em que caem. Receitas/Despesas excluem transferências internas e aportes; <b>Investido</b> = aportes (Σ Aporte) e <b>Renda invest.</b> = rendimentos/dividendos recebidos. Meses com * ainda podem receber faturas futuras; o mês atual fica de fora.
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
