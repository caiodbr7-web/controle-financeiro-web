import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Lancamento } from "../../types";
import { Kpi, Select } from "../ui";
import { sb } from "../../lib/supabase";
import { BRL, fmtMoeda, dicaMoedaOrigem, mesCurto, dataCompleta, dataOrdKey, ehGasto, ehReceita } from "../../lib/finance";

/* ============================================================================
   Aba "Open Banking" — superfície de VALIDAÇÃO do Pluggy.

   Diferente das outras abas (que consomem o hook useLancamentos, onde os dados
   de Open Banking ficam ocultos pela flag MOSTRAR_OPEN_BANKING), esta aba faz a
   PRÓPRIA consulta direta na tabela `lancamentos`, filtrando fonte_dados =
   'pluggy'. O objetivo é conferir, coluna a coluna, que estamos realmente
   puxando as informações do Open Finance.
   ============================================================================ */

// timestamptz ISO -> data/hora brasileira legível
const fmtTs = (s?: string | null) =>
  s ? new Date(s).toLocaleString("pt-BR") : "—";

// célula genérica: mostra "—" para nulo/vazio
const cell = (v: unknown) =>
  v === null || v === undefined || v === "" ? "—" : String(v);

// todas as colunas que o Open Banking preenche em `lancamentos`
interface ColDef {
  key: keyof Lancamento;
  label: string;
  render?: (d: Lancamento) => ReactNode;
  cls?: string;       // classe extra no <td>
  mono?: boolean;     // ids em fonte mono
  num?: boolean;      // alinhar à direita
  sortable?: boolean;
}

const COLS: ColDef[] = [
  { key: "id", label: "ID", num: true, sortable: true },
  { key: "competencia", label: "Competência", render: (d) => mesCurto(d.competencia), sortable: true },
  { key: "data_mov", label: "Data", sortable: true, render: (d) => dataCompleta(d) },
  { key: "ano", label: "Ano", num: true, sortable: true },
  { key: "mes", label: "Mês", num: true, sortable: true },
  { key: "banco", label: "Banco", sortable: true },
  { key: "origem", label: "Origem", sortable: true },
  { key: "descricao", label: "Descrição", cls: "max-w-[280px] truncate", render: (d) => <span title={d.descricao}>{cell(d.descricao)}</span>, sortable: true },
  { key: "detalhe", label: "Detalhe (operationType)", render: (d) => cell(d.detalhe) },
  { key: "classe", label: "Classe", sortable: true },
  { key: "categoria_auto", label: "Categoria (Pluggy)", render: (d) => cell(d.categoria_auto) },
  { key: "categoria_manual", label: "Categoria (manual)", render: (d) => cell(d.categoria_manual) },
  { key: "valor", label: "Valor", num: true, sortable: true, render: (d) => (
      <span className={d.valor < 0 ? "text-red" : ehReceita(d.classe) ? "text-green" : ""}>
        {fmtMoeda(d.valor, d.moeda)}
        {dicaMoedaOrigem(d) && <span className="text-muted ml-1">({dicaMoedaOrigem(d)})</span>}
      </span>
    ) },
  { key: "moeda", label: "Moeda", render: (d) => cell(d.moeda) },
  { key: "valor_origem", label: "Valor (origem)", num: true, render: (d) => d.valor_origem != null ? fmtMoeda(d.valor_origem, d.moeda_origem) : "—" },
  { key: "moeda_origem", label: "Moeda (origem)", render: (d) => cell(d.moeda_origem) },
  { key: "natureza", label: "Natureza", render: (d) => cell(d.natureza) },
  { key: "fonte_dados", label: "Fonte", render: (d) => cell(d.fonte_dados) },
  { key: "pluggy_tx_id", label: "Pluggy tx_id", mono: true, render: (d) => cell(d.pluggy_tx_id) },
  { key: "pluggy_account_id", label: "Pluggy account_id", mono: true, render: (d) => cell(d.pluggy_account_id) },
  { key: "pluggy_item_id", label: "Pluggy item_id", mono: true, render: (d) => cell(d.pluggy_item_id) },
  { key: "hash_natural", label: "hash_natural", mono: true, render: (d) => cell(d.hash_natural) },
  { key: "criado_em", label: "Criado em", render: (d) => fmtTs(d.criado_em) },
  { key: "atualizado_em", label: "Atualizado em", render: (d) => fmtTs(d.atualizado_em) },
];

