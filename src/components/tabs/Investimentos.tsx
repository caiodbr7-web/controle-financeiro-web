import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, PieChart, Pie, Cell,
} from "recharts";
import type { Investimento, InvestimentoHist } from "../../types";
import { Kpi, Panel, Select, BarRow } from "../ui";
import { useChart, ChartTip } from "../../lib/theme";
import { listInvestments, listInvestmentHistory, syncInvestments, setTipoManual } from "../../lib/pluggy";
import { BRL0, brlShort, fmtMoeda } from "../../lib/finance";
import { bancoCanonico } from "../../lib/bancos";

/* ============================================================================
   Aba "Investimentos" — patrimônio investido via Open Finance (Pluggy).

   Lê public.pluggy_investments (posição atual por ativo) e
   public.pluggy_investments_hist (retrato diário, p/ a evolução), populadas
   pela Edge Function `pluggy-investments`. O botão "Sincronizar" chama a função.

   Permite ao usuário CLASSIFICAR o tipo de cada ativo (coluna tipo_manual), que
   sobrepõe o tipo vindo da Pluggy para a sua visualização (KPIs/gráficos/tabela).
   ============================================================================ */

// rótulos amigáveis para os tipos (Pluggy + classes manuais extras)
const TIPO_LABEL: Record<string, string> = {
  FIXED_INCOME: "Renda Fixa",
  MUTUAL_FUND: "Fundos",
  SECURITY: "Títulos",
  EQUITY: "Ações",
  STOCK: "Ações",
  ETF: "ETF",
  ETF_US: "ETF - US",
  DEBENTURE: "Debêntures",
  COE: "COE",
  PENSION: "Previdência",
  REAL_ESTATE: "Imobiliário",
  CRYPTO: "Cripto",
  OUTROS: "Outros",
};
const labelTipo = (t?: string | null) => (t ? TIPO_LABEL[t] ?? t : "Outros");

// tipo "efetivo": a classificação manual vence a da Pluggy
const tipoEf = (i: Investimento) => i.tipo_manual ?? i.tipo ?? "";

// instituição "limpa": "NU FINANCEIRA S.A. - ..." -> "Nubank"; "BANCO AGIBANK S.A" -> "Banco Agibank".
function limpaInstituicao(s: string): string {
  if (/pluggy/i.test(s)) return s;               // conexão genérica: deixa como está
  const canon = bancoCanonico(s);
  if (canon) return canon;
  let t = s.split(/\s+-\s+|,/)[0];               // corta o que vem após " - " ou ","
  t = t.replace(/\bS[./]?A\.?\b.*$/i, "").replace(/\bLTDA\.?\b.*$/i, "").trim();
  return t ? t.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : s;
}
// instituição efetiva do ativo: o emissor (banco real) ou, sem ele, a conexão
const instDe = (i: Investimento) => {
  const base = i.emissor || i.banco || "";
  return base ? limpaInstituicao(base) : "—";
};

// opções do seletor de classificação manual (value = chave canônica)
const CLASSE_OPTS = [
  { v: "FIXED_INCOME", label: "Renda Fixa" },
  { v: "MUTUAL_FUND", label: "Fundos" },
  { v: "EQUITY", label: "Ações" },
  { v: "ETF", label: "ETF" },
  { v: "ETF_US", label: "ETF - US" },
  { v: "DEBENTURE", label: "Debêntures" },
  { v: "COE", label: "COE" },
  { v: "PENSION", label: "Previdência" },
  { v: "REAL_ESTATE", label: "Imobiliário" },
  { v: "CRYPTO", label: "Cripto" },
  { v: "OUTROS", label: "Outros" },
];

// paleta categórica (uma cor por tipo) — legível nos dois temas
const PALETA = ["#820ad1", "#34c98a", "#f2b84b", "#f06a6a", "#3b82f6", "#ec4899", "#14b8a6", "#a855f7"];

