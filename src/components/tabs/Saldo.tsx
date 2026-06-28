import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  ResponsiveContainer, LineChart, Line, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ComposedChart, Bar, Cell, ReferenceLine,
} from "recharts";
import type { Aba, Saldo as SaldoRow } from "../../types";
import { Kpi, Panel, Seg, Select } from "../ui";
import { useChart, ChartTip } from "../../lib/theme";
import { sb } from "../../lib/supabase";
import { BRL0, brlShort } from "../../lib/finance";

/* ============================================================================
   Aba "Saldo" — evolução dos saldos das contas bancárias (Open Finance).

   Lê a tabela public.pluggy_saldos (histórico DIÁRIO de saldo por conta,
   reconstruído a partir do saldo atual + transações — migration 0013). Consulta
   própria via `sb` (RLS exige login), igual à aba Open Banking.

   Duas sub-abas (controladas pela navegação do App via a prop `aba`):
   - saldo_evolucao: gráficos de evolução (total + por conta) e fim de mês.
   - saldo_dados:    tabela "crua" com todos os dados, filtros e export CSV.
   ============================================================================ */

const NOMES_MES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
// "YYYY-MM-DD" -> "dd/mm/aa"
const fmtDiaBR = (d: string) => {
  const [y, m, dd] = d.split("-");
  return `${dd}/${m}/${y.slice(2)}`;
};
// "YYYY-MM" -> "Mmm/aa"
const mesLabel = (ym: string) => {
  const [y, m] = ym.split("-");
  return `${NOMES_MES[(parseInt(m, 10) || 1) - 1]}/${y.slice(2)}`;
};
const fmtTs = (s?: string | null) => (s ? new Date(s).toLocaleString("pt-BR") : "—");

// paleta categórica (legível nos dois temas) — uma cor por conta
const PALETA = ["#820ad1", "#34c98a", "#f2b84b", "#f06a6a", "#3b82f6", "#ec4899", "#14b8a6", "#a855f7"];

interface ContaInfo {
  account_id: string;
  banco: string;
  label: string;       // único mesmo quando há várias contas do mesmo banco
  conta_nome: string;
  cor: string;
  saldoAtual: number;  // saldo do último dia disponível
  moeda: string;
}