function toCsv(rows: Lancamento[]): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = COLS.map((c) => c.label).join(";");
  const body = rows.map((d) => COLS.map((c) => esc(d[c.key])).join(";"));
  return [head, ...body].join("\n");
}

export function OpenBanking() {
  const [rows, setRows] = useState<Lancamento[]>([]);
  const [status, setStatus] = useState("carregando…");
  const [erro, setErro] = useState("");

  const [busca, setBusca] = useState("");
  const [fComp, setFComp] = useState("");
  const [fBanco, setFBanco] = useState("");
  const [fOrigem, setFOrigem] = useState("");
  const [fClasse, setFClasse] = useState("");
  const [sortCol, setSortCol] = useState<keyof Lancamento>("id");
  const [sortDir, setSortDir] = useState(-1);

  // consulta própria: SÓ Open Banking (fonte_dados = 'pluggy'), paginada
  const carregar = useCallback(async () => {
    setStatus("carregando…");
    setErro("");
    const PAGINA = 1000;
    let todos: Lancamento[] = [], de = 0;
    while (true) {
      const { data, error } = await sb
        .from("lancamentos")
        .select("*")
        .eq("fonte_dados", "pluggy")
        .order("id", { ascending: false })
        .range(de, de + PAGINA - 1);
      if (error) { setErro(error.message); setStatus(""); return; }
      todos = todos.concat((data || []) as Lancamento[]);
      if (!data || data.length < PAGINA) break;
      de += PAGINA;
    }
    setRows(todos);
    setStatus("");
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const meses = useMemo(() => [...new Set(rows.map((d) => d.competencia))].sort().reverse(), [rows]);
  const bancos = useMemo(() => [...new Set(rows.map((d) => d.banco))].sort(), [rows]);
  const origens = useMemo(() => [...new Set(rows.filter((d) => !fBanco || d.banco === fBanco).map((d) => d.origem))].sort(), [rows, fBanco]);
  const classes = useMemo(() => [...new Set(rows.map((d) => d.classe).filter(Boolean))].sort() as string[], [rows]);

  const filtrados = useMemo(() => {
    const q = busca.toLowerCase().trim();
    const r = rows.filter((d) =>
      (!fComp || d.competencia === fComp) &&
      (!fBanco || d.banco === fBanco) &&
      (!fOrigem || d.origem === fOrigem) &&
      (!fClasse || d.classe === fClasse) &&
      (!q ||
        String(d.descricao || "").toLowerCase().includes(q) ||
        String(d.detalhe || "").toLowerCase().includes(q) ||
        String(d.categoria_auto || "").toLowerCase().includes(q) ||
        String(d.pluggy_tx_id || "").toLowerCase().includes(q) ||
        String(d.pluggy_account_id || "").toLowerCase().includes(q) ||
        String(d.pluggy_item_id || "").toLowerCase().includes(q)));
    return r.sort((a, b) => {
      if (sortCol === "data_mov") return dataOrdKey(a).localeCompare(dataOrdKey(b)) * sortDir;
      const va = a[sortCol], vb = b[sortCol];
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * sortDir;
      return String(va ?? "").localeCompare(String(vb ?? "")) * sortDir;
    });
  }, [rows, busca, fComp, fBanco, fOrigem, fClasse, sortCol, sortDir]);

  const kpis = useMemo(() => {
    let gasto = 0, receita = 0;
    const contas = new Set<string>(), itens = new Set<string>();
    let ultima = "";
    for (const d of filtrados) {
      if (ehGasto(d.classe)) gasto += Math.abs(d.valor);
      else if (ehReceita(d.classe)) receita += Math.abs(d.valor);
      if (d.pluggy_account_id) contas.add(d.pluggy_account_id);
      if (d.pluggy_item_id) itens.add(d.pluggy_item_id);
      const t = d.atualizado_em || d.criado_em || "";
      if (t > ultima) ultima = t;
    }
    return { gasto, receita, saldo: receita - gasto, contas: contas.size, itens: itens.size, ultima };
  }, [filtrados]);

  function baixarCsv() {
    const blob = new Blob(["﻿" + toCsv(filtrados)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "open_banking.csv";
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

  const MAX = 2000;
  const limpar = () => { setBusca(""); setFComp(""); setFBanco(""); setFOrigem(""); setFClasse(""); };

  // estado vazio: ainda não há nada do Open Banking
  if (!status && !erro && rows.length === 0) {
    return (
      <div className="bg-card border border-line rounded-[18px] p-6 sm:p-8 shadow-card text-center">
        <h2 className="text-[16px] font-semibold tracking-tight mb-2">Nenhum lançamento do Open Banking ainda</h2>
        <p className="text-[13.5px] text-muted leading-relaxed max-w-[520px] mx-auto">
          Esta aba mostra, com todas as colunas, os lançamentos importados via Pluggy
          (Open Finance) para você validar que estamos puxando os dados corretamente.
          Vá na aba <strong>Conectar</strong>, conecte um banco (ou o Sandbox do Pluggy)
          e clique em <strong>Sincronizar</strong>. Depois volte aqui e clique em Atualizar.
        </p>
        <button onClick={carregar} className="mt-4 bg-fill text-txt border border-line rounded-[10px] px-4 py-[9px] text-[13.5px] font-medium cursor-pointer hover:border-muted transition-colors">
          Atualizar
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2 items-center mb-4">
        <input className="input min-w-[220px] flex-1" placeholder="Buscar (descrição, detalhe, categoria, ids Pluggy)…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <Select value={fComp} onChange={setFComp}>
          <option value="">Todos os meses</option>
          {meses.map((m) => <option key={m} value={m}>{mesCurto(m)}</option>)}
        </Select>
        <Select value={fBanco} onChange={(v) => { setFBanco(v); setFOrigem(""); }}>
          <option value="">Todos os bancos</option>
          {bancos.map((b) => <option key={b}>{b}</option>)}
        </Select>
        <Select value={fOrigem} onChange={setFOrigem}>
          <option value="">Todas as origens</option>
          {origens.map((o) => <option key={o}>{o}</option>)}
        </Select>
        <Select value={fClasse} onChange={setFClasse}>
          <option value="">Todas as classes</option>
          {classes.map((c) => <option key={c}>{c}</option>)}
        </Select>
        <button className="btn-ghost" onClick={limpar}>Limpar</button>
        <button className="bg-fill text-txt border border-line rounded-[10px] px-3 py-[8px] text-[13px] font-medium cursor-pointer hover:border-muted transition-colors" onClick={carregar}>
          Atualizar
        </button>
        <button className="bg-fill text-txt border border-line rounded-[10px] px-3 py-[8px] text-[13px] font-medium cursor-pointer hover:border-muted transition-colors disabled:opacity-50" onClick={baixarCsv} disabled={!filtrados.length}>
          Exportar CSV
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-[14px] mb-[18px]">
        <Kpi title="Lançamentos" value={filtrados.length.toLocaleString("pt-BR")} sub={`${rows.length.toLocaleString("pt-BR")} no total`} />
        <Kpi title="Gastos" value={BRL(kpis.gasto)} color="text-red" />
        <Kpi title="Receitas/Créditos" value={BRL(kpis.receita)} color="text-green" />
        <Kpi title="Saldo" value={BRL(kpis.saldo)} color={kpis.saldo < 0 ? "text-red" : "text-green"} />
        <Kpi title="Contas / Itens" value={`${kpis.contas} / ${kpis.itens}`} sub="distintos no Pluggy" />
        <Kpi title="Última importação" value={kpis.ultima ? new Date(kpis.ultima).toLocaleDateString("pt-BR") : "—"} sub={kpis.ultima ? new Date(kpis.ultima).toLocaleTimeString("pt-BR") : ""} />
      </div>

      {erro && <div className="text-[13px] text-red bg-fill rounded-[10px] px-3 py-2 mb-3">Erro: {erro}</div>}
      {status && <div className="text-muted text-[12.5px] mb-3">{status}</div>}

      <div className="bg-card border border-line rounded-[18px] shadow-card overflow-hidden">
        <div className="max-h-[620px] overflow-auto scroll-thin">
          <table className="tbl min-w-[1800px] text-[12.5px]">
            <thead><tr>{COLS.map(th)}</tr></thead>
            <tbody>
              {filtrados.slice(0, MAX).map((d) => (
                <tr key={d.id}>
                  {COLS.map((c) => (
                    <td key={String(c.key)} className={`${c.cls || ""} ${c.num ? "num" : ""} ${c.mono ? "font-mono text-[11.5px]" : ""}`}>
                      {c.render ? c.render(d) : cell(d[c.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {filtrados.length > MAX && <div className="text-muted text-[12.5px] mt-2">Mostrando {MAX} de {filtrados.length} lançamentos. Refine os filtros.</div>}
    </div>
  );
}
