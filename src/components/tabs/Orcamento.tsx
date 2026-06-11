import { useState, useEffect, useMemo, useCallback } from "react";
import { Kpi } from "../ui";
import { sb } from "../../lib/supabase";
import { BRL, CATEGORIAS, MES_ABREV } from "../../lib/finance";

interface Item { id: number; nome: string; categoria: string | null; valor_previsto: number; ativo: boolean; ordem: number; }
interface Mensal { item_id: number; valor_real: number | null; pago: boolean; }

function genMeses(n = 12) {
  const out: { v: string; label: string }[] = [];
  const h = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(h.getFullYear(), h.getMonth() - i, 1);
    const v = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
    out.push({ v, label: MES_ABREV[d.getMonth()] + "/" + String(d.getFullYear()).slice(2) });
  }
  return out;
}

export function Orcamento() {
  const meses = useMemo(() => genMeses(12), []);
  const [comp, setComp] = useState(meses[0].v);
  const [itens, setItens] = useState<Item[]>([]);
  const [mensal, setMensal] = useState<Record<number, Mensal>>({});
  const [reais, setReais] = useState<Record<number, string>>({}); // valores em edição
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [novo, setNovo] = useState({ nome: "", categoria: "", valor: "" });

  const carregarItens = useCallback(async () => {
    setCarregando(true); setErro("");
    const { data, error } = await sb.from("orcamento_itens").select("*").eq("ativo", true).order("ordem").order("nome");
    if (error) { setErro(error.message.includes("does not exist") ? "Tabelas de orçamento ainda não existem — rode a migration 0004_orcamento.sql no Supabase." : error.message); setCarregando(false); return; }
    setItens((data || []) as Item[]); setCarregando(false);
  }, []);

  const carregarMensal = useCallback(async (c: string) => {
    const { data, error } = await sb.from("orcamento_mensal").select("item_id,valor_real,pago").eq("competencia", c);
    if (error) return;
    const map: Record<number, Mensal> = {};
    (data || []).forEach((m: any) => { map[m.item_id] = m; });
    setMensal(map);
    const r: Record<number, string> = {};
    (data || []).forEach((m: any) => { if (m.valor_real != null) r[m.item_id] = String(m.valor_real); });
    setReais(r);
  }, []);

  useEffect(() => { carregarItens(); }, [carregarItens]);
  useEffect(() => { carregarMensal(comp); }, [comp, carregarMensal]);

  function parseValor(s: string): number | null {
    if (s == null || s.trim() === "") return null;
    const n = parseFloat(s.replace(/\./g, "").replace(",", "."));
    return isNaN(n) ? null : n;
  }

  async function salvarReal(item: Item, valorStr: string) {
    const valor_real = parseValor(valorStr);
    const pago = mensal[item.id]?.pago ?? false;
    const { error } = await sb.from("orcamento_mensal")
      .upsert({ item_id: item.id, competencia: comp, valor_real, pago }, { onConflict: "item_id,competencia" });
    if (!error) setMensal((m) => ({ ...m, [item.id]: { item_id: item.id, valor_real, pago } }));
  }

  async function togglePago(item: Item) {
    const cur = mensal[item.id];
    const pago = !(cur?.pago ?? false);
    const valor_real = cur?.valor_real ?? null;
    const { error } = await sb.from("orcamento_mensal")
      .upsert({ item_id: item.id, competencia: comp, valor_real, pago }, { onConflict: "item_id,competencia" });
    if (!error) setMensal((m) => ({ ...m, [item.id]: { item_id: item.id, valor_real, pago } }));
  }

  async function addItem() {
    if (!novo.nome.trim()) return;
    const { error } = await sb.from("orcamento_itens").insert({
      nome: novo.nome.trim(), categoria: novo.categoria || null,
      valor_previsto: parseValor(novo.valor) ?? 0, ordem: 100,
    });
    if (!error) { setNovo({ nome: "", categoria: "", valor: "" }); carregarItens(); }
  }

  async function removerItem(item: Item) {
    if (!confirm(`Remover "${item.nome}" do orçamento? (some de todos os meses)`)) return;
    const { error } = await sb.from("orcamento_itens").delete().eq("id", item.id);
    if (!error) carregarItens();
  }

  async function salvarPrevisto(item: Item, valorStr: string) {
    const v = parseValor(valorStr) ?? 0;
    await sb.from("orcamento_itens").update({ valor_previsto: v }).eq("id", item.id);
    setItens((arr) => arr.map((x) => x.id === item.id ? { ...x, valor_previsto: v } : x));
  }

  // efetivo do mês: usa o real quando preenchido, senão o previsto
  const linhas = itens.map((it) => {
    const real = mensal[it.id]?.valor_real;
    const efetivo = real != null ? real : it.valor_previsto;
    return { it, real, efetivo, preenchido: real != null, pago: mensal[it.id]?.pago ?? false };
  });
  const totPrev = itens.reduce((s, it) => s + (it.valor_previsto || 0), 0);
  const totEfet = linhas.reduce((s, l) => s + (l.efetivo || 0), 0);
  const totReal = linhas.reduce((s, l) => s + (l.real ?? 0), 0);
  const preenchidos = linhas.filter((l) => l.preenchido).length;
  const dif = totEfet - totPrev;

  const inp = "bg-card border border-line rounded-[8px] px-2 py-[6px] text-[13px]";

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
            <Kpi title="Real (preenchido)" value={BRL(totReal)} sub={`${preenchidos} de ${itens.length}`} color="text-green" />
            <Kpi title="Fechamento do mês" value={BRL(totEfet)} sub="real onde preenchido, senão previsto" color="text-amber" />
            <Kpi title="vs Previsto" value={BRL(dif)} sub={dif > 0 ? "acima do previsto" : "dentro/abaixo"} color={dif > 0 ? "text-red" : "text-green"} />
          </div>

          <div className="bg-card border border-line rounded-[18px] shadow-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-[13.5px]">
                <thead><tr className="text-muted text-[11px] uppercase">
                  <th className="text-left p-[10px] border-b border-line">Item</th>
                  <th className="text-left p-[10px] border-b border-line">Categoria</th>
                  <th className="text-right p-[10px] border-b border-line">Previsto</th>
                  <th className="text-right p-[10px] border-b border-line">Real do mês</th>
                  <th className="text-center p-[10px] border-b border-line">Pago</th>
                  <th className="p-[10px] border-b border-line"></th>
                </tr></thead>
                <tbody>
                  {linhas.map(({ it, pago }) => (
                    <tr key={it.id}>
                      <td className="text-left p-[10px] border-b border-line font-medium">{it.nome}</td>
                      <td className="text-left p-[10px] border-b border-line text-muted">{it.categoria || "—"}</td>
                      <td className="text-right p-[10px] border-b border-line">
                        <input className={`${inp} w-[110px] text-right`} defaultValue={it.valor_previsto ? String(it.valor_previsto) : ""}
                          placeholder="0,00" onBlur={(e) => salvarPrevisto(it, e.target.value)} />
                      </td>
                      <td className="text-right p-[10px] border-b border-line">
                        <input className={`${inp} w-[110px] text-right`} value={reais[it.id] ?? ""}
                          placeholder={it.valor_previsto ? String(it.valor_previsto) : "—"}
                          onChange={(e) => setReais((r) => ({ ...r, [it.id]: e.target.value }))}
                          onBlur={(e) => salvarReal(it, e.target.value)} />
                      </td>
                      <td className="text-center p-[10px] border-b border-line">
                        <input type="checkbox" checked={pago} onChange={() => togglePago(it)} />
                      </td>
                      <td className="p-[10px] border-b border-line text-center">
                        <button onClick={() => removerItem(it)} className="text-muted hover:text-red text-[12px]">remover</button>
                      </td>
                    </tr>
                  ))}
                  {!carregando && !itens.length && <tr><td colSpan={6} className="p-4 text-muted">Nenhum item ainda. Adicione abaixo.</td></tr>}
                  <tr className="bg-[#fafafa]">
                    <td className="p-[10px] border-t border-line"><input className={`${inp} w-full`} placeholder="novo item (ex.: Internet)" value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} /></td>
                    <td className="p-[10px] border-t border-line">
                      <select className={inp} value={novo.categoria} onChange={(e) => setNovo({ ...novo, categoria: e.target.value })}>
                        {CATEGORIAS.map((c) => <option key={c} value={c}>{c || "—"}</option>)}
                      </select>
                    </td>
                    <td className="p-[10px] border-t border-line text-right"><input className={`${inp} w-[110px] text-right`} placeholder="previsto" value={novo.valor} onChange={(e) => setNovo({ ...novo, valor: e.target.value })} /></td>
                    <td className="p-[10px] border-t border-line" colSpan={3}>
                      <button onClick={addItem} className="bg-accent hover:bg-accent2 text-white text-[12px] rounded-[8px] px-3 py-[6px] cursor-pointer">Adicionar</button>
                    </td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr className="font-semibold">
                    <td className="p-[10px] border-t-2 border-line" colSpan={2}>Total</td>
                    <td className="p-[10px] border-t-2 border-line text-right">{BRL(totPrev)}</td>
                    <td className="p-[10px] border-t-2 border-line text-right text-amber">{BRL(totEfet)}</td>
                    <td className="p-[10px] border-t-2 border-line" colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
          <div className="text-muted text-[12.5px] mt-3">
            Os itens se repetem todo mês. Preencha o <b>Real do mês</b> para fechar; onde estiver vazio, o fechamento usa o previsto. Edite o previsto direto na coluna. O <b>Mês</b> no topo troca a competência.
          </div>
        </>
      )}
    </div>
  );
}
