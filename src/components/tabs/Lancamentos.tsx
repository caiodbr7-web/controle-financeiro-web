import { useState, useMemo } from "react";
import type { Lancamento } from "../../types";
import { Kpi, Select } from "../ui";
import { sb } from "../../lib/supabase";
import { BRL, fmtMoeda, dicaMoedaOrigem, mesCurto, ehGasto, ehReceita, CATEGORIAS } from "../../lib/finance";
import { ArquivosPanel } from "./Arquivos";

interface Props { dados: Lancamento[]; allDados: Lancamento[]; months: string[]; reload: () => void; }

export function Lancamentos({ dados, allDados, months }: Props) {
  const [busca, setBusca] = useState("");
  const [fComp, setFComp] = useState("");
  const [fBanco, setFBanco] = useState("");
  const [fOrigem, setFOrigem] = useState("");
  const [fClasse, setFClasse] = useState("");
  const [sortCol, setSortCol] = useState<keyof Lancamento>("competencia");
  const [sortDir, setSortDir] = useState(-1);
  const [salvos, setSalvos] = useState<Record<number, string>>({});

  const bancos = useMemo(() => [...new Set(dados.map((d) => d.banco))].sort(), [dados]);
  const origens = useMemo(() => [...new Set(dados.filter((d) => !fBanco || d.banco === fBanco).map((d) => d.origem))].sort(), [dados, fBanco]);
  const classes = useMemo(() => [...new Set(dados.map((d) => d.classe).filter(Boolean))].sort() as string[], [dados]);

  const rows = useMemo(() => {
    const q = busca.toLowerCase();
    const r = dados.filter((d) =>
      (!fComp || d.competencia === fComp) && (!fBanco || d.banco === fBanco) &&
      (!fOrigem || d.origem === fOrigem) && (!fClasse || d.classe === fClasse) &&
      (!q || String(d.descricao || "").toLowerCase().includes(q) || String(d.detalhe || "").toLowerCase().includes(q)));
    return r.sort((a, b) => sortCol === "valor"
      ? (a.valor - b.valor) * sortDir
      : String(a[sortCol] || "").localeCompare(String(b[sortCol] || "")) * sortDir);
  }, [dados, busca, fComp, fBanco, fOrigem, fClasse, sortCol, sortDir]);

  const totals = useMemo(() => {
    let gasto = 0, receita = 0;
    rows.forEach((d) => { if (ehGasto(d.classe)) gasto += Math.abs(d.valor); else if (ehReceita(d.classe)) receita += Math.abs(d.valor); });
    return { gasto, receita, saldo: receita - gasto };
  }, [rows]);

  async function salvarCat(d: Lancamento, valor: string) {
    setSalvos((s) => ({ ...s, [d.id]: "salvando…" }));
    const { error } = await sb.from("lancamentos").update({ categoria_manual: valor || null }).eq("id", d.id);
    if (error) { setSalvos((s) => ({ ...s, [d.id]: "erro" })); return; }
    d.categoria_manual = valor || null;
    setSalvos((s) => ({ ...s, [d.id]: "✓" }));
    setTimeout(() => setSalvos((s) => { const n = { ...s }; delete n[d.id]; return n; }), 1200);
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
  const MAX = 1500;

  return (
    <div>
      <ArquivosPanel allDados={allDados} />

      <div className="flex flex-wrap gap-2 items-center mb-4">
        <input className="input min-w-[200px] flex-1" placeholder="Buscar descrição…" value={busca} onChange={(e) => setBusca(e.target.value)} />
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
        <button className="btn-ghost" onClick={() => { setBusca(""); setFComp(""); setFBanco(""); setFOrigem(""); setFClasse(""); }}>
          Limpar
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-[14px] mb-[18px]">
        <Kpi title="Gastos" value={BRL(totals.gasto)} color="text-red" />
        <Kpi title="Receitas" value={BRL(totals.receita)} color="text-green" />
        <Kpi title="Saldo" value={BRL(totals.saldo)} color={totals.saldo < 0 ? "text-red" : "text-green"} />
        <Kpi title="Lançamentos" value={rows.length.toLocaleString("pt-BR")} />
      </div>

      <div className="bg-card border border-line rounded-[18px] shadow-card overflow-hidden">
        <div className="max-h-[560px] overflow-auto scroll-thin">
          <table className="tbl min-w-[820px]">
            <thead><tr>
              {th("competencia", "Mês")}{th("banco", "Banco")}{th("origem", "Origem")}{th("data_mov", "Data")}
              {th("descricao", "Descrição")}{th("classe", "Classe")}
              <th className="sticky top-0 bg-card z-[1]">Categoria</th>
              {th("valor", "Valor")}
            </tr></thead>
            <tbody>
              {rows.slice(0, MAX).map((d) => (
                <tr key={d.id}>
                  <td>{mesCurto(d.competencia)}</td>
                  <td>{d.banco}</td>
                  <td>{d.origem}</td>
                  <td>{d.data_mov}</td>
                  <td className="max-w-[230px] truncate" title={d.descricao}>{d.descricao}</td>
                  <td>{d.classe}</td>
                  <td>
                    <select className="select-chev min-w-[130px] pl-2 py-[5px] text-[13px] bg-card text-txt border border-line rounded-[8px] cursor-pointer outline-none"
                      defaultValue={d.categoria_manual || ""} onChange={(e) => salvarCat(d, e.target.value)}>
                      {CATEGORIAS.map((c) => <option key={c} value={c}>{c || "—"}</option>)}
                    </select>
                    {salvos[d.id] && <span className="ml-2 text-[12px] text-green">{salvos[d.id]}</span>}
                  </td>
                  <td className={`num ${d.valor < 0 ? "text-red" : ehReceita(d.classe) ? "text-green" : ""}`}>
                    {fmtMoeda(d.valor, d.moeda)}
                    {dicaMoedaOrigem(d) && <span className="text-muted text-[11px] ml-1">({dicaMoedaOrigem(d)})</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {rows.length > MAX && <div className="text-muted text-[12.5px] mt-2">Mostrando {MAX} de {rows.length} lançamentos. Refine os filtros.</div>}
    </div>
  );
}
