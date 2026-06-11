import { useState, useEffect, useMemo, useCallback } from "react";
import { Kpi } from "../ui";
import { sb } from "../../lib/supabase";
import { BRL, CATEGORIAS, MES_ABREV } from "../../lib/finance";

interface Item { id: number; nome: string; categoria: string | null; valor_previsto: number; ativo: boolean; ordem: number; }
interface Mensal { item_id: number; valor_real: number | null; pago: boolean; }

const addMesStr = (c: string, n: number) => {
  let y = +c.slice(0, 4), m = +c.slice(5, 7) + n;
  y += Math.floor((m - 1) / 12); m = ((m - 1) % 12 + 12) % 12 + 1;
  return y + "-" + String(m).padStart(2, "0");
};
const labelMes = (c: string) => MES_ABREV[+c.slice(5, 7) - 1] + "/" + c.slice(2, 4);
const fmt = (v: number | null | undefined) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 }));

function genMeses(n = 12) {
  const out: { v: string; label: string }[] = [];
  const h = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(h.getFullYear(), h.getMonth() - i, 1);
    out.push({ v: d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"), label: MES_ABREV[d.getMonth()] + "/" + String(d.getFullYear()).slice(2) });
  }
  return out;
}

export function Orcamento() {
  const meses = useMemo(() => genMeses(12), []);
  const [comp, setComp] = useState(meses[0].v);
  const [itens, setItens] = useState<Item[]>([]);
  const [valores, setValores] = useState<Record<string, Record<number, Mensal>>>({}); // comp -> item -> mensal
  const [reais, setReais] = useState<Record<number, string>>({});
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [novo, setNovo] = useState({ nome: "", categoria: "", valor: "" });

  const histMeses = useMemo(() => [addMesStr(comp, -3), addMesStr(comp, -2), addMesStr(comp, -1)], [comp]);

  const carregarItens = useCallback(async () => {
    setCarregando(true); setErro("");
    const { data, error } = await sb.from("orcamento_itens").select("*").eq("ativo", true).order("ordem").order("nome");
    if (error) { setErro(error.message.includes("schema cache") || error.message.includes("does not exist") ? "Tabelas de orçamento ainda não existem — rode a migration 0004 no Supabase." : error.message); setCarregando(false); return; }
    setItens((data || []) as Item[]); setCarregando(false);
  }, []);

  const carregarValores = useCallback(async (atual: string, hist: string[]) => {
    const todos = [...hist, atual];
    const { data, error } = await sb.from("orcamento_mensal").select("item_id,competencia,valor_real,pago").in("competencia", todos);
    if (error) return;
    const byComp: Record<string, Record<number, Mensal>> = {};
    todos.forEach((c) => (byComp[c] = {}));
    (data || []).forEach((m: any) => { (byComp[m.competencia] = byComp[m.competencia] || {})[m.item_id] = m; });
    setValores(byComp);
    const r: Record<number, string> = {};
    Object.values(byComp[atual] || {}).forEach((m) => { if (m.valor_real != null) r[m.item_id] = String(m.valor_real); });
    setReais(r);
  }, []);

  useEffect(() => { carregarItens(); }, [carregarItens]);
  useEffect(() => { carregarValores(comp, histMeses); }, [comp, histMeses, carregarValores]);

  function parseValor(s: string): number | null {
    if (s == null || s.trim() === "") return null;
    const n = parseFloat(s.replace(/\./g, "").replace(",", "."));
    return isNaN(n) ? null : n;
  }

  async function upsert(itemId: number, c: string, valor_real: number | null, pago: boolean) {
    const { error } = await sb.from("orcamento_mensal").upsert({ item_id: itemId, competencia: c, valor_real, pago }, { onConflict: "item_id,competencia" });
    if (!error) setValores((v) => ({ ...v, [c]: { ...(v[c] || {}), [itemId]: { item_id: itemId, valor_real, pago } } }));
  }
  // preencher o Real marca Pago automaticamente
  async function salvarReal(item: Item, valorStr: string) {
    const valor_real = parseValor(valorStr);
    await upsert(item.id, comp, valor_real, valor_real != null);
  }
  async function togglePago(item: Item) {
    const cur = valores[comp]?.[item.id];
    await upsert(item.id, comp, cur?.valor_real ?? null, !(cur?.pago ?? false));
  }
  async function salvarPrevisto(item: Item, valorStr: string) {
    const v = parseValor(valorStr) ?? 0;
    await sb.from("orcamento_itens").update({ valor_previsto: v }).eq("id", item.id);
    setItens((arr) => arr.map((x) => x.id === item.id ? { ...x, valor_previsto: v } : x));
  }
  async function addItem() {
    if (!novo.nome.trim()) return;
    const { error } = await sb.from("orcamento_itens").insert({ nome: novo.nome.trim(), categoria: novo.categoria || null, valor_previsto: parseValor(novo.valor) ?? 0, ordem: 100 });
    if (!error) { setNovo({ nome: "", categoria: "", valor: "" }); carregarItens(); }
  }
  async function removerItem(item: Item) {
    if (!confirm(`Remover "${item.nome}" do orçamento? (some de todos os meses)`)) return;
    const { error } = await sb.from("orcamento_itens").delete().eq("id", item.id);
    if (!error) carregarItens();
  }

  const mensalAtual = valores[comp] || {};
  const linhas = itens.map((it) => {
    const real = mensalAtual[it.id]?.valor_real;
    return { it, real, efetivo: real != null ? real : it.valor_previsto, preenchido: real != null, pago: mensalAtual[it.id]?.pago ?? false };
  });
  const totPrev = itens.reduce((s, it) => s + (it.valor_previsto || 0), 0);
  const totEfet = linhas.reduce((s, l) => s + (l.efetivo || 0), 0);
  const totReal = linhas.reduce((s, l) => s + (l.real ?? 0), 0);
  const totHist = (c: string) => itens.reduce((s, it) => s + (valores[c]?.[it.id]?.valor_real ?? 0), 0);
  const preenchidos = linhas.filter((l) => l.preenchido).length;
  const dif = totEfet - totPrev;

  const inp = "bg-card border border-line rounded-[8px] px-2 py-[6px] text-[13px]";
  const thHist = "text-right p-[10px] border-b border-line text-muted font-normal";

  return (
    <div>
      <div className="flex flex-wrap gap-[10px] items-center mb-4">
        <label className="text-muted text-[13px]">Mês:</label>
        <select value={comp} onChange={(e) => setComp(e.target.value)} className="bg-card border border-line rounded-[10px] px-3 py-[9px] text-[15px]">
          {meses.map((m) => <option key={m.v} value={m.v}>{m.label}</option>)}
        </select>
        <span className="text-muted text-[12.5px]">{preenchidos}/{itens.length} itens preenchidos</span>
      </div>

      {erro ? (
        <div className="bg-card border border-line rounded-[18px] p-5 shadow-card text-red">{erro}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-[14px] mb-5">
            <Kpi title="Previsto" value={BRL(totPrev)} sub={`${itens.length} itens fixos`} />
            <Kpi title={`Real ${labelMes(comp)}`} value={BRL(totReal)} sub={`${preenchidos} de ${itens.length} pagos`} color="text-green" />
            <Kpi title="Fechamento do mês" value={BRL(totEfet)} sub="real onde pago, senão previsto" color="text-amber" />
            <Kpi title="vs Previsto" value={BRL(dif)} sub={dif > 0 ? "acima do previsto" : "dentro/abaixo"} color={dif > 0 ? "text-red" : "text-green"} />
          </div>

          <div className="bg-card border border-line rounded-[18px] shadow-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-[13.5px]">
                <thead className="text-muted text-[11px] uppercase">
                  <tr>
                    <th rowSpan={2} className="text-left p-[10px] border-b border-line align-bottom">Item</th>
                    <th rowSpan={2} className="text-left p-[10px] border-b border-line align-bottom">Categoria</th>
                    <th colSpan={3} className="text-center p-[6px] border-b border-line text-[10px]">Pago — meses anteriores</th>
                    <th colSpan={2} className="text-center p-[6px] border-b border-line text-accent">{labelMes(comp)}</th>
                    <th rowSpan={2} className="text-center p-[10px] border-b border-line align-bottom">Pago</th>
                    <th rowSpan={2} className="p-[10px] border-b border-line"></th>
                  </tr>
                  <tr>
                    {histMeses.map((c) => <th key={c} className={thHist}>{labelMes(c)}</th>)}
                    <th className="text-right p-[10px] border-b border-line">Previsto</th>
                    <th className="text-right p-[10px] border-b border-line">Real</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map(({ it, pago }) => (
                    <tr key={it.id}>
                      <td className="text-left p-[10px] border-b border-line font-medium">{it.nome}</td>
                      <td className="text-left p-[10px] border-b border-line text-muted">{it.categoria || "—"}</td>
                      {histMeses.map((c) => (
                        <td key={c} className="text-right p-[10px] border-b border-line text-muted tabular-nums">{fmt(valores[c]?.[it.id]?.valor_real)}</td>
                      ))}
                      <td className="text-right p-[10px] border-b border-line">
                        <input className={`${inp} w-[100px] text-right`} defaultValue={it.valor_previsto ? String(it.valor_previsto) : ""} placeholder="0,00" onBlur={(e) => salvarPrevisto(it, e.target.value)} />
                      </td>
                      <td className="text-right p-[10px] border-b border-line">
                        <input className={`${inp} w-[100px] text-right`} value={reais[it.id] ?? ""} placeholder={it.valor_previsto ? String(it.valor_previsto) : "—"}
                          onChange={(e) => setReais((r) => ({ ...r, [it.id]: e.target.value }))} onBlur={(e) => salvarReal(it, e.target.value)} />
                      </td>
                      <td className="text-center p-[10px] border-b border-line">
                        <button onClick={() => togglePago(it)} title={pago ? "Pago" : "Marcar como pago"}
                          className={`w-7 h-7 rounded-[8px] border-2 flex items-center justify-center mx-auto text-[15px] font-bold transition ${pago ? "bg-green border-green text-white" : "border-line text-transparent hover:border-green"}`}>✓</button>
                      </td>
                      <td className="p-[10px] border-b border-line text-center">
                        <button onClick={() => removerItem(it)} className="text-muted hover:text-red text-[12px]">remover</button>
                      </td>
                    </tr>
                  ))}
                  {!carregando && !itens.length && <tr><td colSpan={9} className="p-4 text-muted">Nenhum item ainda. Adicione abaixo.</td></tr>}
                  <tr className="bg-[#fafafa]">
                    <td className="p-[10px] border-t border-line"><input className={`${inp} w-full`} placeholder="novo item (ex.: Internet)" value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} /></td>
                    <td className="p-[10px] border-t border-line">
                      <select className={inp} value={novo.categoria} onChange={(e) => setNovo({ ...novo, categoria: e.target.value })}>
                        {CATEGORIAS.map((c) => <option key={c} value={c}>{c || "—"}</option>)}
                      </select>
                    </td>
                    <td colSpan={3} className="border-t border-line"></td>
                    <td className="p-[10px] border-t border-line text-right"><input className={`${inp} w-[100px] text-right`} placeholder="previsto" value={novo.valor} onChange={(e) => setNovo({ ...novo, valor: e.target.value })} /></td>
                    <td colSpan={3} className="p-[10px] border-t border-line">
                      <button onClick={addItem} className="bg-accent hover:bg-accent2 text-white text-[12px] rounded-[8px] px-3 py-[6px] cursor-pointer">Adicionar</button>
                    </td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr className="font-semibold">
                    <td className="p-[10px] border-t-2 border-line" colSpan={2}>Total</td>
                    {histMeses.map((c) => <td key={c} className="p-[10px] border-t-2 border-line text-right tabular-nums">{fmt(totHist(c))}</td>)}
                    <td className="p-[10px] border-t-2 border-line text-right">{BRL(totPrev)}</td>
                    <td className="p-[10px] border-t-2 border-line text-right text-amber">{BRL(totEfet)}</td>
                    <td className="p-[10px] border-t-2 border-line" colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
          <div className="text-muted text-[12.5px] mt-3">
            As 3 colunas à esquerda mostram o <b>valor pago</b> nos meses anteriores. Preencher o <b>Real</b> do mês já marca como <b>pago</b> (✓). Onde estiver vazio, o fechamento usa o previsto. Edite o previsto direto na coluna.
          </div>
        </>
      )}
    </div>
  );
}