const cell = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
const fmtVenc = (s?: string | null) => {
  if (!s) return "—";
  const [y, m, d] = s.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : s;
};
// "YYYY-MM-DD" -> "dd/mm/aa"
const fmtDiaBR = (d: string) => {
  const [y, m, dd] = d.split("-");
  return `${dd}/${m}/${y.slice(2)}`;
};
const moedaDe = (i: Investimento) => i.moeda || "BRL";

interface ColDef {
  key: keyof Investimento;
  label: string;
  num?: boolean;
  mono?: boolean;
  sortable?: boolean;
  render?: (i: Investimento) => ReactNode;
}

function toCsv(rows: Investimento[], cols: ColDef[]): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = cols.map((c) => c.label).join(";");
  const body = rows.map((i) => cols.map((c) => esc(c.key === "tipo_manual" ? labelTipo(tipoEf(i)) : i[c.key])).join(";"));
  return [head, ...body].join("\n");
}

const MAX = 2000;

export function Investimentos() {
  const cc = useChart();
  const [rows, setRows] = useState<Investimento[]>([]);
  const [hist, setHist] = useState<InvestimentoHist[]>([]);
  const [status, setStatus] = useState("carregando…");
  const [erro, setErro] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const [busca, setBusca] = useState("");
  const [fTipo, setFTipo] = useState("");
  const [fBanco, setFBanco] = useState("");
  const [sortCol, setSortCol] = useState<keyof Investimento>("saldo");
  const [sortDir, setSortDir] = useState(-1);

  const carregar = useCallback(async () => {
    setStatus("carregando…");
    setErro("");
    try {
      const [inv, h] = await Promise.all([listInvestments(), listInvestmentHistory()]);
      setRows(inv);
      setHist(h);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setStatus("");
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const sincronizar = useCallback(async () => {
    setBusy(true);
    setMsg("Sincronizando investimentos…");
    try {
      const r = await syncInvestments();
      setMsg(`✓ ${r.investimentos} posição(ões) de ${r.itens} conexão(ões) sincronizadas.`);
      await carregar();
    } catch (e) {
      setMsg("Erro ao sincronizar: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [carregar]);

  // classifica um ativo (atualização otimista + persiste)
  const classificar = useCallback(async (id: string, valor: string) => {
    const novo = valor || null;
    setRows((rs) => rs.map((i) => (i.investment_id === id ? { ...i, tipo_manual: novo } : i)));
    try {
      await setTipoManual(id, novo);
    } catch (e) {
      setMsg("Erro ao classificar: " + (e as Error).message);
      carregar(); // reverte para o estado real do banco
    }
  }, [carregar]);

  const tipos = useMemo(() => [...new Set(rows.map(tipoEf).filter(Boolean))].sort(), [rows]);
  const instituicoes = useMemo(
    () => [...new Set(rows.map(instDe).filter((x) => x && x !== "—"))].sort(),
    [rows]
  );

  const filtrados = useMemo(() => {
    const q = busca.toLowerCase().trim();
    const r = rows.filter((i) =>
      (!fTipo || tipoEf(i) === fTipo) &&
      (!fBanco || instDe(i) === fBanco) &&
      (!q ||
        String(i.nome || "").toLowerCase().includes(q) ||
        String(i.emissor || "").toLowerCase().includes(q) ||
        String(i.banco || "").toLowerCase().includes(q) ||
        String(i.subtipo || "").toLowerCase().includes(q)));
    return r.sort((a, b) => {
      const va = a[sortCol], vb = b[sortCol];
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * sortDir;
      return String(va ?? "").localeCompare(String(vb ?? "")) * sortDir;
    });
  }, [rows, busca, fTipo, fBanco, sortCol, sortDir]);

  const kpis = useMemo(() => {
    let atual = 0, aplicado = 0, lucro = 0;
    for (const i of filtrados) {
      atual += i.saldo ?? 0;
      aplicado += i.valor_aplicado ?? 0;
      lucro += i.lucro ?? 0;
    }
    const nInst = new Set(filtrados.map(instDe).filter((x) => x !== "—")).size;
    const pct = aplicado !== 0 ? (lucro / Math.abs(aplicado)) * 100 : 0;
    return { atual, aplicado, lucro, pct, instituicoes: nInst };
  }, [filtrados]);

  // composição por tipo efetivo (sobre os filtrados), com cor estável
  const porTipo = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of filtrados) {
      const k = tipoEf(i) || "OUTROS";
      m.set(k, (m.get(k) ?? 0) + (i.saldo ?? 0));
    }
    const arr = [...m.entries()]
      .map(([tipo, total]) => ({ tipo, label: labelTipo(tipo), total }))
      .sort((a, b) => b.total - a.total)
      .map((x, i) => ({ ...x, cor: PALETA[i % PALETA.length] }));
    return arr;
  }, [filtrados]);

  // série de evolução do patrimônio (histórico diário)
  const serie = useMemo(
    () => hist.map((h) => ({
      dia: h.dia,
      Patrimônio: Math.round((h.valor_total ?? 0) * 100) / 100,
      Aplicado: Math.round((h.valor_aplicado ?? 0) * 100) / 100,
    })),
    [hist]
  );

  function baixarCsv(cols: ColDef[]) {
    const blob = new Blob(["﻿" + toCsv(filtrados, cols)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "investimentos.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const COLS: ColDef[] = [
    { key: "nome", label: "Investimento", sortable: true, render: (i) => <span title={i.nome ?? ""}>{cell(i.nome)}</span> },
    { key: "tipo", label: "Tipo (Pluggy)", sortable: true, render: (i) => labelTipo(i.tipo) },
    {
      key: "tipo_manual", label: "Classe (sua)", render: (i) => (
        <select
          value={i.tipo_manual ?? ""}
          onChange={(e) => classificar(i.investment_id, e.target.value)}
          className="select-chev bg-card text-txt border border-line rounded-[8px] pl-2 pr-6 py-[5px] text-[12px] cursor-pointer outline-none focus:border-muted transition-colors max-w-[140px]"
          title="Sua classificação (sobrepõe o tipo da Pluggy)"
        >
          <option value="">(automático)</option>
          {CLASSE_OPTS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
        </select>
      ),
    },
    { key: "banco", label: "Instituição", sortable: true, render: (i) => instDe(i) },
    { key: "emissor", label: "Emissor (Pluggy)", render: (i) => cell(i.emissor) },
    { key: "valor_aplicado", label: "Aplicado", num: true, sortable: true, render: (i) => (i.valor_aplicado != null ? fmtMoeda(i.valor_aplicado, moedaDe(i)) : "—") },
    { key: "saldo", label: "Valor atual", num: true, sortable: true, render: (i) => (i.saldo != null ? fmtMoeda(i.saldo, moedaDe(i)) : "—") },
    { key: "lucro", label: "Lucro", num: true, sortable: true, render: (i) => (i.lucro != null ? <span className={i.lucro < 0 ? "text-red" : "text-green"}>{fmtMoeda(i.lucro, moedaDe(i))}</span> : "—") },
    { key: "taxa", label: "Taxa", render: (i) => cell(i.taxa) },
    { key: "vencimento", label: "Vencimento", sortable: true, render: (i) => fmtVenc(i.vencimento) },
    { key: "quantidade", label: "Qtd.", num: true, render: (i) => (i.quantidade != null ? i.quantidade.toLocaleString("pt-BR") : "—") },
  ];

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

  const limpar = () => { setBusca(""); setFTipo(""); setFBanco(""); };

  const btnSync = (
    <button
      onClick={sincronizar}
      disabled={busy}
      className="bg-accent text-white border-0 rounded-[10px] px-4 py-[9px] text-[13.5px] font-semibold cursor-pointer disabled:opacity-50 hover:opacity-90 transition-opacity"
    >
      {busy ? "Sincronizando…" : "Sincronizar investimentos"}
    </button>
  );

  if (status && rows.length === 0) {
    return (
      <div className="inline-flex items-center gap-2 text-muted text-[13px]">
        <span className="w-[10px] h-[10px] rounded-full border-2 border-muted/40 border-t-muted animate-spin" />
        Carregando investimentos…
      </div>
    );
  }

  // estado vazio: nenhuma posição ainda (ou tabela ainda não criada)
  if (!status && rows.length === 0) {
    return (
      <div className="bg-card border border-line rounded-[18px] p-6 sm:p-8 shadow-card text-center">
        <h2 className="text-[16px] font-semibold tracking-tight mb-2">Nenhum investimento ainda</h2>
        <p className="text-[13.5px] text-muted leading-relaxed max-w-[560px] mx-auto">
          Esta aba mostra o seu patrimônio investido (renda fixa, fundos, ações, ETFs,
          previdência…) puxado do Open Finance via Pluggy. Conecte um banco/corretora na
          aba <strong>Conectar</strong> e clique em <strong>Sincronizar investimentos</strong>.
        </p>
        {erro && <div className="text-[13px] text-red bg-fill rounded-[10px] px-3 py-2 mt-4 max-w-[560px] mx-auto">Erro: {erro}</div>}
        {msg && <div className="text-[13px] text-txt bg-fill rounded-[10px] px-3 py-2 mt-3 max-w-[560px] mx-auto">{msg}</div>}
        <div className="mt-4">{btnSync}</div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2 items-center mb-4">
        <input className="input min-w-[220px] flex-1" placeholder="Buscar (nome, emissor, instituição)…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <Select value={fTipo} onChange={setFTipo}>
          <option value="">Todos os tipos</option>
          {tipos.map((t) => <option key={t} value={t}>{labelTipo(t)}</option>)}
        </Select>
        <Select value={fBanco} onChange={setFBanco}>
          <option value="">Todas as instituições</option>
          {instituicoes.map((b) => <option key={b}>{b}</option>)}
        </Select>
        <button className="btn-ghost" onClick={limpar}>Limpar</button>
        <button className="bg-fill text-txt border border-line rounded-[10px] px-3 py-[8px] text-[13px] font-medium cursor-pointer hover:border-muted transition-colors" onClick={carregar}>
          Atualizar
        </button>
        <button className="bg-fill text-txt border border-line rounded-[10px] px-3 py-[8px] text-[13px] font-medium cursor-pointer hover:border-muted transition-colors disabled:opacity-50" onClick={() => baixarCsv(COLS)} disabled={!filtrados.length}>
          Exportar CSV
        </button>
        {btnSync}
      </div>

      {erro && <div className="text-[13px] text-red bg-fill rounded-[10px] px-3 py-2 mb-3">Erro: {erro}</div>}
      {msg && <div className="text-[13px] text-txt bg-fill rounded-[10px] px-3 py-2 mb-3">{msg}</div>}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-[14px] mb-[18px]">
        <Kpi title="Valor investido hoje" value={BRL0(kpis.atual)} sub="soma das posições" color="text-violet" />
        <Kpi title="Total aplicado" value={BRL0(kpis.aplicado)} sub="montante aportado" />
        <Kpi
          title="Lucro acumulado"
          value={<span className={kpis.lucro < 0 ? "text-red" : "text-green"}>{BRL0(kpis.lucro)}</span>}
          sub={`${kpis.pct >= 0 ? "+" : ""}${kpis.pct.toFixed(1)}% sobre o aplicado`}
        />
        <Kpi title="Posições" value={filtrados.length.toLocaleString("pt-BR")} sub={`${rows.length.toLocaleString("pt-BR")} no total`} />
        <Kpi title="Instituições" value={kpis.instituicoes} sub="via Open Finance" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[14px]">
        <Panel title="Evolução do patrimônio" sub="(valor atual × aplicado, por dia)">
          {serie.length >= 2 ? (
            <div className="h-[260px] md:h-[300px] min-w-0 mt-2">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={serie} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
                  <defs>
                    <linearGradient id="gradInvest" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={cc.roxoLinha("0.34")} stopOpacity={1} />
                      <stop offset="100%" stopColor={cc.roxoLinha("0.02")} stopOpacity={1} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={cc.grid} vertical={false} />
                  <XAxis dataKey="dia" tickFormatter={(d) => fmtDiaBR(String(d))} tick={cc.tickSm} minTickGap={28} axisLine={false} tickLine={false} />
                  <YAxis tick={cc.tickSm} tickFormatter={(v) => brlShort(v)} width={64} axisLine={false} tickLine={false} />
                  <Tooltip content={(p: any) => <ChartTip {...p} keepZeros label={p?.label ? fmtDiaBR(p.label) : p?.label} />} />
                  <Area type="monotone" dataKey="Patrimônio" stroke={cc.roxoLinha("1")} strokeWidth={2.2} fill="url(#gradInvest)" dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="Aplicado" stroke={cc.tick.fill} strokeWidth={1.6} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-[13px] text-muted leading-relaxed mt-1">
              O histórico começa a ser registrado a cada sincronização. Assim que houver
              pelo menos <strong>dois dias</strong> sincronizados, a evolução aparece aqui.
              {serie.length === 1 && " (1 ponto registrado até agora.)"}
            </p>
          )}
        </Panel>

        <Panel title="Composição por tipo" sub="(valor atual)">
          {porTipo.length > 0 ? (
            <div className="flex flex-col sm:flex-row items-center gap-3 mt-1">
              <div className="h-[220px] w-full sm:w-[220px] shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={porTipo} dataKey="total" nameKey="label" cx="50%" cy="50%" innerRadius={52} outerRadius={86} paddingAngle={1.5} stroke={cc.cardStroke} strokeWidth={2} isAnimationActive={false}>
                      {porTipo.map((t) => <Cell key={t.tipo} fill={t.cor} />)}
                    </Pie>
                    <Tooltip content={(p: any) => <ChartTip {...p} pctOf={kpis.atual} />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-col gap-2 w-full min-w-0">
                {porTipo.map((t) => (
                  <BarRow
                    key={t.tipo}
                    label={<span className="inline-flex items-center gap-2"><span className="w-[9px] h-[9px] rounded-full shrink-0" style={{ background: t.cor }} />{t.label}</span>}
                    value={t.total}
                    max={porTipo[0].total}
                    color={t.cor}
                    right={`${BRL0(t.total)} · ${kpis.atual > 0 ? ((t.total / kpis.atual) * 100).toFixed(0) : 0}%`}
                  />
                ))}
              </div>
            </div>
          ) : (
            <p className="text-[13px] text-muted mt-1">Sem posições para compor o gráfico.</p>
          )}
        </Panel>
      </div>

      <div className="bg-card border border-line rounded-[18px] shadow-card overflow-hidden">
        <div className="max-h-[620px] overflow-auto scroll-thin">
          <table className="tbl min-w-[1100px] text-[12.5px]">
            <thead><tr>{COLS.map(th)}</tr></thead>
            <tbody>
              {filtrados.slice(0, MAX).map((i) => (
                <tr key={i.investment_id}>
                  {COLS.map((c) => (
                    <td key={String(c.key)} className={`${c.num ? "num" : ""} ${c.mono ? "font-mono text-[11.5px]" : ""}`}>
                      {c.render ? c.render(i) : cell(i[c.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {filtrados.length > MAX && <div className="text-muted text-[12.5px] mt-2">Mostrando {MAX.toLocaleString("pt-BR")} de {filtrados.length.toLocaleString("pt-BR")} posições. Refine os filtros.</div>}
    </div>
  );
}
