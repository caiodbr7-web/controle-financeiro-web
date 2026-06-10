import { useState, useMemo } from "react";
import type { Lancamento } from "../../types";
import { Kpi } from "../ui";
import { sb } from "../../lib/supabase";
import { BRL, mesCurto, ehGasto, ehReceita, CATEGORIAS } from "../../lib/finance";

interface Props { dados: Lancamento[]; months: string[]; reload: () => void; }

export function Lancamentos({ dados, months }: Props) {
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
      <th className="text-left p-[10px] border-b border-line cursor-pointer sticky top-0 bg-card z-[1]"
        onClick={() => { if (sortCol === col) setSortDir((x) => x * -1); else { setSortCol(col); setSortDir(col === "valor" ? -1 : 1); } }}>
        {label}{sortCol === col ? (sortDir > 0 ? " ▲" : " ▼") : ""}
      </th>
    );
  }
  const sel = "bg-card border border-line rounded-[10px] px-3 py-[9px] text-[15px]";
  const MAX = 1500;

  return (
    <div>
      <div className="flex flex-wrap gap-[10px] items-center mb-4">
        <input className={`${sel} min-w-[200px] flex-1`} placeholder="buscar descrição..." value={busca} onChange={(e) => setBusca(e.target.value)} />
        <select className={sel} value={fComp} onChange={(e) => setFComp(e.target.value)}><option value="">Todos os meses</option>{months.map((m) => <option key={m} value={m}>{mesCurto(m)}</option>)}</select>
        <select className={sel} value={fBanco} onChange={(e) => { setFBanco(e.target.value); setFOrigem(""); }}><option value="">Todos os bancos</option>{bancos.map((b) => <option key={b}>{b}</option>)}</select>
        <select className={sel} value={fOrigem} onChange={(e) => setFOrigem(e.target.value)}><option value="">Todas as origens</option>{origens.map((o) => <option key={o}>{o}</option>)}</select>
        <select className={sel} value={fClasse} onChange={(e) => setFClasse(e.target.value)}><option value="">Todas as classes</option>{classes.map((c) => <option key={c}>{c}</option>)}</select>
        <button className="bg-transparent border border-line text-muted rounded-[10px] px-4 py-[9px] cursor-pointer hover:text-txt"
          onClick={() => { setBusca(""); setFComp(""); setFBanco(""); setFOrigem(""); setFClasse(""); }}>Limpar</button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-[14px] mb-5">
        <Kpi title="Gastos" value={BRL(totals.gasto)} color="text-red" />
        <Kpi title="Receitas" value={BRL(totals.receita)} color="text-green" />
        <Kpi title="Saldo" value={BRL(totals.saldo)} color={totals.saldo < 0 ? "text-red" : "text-green"} />
        <Kpi title="Lançamentos" value={rows.length} />
      </div>

      <div className="bg-card border border-line rounded-[18px] shadow-card overflow-hidden">
        <div className="max-h-[560px] overflow-auto">
          <table className="w-full border-collapse text-[13.5px]">
            <thead><tr className="text-muted text-[11px] uppercase">
              {th("competencia", "Mês")}{th("banco", "Banco")}{th("origem", "Origem")}{th("data_mov", "Data")}
              {th("descricao", "Descrição")}{th("classe", "Classe")}
              <th className="text-left p-[10px] border-b border-line sticky top-0 bg-card z-[1]">Categoria</th>
              {th("valor", "Valor")}
            </tr></thead>
            <tbody>
              {rows.slice(0, MAX).map((d) => (
                <tr key={d.id}>
                  <td className="text-left p-[10px] border-b border-line">{mesCurto(d.competencia)}</td>
                  <td className="text-left p-[10px] border-b border-line">{d.banco}</td>
                  <td className="text-left p-[10px] border-b border-line">{d.origem}</td>
                  <td className="text-left p-[10px] border-b border-line">{d.data_mov}</td>
                  <td className="text-left p-[10px] border-b border-line max-w-[230px] truncate" title={d.descricao}>{d.descricao}</td>
                  <td className="text-left p-[10px] border-b border-line">{d.classe}</td>
                  <td className="text-left p-[10px] border-b border-line">
                    <select className="min-w-[130px] px-2 py-[6px] text-[13px] bg-card border border-line rounded-[8px]"
                      defaultValue={d.categoria_manual || ""} onChange={(e) => salvarCat(d, e.target.value)}>
                      {CATEGORIAS.map((c) => <option key={c} value={c}>{c || "—"}</option>)}
                    </select>
                    {salvos[d.id] && <span className="ml-2 text-[12px] text-green">{salvos[d.id]}</span>}
                  </td>
                  <td className={`text-right p-[10px] border-b border-line ${d.valor < 0 ? "text-red" : ehReceita(d.classe) ? "text-green" : ""}`}>{BRL(d.valor)}</td>
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