/* ---------------------------------------------------------------- container */
export function Saldo({ aba }: { aba: Aba }) {
  const [rows, setRows] = useState<SaldoRow[]>([]);
  const [status, setStatus] = useState("carregando…");
  const [erro, setErro] = useState("");

  const carregar = useCallback(async () => {
    setStatus("carregando…");
    setErro("");
    const PAGINA = 1000;
    let todos: SaldoRow[] = [];
    let de = 0;
    while (true) {
      const { data, error } = await sb
        .from("pluggy_saldos")
        .select("account_id,item_id,banco,conta_nome,tipo,moeda,dia,saldo,saldo_atual_ref,ancora_ts")
        // (dia, account_id) é único na tabela -> ordem total e estável: paginação
        // por OFFSET não duplica nem pula linhas nas fronteiras de página.
        .order("dia", { ascending: true })
        .order("account_id", { ascending: true })
        .range(de, de + PAGINA - 1);
      if (error) { setErro(error.message); setStatus(""); return; }
      todos = todos.concat((data || []) as SaldoRow[]);
      if (!data || data.length < PAGINA) break;
      de += PAGINA;
    }
    setRows(todos);
    setStatus("");
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  // contas distintas, com rótulo único, cor fixa e saldo mais recente
  const contas = useMemo<ContaInfo[]>(() => {
    const byAcc = new Map<string, SaldoRow[]>();
    for (const r of rows) {
      const arr = byAcc.get(r.account_id);
      if (arr) arr.push(r); else byAcc.set(r.account_id, [r]);
    }
    // quantas contas por banco (p/ decidir se precisa desambiguar o rótulo)
    const bancoCount = new Map<string, number>();
    for (const [, rs] of byAcc) {
      const b = rs[0].banco ?? "Conta";
      bancoCount.set(b, (bancoCount.get(b) ?? 0) + 1);
    }
    // ordem estável por account_id -> cor e numeração determinísticas entre cargas
    const accIds = [...byAcc.keys()].sort();
    const seen = new Map<string, number>();
    const list: ContaInfo[] = [];
    accIds.forEach((acc, i) => {
      const rs = byAcc.get(acc)!;
      const banco = rs[0].banco ?? "Conta";
      let label = banco;
      if ((bancoCount.get(banco) ?? 0) > 1) {
        const n = (seen.get(banco) ?? 0) + 1;
        seen.set(banco, n);
        label = `${banco} ${n}`;
      }
      // saldo mais recente = linha de maior dia (independe da ordem do fetch)
      const ultimo = rs.reduce((a, b) => (b.dia >= a.dia ? b : a));
      list.push({
        account_id: acc,
        banco,
        label,
        conta_nome: rs[0].conta_nome ?? "",
        cor: PALETA[i % PALETA.length],
        saldoAtual: ultimo.saldo,
        moeda: rs[0].moeda ?? "BRL",
      });
    });
    return list.sort((a, b) => b.saldoAtual - a.saldoAtual);
  }, [rows]);

  if (status && rows.length === 0) {
    return (
      <div className="inline-flex items-center gap-2 text-muted text-[13px]">
        <span className="w-[10px] h-[10px] rounded-full border-2 border-muted/40 border-t-muted animate-spin" />
        Carregando saldos…
      </div>
    );
  }
  // erro só toma a tela inteira quando ainda não há nada carregado; com dados na
  // tela, o erro de um "Atualizar" vira faixa inline (não destrói tabela/gráficos).
  if (erro && rows.length === 0) {
    return <div className="text-[13px] text-red bg-fill rounded-[10px] px-3 py-2">Erro: {erro}</div>;
  }
  if (rows.length === 0) {
    return (
      <div className="bg-card border border-line rounded-[18px] p-6 sm:p-8 shadow-card text-center">
        <h2 className="text-[16px] font-semibold tracking-tight mb-2">Nenhum saldo ainda</h2>
        <p className="text-[13.5px] text-muted leading-relaxed max-w-[520px] mx-auto">
          Esta aba mostra a evolução do saldo das suas contas bancárias, reconstruída a
          partir do Open Finance. Vá na aba <strong>Conectar</strong>, conecte um banco
          (ou o Sandbox do Pluggy) e clique em <strong>Sincronizar</strong>. A base de
          saldos é montada automaticamente a cada sincronização.
        </p>
        <button
          onClick={carregar}
          className="mt-4 bg-fill text-txt border border-line rounded-[10px] px-4 py-[9px] text-[13.5px] font-medium cursor-pointer hover:border-muted transition-colors"
        >
          Atualizar
        </button>
      </div>
    );
  }

  return aba === "saldo_dados"
    ? <SaldoDados rows={rows} contas={contas} status={status} erro={erro} reload={carregar} />
    : <SaldoEvolucao rows={rows} contas={contas} status={status} erro={erro} reload={carregar} />;
}

/* ------------------------------------------------------------- sub: Evolução */
const PER_OPTS = [
  { v: "3", label: "3m" }, { v: "6", label: "6m" }, { v: "12", label: "12m" },
  { v: "24", label: "24m" }, { v: "all", label: "Tudo" },
];

function SaldoEvolucao({
  rows, contas, status, erro, reload,
}: { rows: SaldoRow[]; contas: ContaInfo[]; status: string; erro: string; reload: () => void }) {
  const cc = useChart();
  const [periodo, setPeriodo] = useState("12");
  const [modo, setModo] = useState<"total" | "conta">("total");

  const dias = useMemo(() => [...new Set(rows.map((r) => r.dia))].sort(), [rows]);
  const ancora = dias[dias.length - 1] ?? "";

  // dia -> { account_id: saldo }
  const porDia = useMemo(() => {
    const m = new Map<string, Record<string, number>>();
    for (const r of rows) {
      const o = m.get(r.dia);
      if (o) o[r.account_id] = r.saldo;
      else m.set(r.dia, { [r.account_id]: r.saldo });
    }
    return m;
  }, [rows]);

  // corte do período em ano-mês ("YYYY-MM") — aritmética pura, sem Date (evita o
  // overflow de dia do setUTCMonth quando a âncora cai em 29/30/31).
  const corteMes = useMemo(() => {
    if (periodo === "all" || !ancora) return (dias[0] ?? "").slice(0, 7);
    const [y, m] = ancora.split("-").map(Number);
    const total = y * 12 + (m - 1) - parseInt(periodo, 10);
    return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
  }, [periodo, ancora, dias]);

  const diasShow = useMemo(() => dias.filter((d) => d.slice(0, 7) >= corteMes), [dias, corteMes]);

  // série diária para o gráfico. No modo "conta", dia sem dado vira null (o
  // connectNulls liga os pontos em vez de despencar a 0); no Total, soma só o
  // que existe. Hoje a grade é contígua, então não há buracos — é defensivo.
  const chartData = useMemo(
    () =>
      diasShow.map((d) => {
        const dd = porDia.get(d) || {};
        const row: Record<string, number | string | null> = { dia: d };
        let total = 0;
        for (const c of contas) {
          const v = dd[c.account_id];
          if (v != null) total += v;
          if (modo === "conta") row[c.account_id] = v != null ? Math.round(v * 100) / 100 : null;
        }
        row.Total = Math.round(total * 100) / 100;
        return row;
      }),
    [diasShow, porDia, contas, modo]
  );

  const kpis = useMemo(() => {
    const totalAtual = contas.reduce((s, c) => s + c.saldoAtual, 0);
    const first = Number(chartData[0]?.Total ?? 0);
    const last = Number(chartData[chartData.length - 1]?.Total ?? 0);
    const delta = last - first;
    const pct = first !== 0 ? (delta / Math.abs(first)) * 100 : 0;
    return { totalAtual, delta, pct, inicio: diasShow[0] ?? "", maior: contas[0] };
  }, [contas, chartData, diasShow]);

  // saldo no fim de cada mês (último dia disponível do mês), por conta + total.
  // "último vence" comparando r.dia explicitamente (não depende da ordem do fetch).
  const mensal = useMemo(() => {
    const byMonth = new Map<string, Map<string, { dia: string; saldo: number }>>();
    for (const r of rows) {
      const mes = r.dia.slice(0, 7);
      let acc = byMonth.get(mes);
      if (!acc) { acc = new Map(); byMonth.set(mes, acc); }
      const prev = acc.get(r.account_id);
      if (!prev || r.dia >= prev.dia) acc.set(r.account_id, { dia: r.dia, saldo: r.saldo });
    }
    let meses = [...byMonth.keys()].sort();
    if (periodo !== "all") meses = meses.filter((m) => m >= corteMes);
    // mês corrente é parcial se o último dia disponível não for o último do mês civil
    const ultimoDia = ancora; // "YYYY-MM-DD"
    let mesParcial = "";
    if (ultimoDia) {
      const [uy, um, ud] = ultimoDia.split("-").map(Number);
      const ultDiaCivil = new Date(Date.UTC(uy, um, 0)).getUTCDate();
      if (ud !== ultDiaCivil) mesParcial = ultimoDia.slice(0, 7);
    }
    return meses.map((mes) => {
      const accMap = byMonth.get(mes)!;
      const parcial = mes === mesParcial;
      const row: Record<string, number | string | boolean> = {
        mes, label: mesLabel(mes) + (parcial ? "*" : ""), parcial,
      };
      let total = 0;
      for (const c of contas) {
        const v = accMap.get(c.account_id)?.saldo ?? 0;
        row[c.account_id] = Math.round(v * 100) / 100;
        total += v;
      }
      row.Total = Math.round(total * 100) / 100;
      return row;
    });
  }, [rows, contas, corteMes, periodo, ancora]);

  const temMesParcial = useMemo(() => mensal.some((r) => r.parcial), [mensal]);

  const temNegativo = useMemo(
    () => chartData.some((r) => Number(r.Total) < 0) || contas.some((c) => c.saldoAtual < 0),
    [chartData, contas]
  );

  const controls = (
    <div className="flex items-center gap-2 flex-wrap">
      <Seg size="sm" value={periodo} onChange={setPeriodo} options={PER_OPTS} />
      <Seg
        size="sm"
        value={modo}
        onChange={(v) => setModo(v as "total" | "conta")}
        options={[{ v: "total", label: "Total" }, { v: "conta", label: "Por conta" }]}
      />
      <button
        className="bg-fill text-txt border border-line rounded-[10px] px-3 py-[6px] text-[12.5px] font-medium cursor-pointer hover:border-muted transition-colors"
        onClick={reload}
      >
        Atualizar
      </button>
    </div>
  );

  return (
    <div>
      {erro && <div className="text-[13px] text-red bg-fill rounded-[10px] px-3 py-2 mb-3">Erro ao atualizar: {erro}</div>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-[14px] mb-[18px]">
        <Kpi
          title="Saldo total hoje"
          value={BRL0(kpis.totalAtual)}
          sub={`${contas.length} ${contas.length === 1 ? "conta" : "contas"} · ${ancora ? fmtDiaBR(ancora) : "—"}`}
          color={kpis.totalAtual < 0 ? "text-red" : ""}
        />
        <Kpi
          title="Variação no período"
          value={
            kpis.delta >= 0
              ? <span className="text-green">▲ {BRL0(kpis.delta)}</span>
              : <span className="text-red">▼ {BRL0(Math.abs(kpis.delta))}</span>
          }
          sub={`${kpis.pct >= 0 ? "+" : ""}${kpis.pct.toFixed(1)}% · desde ${kpis.inicio ? fmtDiaBR(kpis.inicio) : "—"}`}
        />
      </div>

      <Panel
        title="Evolução do saldo"
        sub={modo === "total" ? "(somado de todas as contas, dia a dia)" : "(por conta, dia a dia)"}
        right={controls}
      >
        <div className="h-[300px] md:h-[420px] min-w-0 mt-2">
          <ResponsiveContainer width="100%" height="100%">
            {modo === "total" ? (
              <AreaChart data={chartData} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
                <defs>
                  <linearGradient id="gradSaldo" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={cc.saldo} stopOpacity={0.34} />
                    <stop offset="100%" stopColor={cc.saldo} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={cc.grid} vertical={false} />
                <XAxis dataKey="dia" tickFormatter={(d) => mesLabel(String(d).slice(0, 7))} tick={cc.tickSm} minTickGap={28} axisLine={false} tickLine={false} />
                <YAxis tick={cc.tickSm} tickFormatter={(v) => brlShort(v)} width={64} axisLine={false} tickLine={false} />
                {temNegativo && <ReferenceLine y={0} stroke={cc.grid} />}
                <Tooltip content={(p: any) => <ChartTip {...p} keepZeros label={p?.label ? fmtDiaBR(p.label) : p?.label} />} />
                <Area type="monotone" dataKey="Total" name="Saldo total" stroke={cc.saldo} strokeWidth={2.2} fill="url(#gradSaldo)" dot={false} isAnimationActive={false} />
              </AreaChart>
            ) : (
              <LineChart data={chartData} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
                <CartesianGrid stroke={cc.grid} vertical={false} />
                <XAxis dataKey="dia" tickFormatter={(d) => mesLabel(String(d).slice(0, 7))} tick={cc.tickSm} minTickGap={28} axisLine={false} tickLine={false} />
                <YAxis tick={cc.tickSm} tickFormatter={(v) => brlShort(v)} width={64} axisLine={false} tickLine={false} />
                {temNegativo && <ReferenceLine y={0} stroke={cc.grid} />}
                <Tooltip content={(p: any) => <ChartTip {...p} keepZeros label={p?.label ? fmtDiaBR(p.label) : p?.label} />} />
                <Legend wrapperStyle={{ fontSize: 11.5 }} iconType="circle" iconSize={7} />
                {contas.map((c) => (
                  <Line key={c.account_id} type="monotone" dataKey={c.account_id} name={c.label} stroke={c.cor} strokeWidth={1.8} dot={false} connectNulls isAnimationActive={false} />
                ))}
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
        <div className="text-muted text-[12.5px] mt-3 leading-relaxed">
          Saldo de fim de dia reconstruído a partir do saldo atual + transações do Open Finance.
          Antes da 1ª transação conhecida de cada conta, o valor é um saldo de abertura inferido.
        </div>
      </Panel>

      <Panel title="Saldo no fim do mês" sub="(último dia disponível de cada mês)">
        <div className="h-[clamp(240px,34vh,340px)] mt-1">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={mensal} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
              <CartesianGrid stroke={cc.grid} vertical={false} />
              <XAxis dataKey="label" tick={cc.tick} axisLine={false} tickLine={false} />
              <YAxis tick={cc.tick} tickFormatter={(v) => brlShort(v)} width={64} axisLine={false} tickLine={false} />
              {temNegativo && <ReferenceLine y={0} stroke={cc.grid} />}
              <Tooltip content={<ChartTip keepZeros />} cursor={cc.cursor} />
              <Bar dataKey="Total" name="Saldo total" radius={[5, 5, 0, 0]} isAnimationActive={false}>
                {mensal.map((r) => (
                  <Cell key={String(r.mes)} fill={cc.saldo} fillOpacity={r.parcial ? 0.45 : 1} />
                ))}
              </Bar>
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="overflow-x-auto scroll-thin mt-3">
          <table className="tbl text-[12.5px]">
            <thead>
              <tr>
                <th>Mês</th>
                {contas.map((c) => <th key={c.account_id} className="num whitespace-nowrap">{c.label}</th>)}
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {[...mensal].reverse().map((r) => (
                <tr key={String(r.mes)}>
                  <td className="whitespace-nowrap">{r.label}</td>
                  {contas.map((c) => {
                    const v = Number(r[c.account_id] ?? 0);
                    return <td key={c.account_id} className={`num ${v < 0 ? "text-red" : ""}`}>{BRL0(v)}</td>;
                  })}
                  <td className={`num font-semibold ${Number(r.Total) < 0 ? "text-red" : ""}`}>{BRL0(Number(r.Total))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {temMesParcial && (
          <div className="text-muted text-[12px] mt-2">
            * mês ainda em curso — saldo até {ancora ? fmtDiaBR(ancora) : "—"} (barra esmaecida).
          </div>
        )}
      </Panel>

      {status && <div className="text-muted text-[12.5px]">{status}</div>}
    </div>
  );
}

/* ---------------------------------------------------------------- sub: Dados */
interface AugRow extends SaldoRow { conta: string }
interface ColDef {
  key: keyof AugRow;
  label: string;
  num?: boolean;
  mono?: boolean;
  sortable?: boolean;
  render?: (r: AugRow) => ReactNode;
}
const COLS: ColDef[] = [
  { key: "dia", label: "Dia", sortable: true, render: (r) => fmtDiaBR(r.dia) },
  { key: "banco", label: "Banco", sortable: true },
  { key: "conta", label: "Conta", sortable: true },
  { key: "saldo", label: "Saldo", num: true, sortable: true, render: (r) => <span className={r.saldo < 0 ? "text-red" : ""}>{BRL0(r.saldo)}</span> },
  { key: "saldo_atual_ref", label: "Saldo atual (ref)", num: true, sortable: true, render: (r) => (r.saldo_atual_ref != null ? BRL0(r.saldo_atual_ref) : "—") },
  { key: "ancora_ts", label: "Âncora", render: (r) => fmtTs(r.ancora_ts) },
  { key: "tipo", label: "Tipo" },
  { key: "moeda", label: "Moeda" },
  { key: "account_id", label: "account_id", mono: true },
];

function toCsv(rows: AugRow[]): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = COLS.map((c) => c.label).join(";");
  const body = rows.map((r) => COLS.map((c) => esc(r[c.key])).join(";"));
  return [head, ...body].join("\n");
}

const MAX = 3000;

function SaldoDados({
  rows, contas, status, erro, reload,
}: { rows: SaldoRow[]; contas: ContaInfo[]; status: string; erro: string; reload: () => void }) {
  const [busca, setBusca] = useState("");
  const [fBanco, setFBanco] = useState("");
  const [fConta, setFConta] = useState("");
  const [fMes, setFMes] = useState("");
  const [sortCol, setSortCol] = useState<keyof AugRow>("dia");
  const [sortDir, setSortDir] = useState(-1);

  const labelMap = useMemo(() => new Map(contas.map((c) => [c.account_id, c.label])), [contas]);
  const aug = useMemo<AugRow[]>(
    () => rows.map((r) => ({ ...r, conta: labelMap.get(r.account_id) ?? r.conta_nome ?? r.banco ?? "" })),
    [rows, labelMap]
  );

  const bancos = useMemo(() => [...new Set(aug.map((r) => r.banco).filter(Boolean))].sort() as string[], [aug]);
  const meses = useMemo(() => [...new Set(aug.map((r) => r.dia.slice(0, 7)))].sort().reverse(), [aug]);
  const contasOpts = useMemo(
    () => [...new Set(aug.filter((r) => !fBanco || r.banco === fBanco).map((r) => r.conta))].sort(),
    [aug, fBanco]
  );

  const filtrados = useMemo(() => {
    const q = busca.toLowerCase().trim();
    const r = aug.filter((d) =>
      (!fBanco || d.banco === fBanco) &&
      (!fConta || d.conta === fConta) &&
      (!fMes || d.dia.slice(0, 7) === fMes) &&
      (!q ||
        d.dia.includes(q) ||
        String(d.banco || "").toLowerCase().includes(q) ||
        String(d.conta || "").toLowerCase().includes(q) ||
        String(d.account_id || "").toLowerCase().includes(q))
    );
    return r.sort((a, b) => {
      const va = a[sortCol], vb = b[sortCol];
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * sortDir;
      return String(va ?? "").localeCompare(String(vb ?? "")) * sortDir;
    });
  }, [aug, busca, fBanco, fConta, fMes, sortCol, sortDir]);

  const kpis = useMemo(() => {
    const totalAtual = contas.reduce((s, c) => s + c.saldoAtual, 0);
    const dd = filtrados.map((r) => r.dia);
    const minD = dd.length ? dd.reduce((a, b) => (a < b ? a : b)) : "";
    const maxD = dd.length ? dd.reduce((a, b) => (a > b ? a : b)) : "";
    return { totalAtual, minD, maxD };
  }, [contas, filtrados]);

  function baixarCsv() {
    const blob = new Blob(["﻿" + toCsv(filtrados)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "saldos_diarios.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function th(c: ColDef) {
    const base = `sticky top-0 bg-card z-[1] whitespace-nowrap ${c.num ? "text-right" : ""}`;
    if (!c.sortable) return <th key={String(c.key)} className={base}>{c.label}</th>;
    return (
      <th
        key={String(c.key)}
        className={`${base} cursor-pointer select-none`}
        onClick={() => { if (sortCol === c.key) setSortDir((x) => x * -1); else { setSortCol(c.key); setSortDir(c.num ? -1 : 1); } }}
      >
        {c.label}{sortCol === c.key ? (sortDir > 0 ? " ▲" : " ▼") : ""}
      </th>
    );
  }

  const limpar = () => { setBusca(""); setFBanco(""); setFConta(""); setFMes(""); };

  return (
    <div>
      <div className="flex flex-wrap gap-2 items-center mb-4">
        <input className="input min-w-[200px] flex-1" placeholder="Buscar (data, banco, conta, account_id)…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <Select value={fBanco} onChange={(v) => { setFBanco(v); setFConta(""); }}>
          <option value="">Todos os bancos</option>
          {bancos.map((b) => <option key={b}>{b}</option>)}
        </Select>
        <Select value={fConta} onChange={setFConta}>
          <option value="">Todas as contas</option>
          {contasOpts.map((c) => <option key={c}>{c}</option>)}
        </Select>
        <Select value={fMes} onChange={setFMes}>
          <option value="">Todos os meses</option>
          {meses.map((m) => <option key={m} value={m}>{mesLabel(m)}</option>)}
        </Select>
        <button className="btn-ghost" onClick={limpar}>Limpar</button>
        <button className="bg-fill text-txt border border-line rounded-[10px] px-3 py-[8px] text-[13px] font-medium cursor-pointer hover:border-muted transition-colors" onClick={reload}>
          Atualizar
        </button>
        <button className="bg-fill text-txt border border-line rounded-[10px] px-3 py-[8px] text-[13px] font-medium cursor-pointer hover:border-muted transition-colors disabled:opacity-50" onClick={baixarCsv} disabled={!filtrados.length}>
          Exportar CSV
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-[14px] mb-[18px]">
        <Kpi title="Linhas" value={filtrados.length.toLocaleString("pt-BR")} sub={`${rows.length.toLocaleString("pt-BR")} no total`} />
        <Kpi title="Contas" value={contas.length} sub="bancárias" />
        <Kpi title="Saldo total hoje" value={BRL0(kpis.totalAtual)} color={kpis.totalAtual < 0 ? "text-red" : "text-green"} />
        <Kpi title="Janela" value={kpis.minD ? fmtDiaBR(kpis.minD) : "—"} sub={kpis.maxD ? `até ${fmtDiaBR(kpis.maxD)}` : ""} />
      </div>

      {erro && <div className="text-[13px] text-red bg-fill rounded-[10px] px-3 py-2 mb-3">Erro ao atualizar: {erro}</div>}
      {status && <div className="text-muted text-[12.5px] mb-3">{status}</div>}

      <div className="bg-card border border-line rounded-[18px] shadow-card overflow-hidden">
        <div className="max-h-[620px] overflow-auto scroll-thin">
          <table className="tbl min-w-[820px] text-[12.5px]">
            <thead><tr>{COLS.map(th)}</tr></thead>
            <tbody>
              {filtrados.slice(0, MAX).map((r) => (
                <tr key={`${r.account_id}_${r.dia}`}>
                  {COLS.map((c) => (
                    <td key={String(c.key)} className={`${c.num ? "num" : ""} ${c.mono ? "font-mono text-[11.5px]" : ""}`}>
                      {c.render ? c.render(r) : (r[c.key] ?? "—")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {filtrados.length > MAX && <div className="text-muted text-[12.5px] mt-2">Mostrando {MAX.toLocaleString("pt-BR")} de {filtrados.length.toLocaleString("pt-BR")} linhas. Refine os filtros.</div>}
    </div>
  );
}
