import { useState, useMemo, useEffect } from "react";
import type { Lancamento } from "../../types";
import { Kpi, Select, Seg } from "../ui";
import { CategoryPicker } from "../CategoryPicker";
import { sb } from "../../lib/supabase";
import { BRL, fmtMoeda, dicaMoedaOrigem, mesCurto, catKey, ehGasto, ehReceita } from "../../lib/finance";
import { baixarCsv } from "../../lib/csv";
import { useToast } from "../Toast";
import { ArquivosPanel } from "./Arquivos";

interface Props { dados: Lancamento[]; allDados: Lancamento[]; months: string[]; reload: () => void; }

const PERIODOS = [
  { v: "all", label: "Tudo" }, { v: "12", label: "12m" }, { v: "6", label: "6m" }, { v: "3", label: "3m" },
];
const PAGINA = 200;

export function Lancamentos({ dados, allDados, months }: Props) {
  const { toast } = useToast();
  const [busca, setBusca] = useState("");
  const [periodo, setPeriodo] = useState("all");
  const [fComp, setFComp] = useState("");
  const [fBanco, setFBanco] = useState("");
  const [fOrigem, setFOrigem] = useState("");
  const [fClasse, setFClasse] = useState("");
  const [sortCol, setSortCol] = useState<keyof Lancamento>("competencia");
  const [sortDir, setSortDir] = useState(-1);
  const [salvos, setSalvos] = useState<Record<number, string>>({});
  const [visiveis, setVisiveis] = useState(PAGINA);

  const bancos = useMemo(() => [...new Set(dados.map((d) => d.banco))].sort(), [dados]);
  const origens = useMemo(() => [...new Set(dados.filter((d) => !fBanco || d.banco === fBanco).map((d) => d.origem))].sort(), [dados, fBanco]);
  const classes = useMemo(() => [...new Set(dados.map((d) => d.classe).filter(Boolean))].sort() as string[], [dados]);

  // janela de meses do filtro de período (sobre a competência)
  const periodoSet = useMemo(() => {
    if (periodo === "all") return null;
    const ms = [...new Set(dados.map((d) => d.competencia))].sort();
    return new Set(ms.slice(-(parseInt(periodo, 10) || 12)));
  }, [dados, periodo]);

  const rows = useMemo(() => {
    const q = busca.toLowerCase();
    const r = dados.filter((d) =>
      (!periodoSet || periodoSet.has(d.competencia)) &&
      (!fComp || d.competencia === fComp) && (!fBanco || d.banco === fBanco) &&
      (!fOrigem || d.origem === fOrigem) && (!fClasse || d.classe === fClasse) &&
      (!q || String(d.descricao || "").toLowerCase().includes(q) || String(d.detalhe || "").toLowerCase().includes(q)));
    return r.sort((a, b) => sortCol === "valor"
      ? (a.valor - b.valor) * sortDir
      : String(a[sortCol] || "").localeCompare(String(b[sortCol] || "")) * sortDir);
  }, [dados, busca, periodoSet, fComp, fBanco, fOrigem, fClasse, sortCol, sortDir]);

  // volta pro topo da paginação quando o filtro muda
  useEffect(() => { setVisiveis(PAGINA); }, [busca, periodoSet, fComp, fBanco, fOrigem, fClasse]);

  const totals = useMemo(() => {
    let gasto = 0, receita = 0;
    rows.forEach((d) => { if (ehGasto(d.classe)) gasto += Math.abs(d.valor); else if (ehReceita(d.classe)) receita += Math.abs(d.valor); });
    return { gasto, receita, saldo: receita - gasto };
  }, [rows]);

  async function salvarCat(d: Lancamento, valor: string) {
    setSalvos((s) => ({ ...s, [d.id]: "salvando…" }));
    const { error } = await sb.from("lancamentos").update({ categoria_manual: valor || null }).eq("id", d.id);
    if (error) { setSalvos((s) => ({ ...s, [d.id]: "" })); toast({ message: "Erro ao salvar categoria: " + error.message, variant: "error" }); return; }
    d.categoria_manual = valor || null;
    setSalvos((s) => ({ ...s, [d.id]: "✓" }));
    setTimeout(() => setSalvos((s) => { const n = { ...s }; delete n[d.id]; return n; }), 1200);
  }

  function exportar() {
    baixarCsv("lancamentos", rows, [
      { label: "Competência", value: (d) => mesCurto(d.competencia) },
      { label: "Banco", value: (d) => d.banco },
      { label: "Origem", value: (d) => d.origem },
      { label: "Data", value: (d) => d.data_mov },
      { label: "Descrição", value: (d) => d.descricao },
      { label: "Classe", value: (d) => d.classe },
      { label: "Categoria", value: (d) => catKey(d) },
      { label: "Valor", value: (d) => Number(d.valor).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
      { label: "Moeda", value: (d) => d.moeda || "BRL" },
    ]);
    toast({ message: `${rows.length.toLocaleString("pt-BR")} lançamentos exportados.`, variant: "success" });
  }

  function th(col: keyof Lancamento, label: string) {
    return (
      <th
        className="cursor-pointer select-none sticky top-0 bg-card z-[1]"
        onClick={() => { if (sortCol === col) setSortDir((x) => x * -1); else { setSortCol(col); setSortDir(col === "valor" ? -1 : 1); } }}
      >
        {label}{sortCol === col ? (sortDir > 0 ? " ▲" : " ▼") : ""}
      </th>
    );
  }

  const temFiltro = busca || periodo !== "all" || fComp || fBanco || fOrigem || fClasse;
  const limpar = () => { setBusca(""); setPeriodo("all"); setFComp(""); setFBanco(""); setFOrigem(""); setFClasse(""); };
  const mostrados = rows.slice(0, visiveis);

  // célula de categoria (compartilhada entre tabela e cartões)
  const catCell = (d: Lancamento) => (
    <span className="inline-flex items-center gap-2">
      <CategoryPicker value={d.categoria_manual || ""} onSelect={(v) => salvarCat(d, v)} />
      {salvos[d.id] && <span className="text-[12px] text-green">{salvos[d.id]}</span>}
    </span>
  );
  const valCell = (d: Lancamento) => (
    <>
      {fmtMoeda(d.valor, d.moeda)}
      {dicaMoedaOrigem(d) && <span className="text-muted text-[11px] ml-1">({dicaMoedaOrigem(d)})</span>}
    </>
  );

  return (
    <div>
      <ArquivosPanel allDados={allDados} />

      <div className="flex flex-wrap gap-2 items-center mb-4">
        <input className="input min-w-[180px] flex-1" placeholder="Buscar descrição…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <Seg size="sm" value={periodo} onChange={setPeriodo} options={PERIODOS} />
        <Select value={fComp} onChange={setFComp}>
          <option value="">Todos os meses</option>
          {months.map((m) => <option key={m} value={m}>{mesCurto(m)}</option>)}
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
        {temFiltro && <button className="btn-ghost" onClick={limpar}>Limpar</button>}
        <button className="btn-ghost ml-auto" onClick={exportar} disabled={!rows.length}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
          Exportar CSV
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-[14px] mb-[18px]">
        <Kpi title="Gastos" value={BRL(totals.gasto)} color="text-red" />
        <Kpi title="Receitas" value={BRL(totals.receita)} color="text-green" />
        <Kpi title="Saldo" value={BRL(totals.saldo)} color={totals.saldo < 0 ? "text-red" : "text-green"} />
        <Kpi title="Lançamentos" value={rows.length.toLocaleString("pt-BR")} />
      </div>

      {/* ----- desktop: tabela ----- */}
      <div className="hidden md:block bg-card border border-line rounded-[18px] shadow-card overflow-hidden">
        <div className="max-h-[560px] overflow-auto scroll-thin">
          <table className="tbl min-w-[820px]">
            <thead><tr>
              {th("competencia", "Mês")}{th("banco", "Banco")}{th("origem", "Origem")}{th("data_mov", "Data")}
              {th("descricao", "Descrição")}{th("classe", "Classe")}
              <th className="sticky top-0 bg-card z-[1]">Categoria</th>
              {th("valor", "Valor")}
            </tr></thead>
            <tbody>
              {mostrados.map((d) => (
                <tr key={d.id}>
                  <td>{mesCurto(d.competencia)}</td>
                  <td>{d.banco}</td>
                  <td>{d.origem}</td>
                  <td>{d.data_mov}</td>
                  <td className="max-w-[230px] truncate" title={d.descricao}>{d.descricao}</td>
                  <td>{d.classe}</td>
                  <td>{catCell(d)}</td>
                  <td className={`num ${d.valor < 0 ? "text-red" : ehReceita(d.classe) ? "text-green" : ""}`}>{valCell(d)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ----- mobile: cartões ----- */}
      <div className="md:hidden bg-card border border-line rounded-[18px] shadow-card divide-y divide-line overflow-hidden">
        {mostrados.map((d) => (
          <div key={d.id} className="p-[13px]">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[13.5px] font-medium truncate" title={d.descricao}>{d.descricao}</div>
                <div className="text-[11.5px] text-muted truncate">{mesCurto(d.competencia)} · {d.origem} · {d.data_mov}</div>
              </div>
              <div className="text-right shrink-0">
                <div className={`tabular-nums text-[13.5px] font-medium ${d.valor < 0 ? "text-red" : ehReceita(d.classe) ? "text-green" : ""}`}>{valCell(d)}</div>
                <div className="text-[11px] text-muted">{d.classe}</div>
              </div>
            </div>
            <div className="mt-[10px] flex items-center gap-2">
              {ehGasto(d.classe) && !d.categoria_manual && <span className="w-[7px] h-[7px] rounded-full bg-amber shrink-0" />}
              {catCell(d)}
            </div>
          </div>
        ))}
        {!mostrados.length && <div className="p-4 text-muted text-[13px]">Nenhum lançamento com esses filtros.</div>}
      </div>

      {rows.length > visiveis && (
        <div className="flex items-center gap-3 mt-3">
          <button onClick={() => setVisiveis((v) => v + PAGINA * 2)} className="btn-ghost">Carregar mais</button>
          <span className="text-muted text-[12.5px]">Mostrando {mostrados.length.toLocaleString("pt-BR")} de {rows.length.toLocaleString("pt-BR")}</span>
        </div>
      )}
    </div>
  );
}
