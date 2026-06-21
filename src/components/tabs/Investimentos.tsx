import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Investimento } from "../../types";
import { Kpi, Panel, Select, BarRow } from "../ui";
import { listInvestments, syncInvestments } from "../../lib/pluggy";
import { BRL, fmtMoeda } from "../../lib/finance";

/* ============================================================================
   Aba "Investimentos" — patrimônio investido via Open Finance (Pluggy).

   Lê a tabela public.pluggy_investments (uma linha por posição/ativo), populada
   pela Edge Function `pluggy-investments` (endpoint /investments da Pluggy).
   Consulta própria via lib/pluggy (RLS exige login), igual às abas Saldo e
   Open Banking. O botão "Sincronizar" chama a função e recarrega.
   ============================================================================ */

// rótulos amigáveis para os tipos da Pluggy
const TIPO_LABEL: Record<string, string> = {
  FIXED_INCOME: "Renda Fixa",
  MUTUAL_FUND: "Fundos",
  SECURITY: "Títulos",
  EQUITY: "Ações",
  STOCK: "Ações",
  ETF: "ETF",
  COE: "COE",
  PENSION: "Previdência",
  REAL_ESTATE: "Imobiliário",
};
const labelTipo = (t?: string | null) => (t ? TIPO_LABEL[t] ?? t : "Outros");

// paleta categórica (uma cor por tipo) — legível nos dois temas
const PALETA = ["#820ad1", "#34c98a", "#f2b84b", "#f06a6a", "#3b82f6", "#ec4899", "#14b8a6", "#a855f7"];

const cell = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
const fmtVenc = (s?: string | null) => {
  if (!s) return "—";
  const [y, m, d] = s.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : s;
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
const COLS: ColDef[] = [
  { key: "nome", label: "Investimento", sortable: true, render: (i) => <span title={i.nome ?? ""}>{cell(i.nome)}</span> },
  { key: "tipo", label: "Tipo", sortable: true, render: (i) => labelTipo(i.tipo) },
  { key: "banco", label: "Instituição", sortable: true },
  { key: "emissor", label: "Emissor", render: (i) => cell(i.emissor) },
  { key: "valor_aplicado", label: "Aplicado", num: true, sortable: true, render: (i) => (i.valor_aplicado != null ? fmtMoeda(i.valor_aplicado, moedaDe(i)) : "—") },
  { key: "saldo", label: "Valor atual", num: true, sortable: true, render: (i) => (i.saldo != null ? fmtMoeda(i.saldo, moedaDe(i)) : "—") },
  { key: "lucro", label: "Lucro", num: true, sortable: true, render: (i) => (i.lucro != null ? <span className={i.lucro < 0 ? "text-red" : "text-green"}>{fmtMoeda(i.lucro, moedaDe(i))}</span> : "—") },
  { key: "taxa", label: "Taxa", render: (i) => cell(i.taxa) },
  { key: "vencimento", label: "Vencimento", sortable: true, render: (i) => fmtVenc(i.vencimento) },
  { key: "quantidade", label: "Qtd.", num: true, render: (i) => (i.quantidade != null ? i.quantidade.toLocaleString("pt-BR") : "—") },
];

function toCsv(rows: Investimento[]): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = COLS.map((c) => c.label).join(";");
  const body = rows.map((i) => COLS.map((c) => esc(i[c.key])).join(";"));
  return [head, ...body].join("\n");
}

const MAX = 2000;

export function Investimentos() {
  const [rows, setRows] = useState<Investimento[]>([]);
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
      setRows(await listInvestments());
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

  const tipos = useMemo(() => [...new Set(rows.map((i) => i.tipo).filter(Boolean))].sort() as string[], [rows]);
  const bancos = useMemo(() => [...new Set(rows.map((i) => i.banco).filter(Boolean))].sort() as string[], [rows]);

  const filtrados = useMemo(() => {
    const q = busca.toLowerCase().trim();
    const r = rows.filter((i) =>
      (!fTipo || i.tipo === fTipo) &&
      (!fBanco || i.banco === fBanco) &&
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
    const instituicoes = new Set(filtrados.map((i) => i.banco).filter(Boolean)).size;
    const pct = aplicado !== 0 ? (lucro / Math.abs(aplicado)) * 100 : 0;
    return { atual, aplicado, lucro, pct, instituicoes };
  }, [filtrados]);

  // composição por tipo (sobre os filtrados), ordenada por valor
  const porTipo = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of filtrados) {
      const k = i.tipo ?? "";
      m.set(k, (m.get(k) ?? 0) + (i.saldo ?? 0));
    }
    const arr = [...m.entries()].map(([tipo, total]) => ({ tipo, total })).sort((a, b) => b.total - a.total);
    const max = arr.reduce((s, x) => Math.max(s, x.total), 0);
    return { arr, max };
  }, [filtrados]);

  function baixarCsv() {
    const blob = new Blob(["﻿" + toCsv(filtrados)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "investimentos.csv";
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
          {bancos.map((b) => <option key={b}>{b}</option>)}
        </Select>
        <button className="btn-ghost" onClick={limpar}>Limpar</button>
        <button className="bg-fill text-txt border border-line rounded-[10px] px-3 py-[8px] text-[13px] font-medium cursor-pointer hover:border-muted transition-colors" onClick={carregar}>
          Atualizar
        </button>
        <button className="bg-fill text-txt border border-line rounded-[10px] px-3 py-[8px] text-[13px] font-medium cursor-pointer hover:border-muted transition-colors disabled:opacity-50" onClick={baixarCsv} disabled={!filtrados.length}>
          Exportar CSV
        </button>
        {btnSync}
      </div>

      {erro && <div className="text-[13px] text-red bg-fill rounded-[10px] px-3 py-2 mb-3">Erro: {erro}</div>}
      {msg && <div className="text-[13px] text-txt bg-fill rounded-[10px] px-3 py-2 mb-3">{msg}</div>}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-[14px] mb-[18px]">
        <Kpi title="Valor investido hoje" value={BRL(kpis.atual)} sub="soma das posições" color="text-violet" />
        <Kpi title="Total aplicado" value={BRL(kpis.aplicado)} sub="montante aportado" />
        <Kpi
          title="Lucro acumulado"
          value={<span className={kpis.lucro < 0 ? "text-red" : "text-green"}>{BRL(kpis.lucro)}</span>}
          sub={`${kpis.pct >= 0 ? "+" : ""}${kpis.pct.toFixed(1)}% sobre o aplicado`}
        />
        <Kpi title="Posições" value={filtrados.length.toLocaleString("pt-BR")} sub={`${rows.length.toLocaleString("pt-BR")} no total`} />
        <Kpi title="Instituições" value={kpis.instituicoes} sub="via Open Finance" />
      </div>

      {porTipo.arr.length > 0 && (
        <Panel title="Composição por tipo" sub="(valor atual)">
          <div className="flex flex-col gap-3 mt-1">
            {porTipo.arr.map((t, i) => (
              <BarRow
                key={t.tipo || "outros"}
                label={labelTipo(t.tipo)}
                value={t.total}
                max={porTipo.max}
                color={PALETA[i % PALETA.length]}
                right={`${BRL(t.total)} · ${kpis.atual > 0 ? ((t.total / kpis.atual) * 100).toFixed(0) : 0}%`}
              />
            ))}
          </div>
        </Panel>
      )}

      <div className="bg-card border border-line rounded-[18px] shadow-card overflow-hidden">
        <div className="max-h-[620px] overflow-auto scroll-thin">
          <table className="tbl min-w-[1000px] text-[12.5px]">
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
