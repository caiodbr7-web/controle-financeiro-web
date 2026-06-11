import { useState, useEffect, useMemo, useCallback, Fragment } from "react";
import { Kpi } from "../ui";
import { sb } from "../../lib/supabase";
import type { Lancamento } from "../../types";
import { BRL, CATEGORIAS, MES_ABREV, ehGasto } from "../../lib/finance";

interface Item { id: number; nome: string; categoria: string | null; valor_previsto: number; ativo: boolean; ordem: number; link_categoria: string | null; link_texto: string | null; }
interface Mensal { item_id: number; valor_real: number | null; pago: boolean; }

const addMesStr = (c: string, n: number) => { let y = +c.slice(0, 4), m = +c.slice(5, 7) + n; y += Math.floor((m - 1) / 12); m = ((m - 1) % 12 + 12) % 12 + 1; return y + "-" + String(m).padStart(2, "0"); };
const labelMes = (c: string) => MES_ABREV[+c.slice(5, 7) - 1] + "/" + c.slice(2, 4);
const fmt = (v: number | null | undefined) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 }));
function genMeses(n = 12) {
  const out: { v: string; label: string }[] = []; const h = new Date();
  for (let i = 0; i < n; i++) { const d = new Date(h.getFullYear(), h.getMonth() - i, 1); out.push({ v: d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"), label: MES_ABREV[d.getMonth()] + "/" + String(d.getFullYear()).slice(2) }); }
  return out;
}

export function Orcamento({ allDados }: { allDados: Lancamento[] }) {
  const meses = useMemo(() => genMeses(12), []);
  const [comp, setComp] = useState(meses[0].v);
  const [itens, setItens] = useState<Item[]>([]);
  const [valores, setValores] = useState<Record<string, Record<number, Mensal>>>({});
  const [reais, setReais] = useState<Record<number, string>>({});
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [novo, setNovo] = useState({ nome: "", categoria: "", valor: "" });
  const [linkEdit, setLinkEdit] = useState<number | null>(null);
  const [linkForm, setLinkForm] = useState({ categoria: "", texto: "" });

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
    const byComp: Record<string, Record<number, Mensal>> = {}; todos.forEach((c) => (byComp[c] = {}));
    (data || []).forEach((mm: any) => { (byComp[mm.competencia] = byComp[mm.competencia] || {})[mm.item_id] = mm; });
    setValores(byComp);
    const r: Record<number, string> = {}; Object.values(byComp[atual] || {}).forEach((mm) => { if (mm.valor_real != null) r[mm.item_id] = String(mm.valor_real); });
    setReais(r);
  }, []);
  useEffect(() => { carregarItens(); }, [carregarItens]);
  useEffect(() => { carregarValores(comp, histMeses); }, [comp, histMeses, carregarValores]);

  function parseValor(s: string): number | null { if (s == null || s.trim() === "") return null; const n = parseFloat(s.replace(/\./g, "").replace(",", ".")); return isNaN(n) ? null : n; }

  // ---- valor REAL lançado (das transações vinculadas) por item/mês ----
  function matchLink(d: Lancamento, it: Item) {
    if (!it.link_categoria && !it.link_texto) return false;
    if (!ehGasto(d.classe)) return false;
    if (it.link_categoria && d.categoria_manual !== it.link_categoria) return false;
    if (it.link_texto && !String(d.descricao || "").toLowerCase().includes(it.link_texto.toLowerCase())) return false;
    return true;
  }
  const autos = useMemo(() => {
    const todos = [...histMeses, comp];
    const out: Record<number, Record<string, number | null>> = {};
    itens.forEach((it) => {
      out[it.id] = {};
      todos.forEach((c) => {
        if (!it.link_categoria && !it.link_texto) { out[it.id][c] = null; return; }
        let sum = 0, cnt = 0;
        allDados.forEach((d) => { if (String(d.competencia).slice(0, 7) === c && matchLink(d, it)) { sum += Math.abs(d.valor); cnt++; } });
        out[it.id][c] = cnt > 0 ? Math.round(sum * 100) / 100 : null;
      });
    });
    return out;
  }, [itens, allDados, comp, histMeses]);

  async function upsert(itemId: number, c: string, valor_real: number | null, pago: boolean) {
    const { error } = await sb.from("orcamento_mensal").upsert({ item_id: itemId, competencia: c, valor_real, pago }, { onConflict: "item_id,competencia" });
    if (!error) setValores((v) => ({ ...v, [c]: { ...(v[c] || {}), [itemId]: { item_id: itemId, valor_real, pago } } }));
  }
  async function salvarReal(item: Item, valorStr: string) { const v = parseValor(valorStr); await upsert(item.id, comp, v, v != null); }
  async function usarLancado(item: Item, v: number) { await upsert(item.id, comp, v, true); setReais((r) => ({ ...r, [item.id]: String(v) })); }
  async function togglePago(item: Item) { const cur = valores[comp]?.[item.id]; await upsert(item.id, comp, cur?.valor_real ?? null, !(cur?.pago ?? false)); }
  async function salvarPrevisto(item: Item, valorStr: string) { const v = parseValor(valorStr) ?? 0; await sb.from("orcamento_itens").update({ valor_previsto: v }).eq("id", item.id); setItens((arr) => arr.map((x) => x.id === item.id ? { ...x, valor_previsto: v } : x)); }
  async function addItem() { if (!novo.nome.trim()) return; const { error } = await sb.from("orcamento_itens").insert({ nome: novo.nome.trim(), categoria: novo.categoria || null, valor_previsto: parseValor(novo.valor) ?? 0, ordem: 100 }); if (!error) { setNovo({ nome: "", categoria: "", valor: "" }); carregarItens(); } }
  async function removerItem(item: Item) { if (!confirm(`Remover "${item.nome}"?`)) return; const { error } = await sb.from("orcamento_itens").delete().eq("id", item.id); if (!error) carregarItens(); }
  function abrirLink(item: Item) { setLinkEdit(linkEdit === item.id ? null : item.id); setLinkForm({ categoria: item.link_categoria || "", texto: item.link_texto || "" }); }
  async function salvarLink(item: Item) {
    const { error } = await sb.from("orcamento_itens").update({ link_categoria: linkForm.categoria || null, link_texto: linkForm.texto.trim() || null }).eq("id", item.id);
    if (!error) { setLinkEdit(null); carregarItens(); }
  }

  // efetivo: minha info (manual) é principal; onde não há manual e existe lançado, usa o lançado
  function dados(item: Item, c: string) {
    const manual = valores[c]?.[item.id]?.valor_real ?? null;
    const auto = autos[item.id]?.[c] ?? null;
    const efetivo = manual != null ? manual : (auto != null ? auto : null);
    const conflito = manual != null && auto != null && Math.abs(manual - auto) > 1;
    return { manual, auto, efetivo, conflito, pago: valores[c]?.[item.id]?.pago ?? false };
  }

  const tot = (sel: (it: Item) => number) => itens.reduce((s, it) => s + sel(it), 0);
  const totPrev = tot((it) => it.valor_previsto || 0);
  const totEfet = tot((it) => { const d = dados(it, comp); return d.efetivo != null ? d.efetivo : it.valor_previsto; });
  const totReal = tot((it) => dados(it, comp).manual ?? 0);
  const conflitos = itens.filter((it) => dados(it, comp).conflito).length;
  const preenchidos = itens.filter((it) => dados(it, comp).manual != null).length;
  const totHist = (c: string) => tot((it) => { const d = dados(it, c); return d.efetivo ?? 0; });

  const inp = "bg-card border border-line rounded-[8px] px-2 py-[6px] text-[13px]";
  const thHist = "text-right p-[10px] border-b border-line text-muted font-normal";

  return (
    <div>
      <div className="flex flex-wrap gap-[10px] items-center mb-4">
        <label className="text-muted text-[13px]">Mês:</label>
        <select value={comp} onChange={(e) => setComp(e.target.value)} className="bg-card border border-line rounded-[10px] px-3 py-[9px] text-[15px]">
          {meses.map((mm) => <option key={mm.v} value={mm.v}>{mm.label}</option>)}
        </select>
        <span className="text-muted text-[12.5px]">{preenchidos}/{itens.length} preenchidos{conflitos ? ` · ${conflitos} conflito(s)` : ""}</span>
      </div>

      {erro ? (
        <div className="bg-card border border-line rounded-[18px] p-5 shadow-card text-red">{erro}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-[14px] mb-5">
            <Kpi title="Previsto" value={BRL(totPrev)} sub={`${itens.length} itens fixos`} />
            <Kpi title={`Real ${labelMes(comp)}`} value={BRL(totReal)} sub={`${preenchidos} de ${itens.length}`} color="text-green" />
            <Kpi title="Fechamento do mês" value={BRL(totEfet)} sub="manual onde houver, senão lançado/previsto" color="text-amber" />
            <Kpi title="vs Previsto" value={BRL(totEfet - totPrev)} sub={totEfet - totPrev > 0 ? "acima" : "dentro/abaixo"} color={totEfet - totPrev > 0 ? "text-red" : "text-green"} />
          </div>

          <div className="bg-card border border-line rounded-[18px] shadow-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[940px] border-collapse text-[13.5px]">
                <thead className="text-muted text-[11px] uppercase">
                  <tr>
                    <th rowSpan={2} className="text-left p-[10px] border-b border-line align-bottom">Item</th>
                    <th rowSpan={2} className="text-left p-[10px] border-b border-line align-bottom">Categoria</th>
                    <th colSpan={3} className="text-center p-[6px] border-b border-line text-[10px]">Efetivo — meses anteriores</th>
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
                  {itens.map((it) => {
                    const d = dados(it, comp);
                    return (
                      <Fragment key={it.id}>
                        <tr>
                          <td className="text-left p-[10px] border-b border-line font-medium">
                            {it.nome}{(it.link_categoria || it.link_texto) && <span title={`vínculo: ${it.link_categoria || ""}${it.link_texto ? " · ‘" + it.link_texto + "’" : ""}`} className="ml-1 text-accent text-[11px]">🔗</span>}
                          </td>
                          <td className="text-left p-[10px] border-b border-line text-muted">{it.categoria || "—"}</td>
                          {histMeses.map((c) => <td key={c} className="text-right p-[10px] border-b border-line text-muted tabular-nums">{fmt(dados(it, c).efetivo)}</td>)}
                          <td className="text-right p-[10px] border-b border-line">
                            <input className={`${inp} w-[100px] text-right`} defaultValue={it.valor_previsto ? String(it.valor_previsto) : ""} placeholder="0,00" onBlur={(e) => salvarPrevisto(it, e.target.value)} />
                          </td>
                          <td className="text-right p-[10px] border-b border-line">
                            <input className={`${inp} w-[100px] text-right ${d.conflito ? "border-red" : ""}`} value={reais[it.id] ?? ""} placeholder={d.auto != null ? fmt(d.auto) : (it.valor_previsto ? String(it.valor_previsto) : "—")}
                              onChange={(e) => setReais((r) => ({ ...r, [it.id]: e.target.value }))} onBlur={(e) => salvarReal(it, e.target.value)} />
                            {d.auto != null && (d.conflito || d.manual == null) && (
                              <div className={`text-[11px] mt-1 flex items-center gap-1 justify-end ${d.conflito ? "text-red" : "text-muted"}`}>
                                {d.conflito ? "⚠ lançado" : "lançado"} {fmt(d.auto)}
                                <button onClick={() => usarLancado(it, d.auto as number)} className="underline text-accent">usar</button>
                              </div>
                            )}
                          </td>
                          <td className="text-center p-[10px] border-b border-line">
                            <button onClick={() => togglePago(it)} title={d.pago ? "Pago" : "Marcar pago"}
                              className={`w-7 h-7 rounded-[8px] border-2 flex items-center justify-center mx-auto text-[15px] font-bold ${d.pago ? "bg-green border-green text-white" : "border-line text-transparent hover:border-green"}`}>✓</button>
                          </td>
                          <td className="p-[10px] border-b border-line text-center whitespace-nowrap">
                            <button onClick={() => abrirLink(it)} className="text-muted hover:text-accent text-[12px]">vincular</button>
                            <span className="text-line mx-1">·</span>
                            <button onClick={() => removerItem(it)} className="text-muted hover:text-red text-[12px]">remover</button>
                          </td>
                        </tr>
                        {linkEdit === it.id && (
                          <tr className="bg-[#faf5ff]">
                            <td colSpan={9} className="p-[12px] border-b border-line">
                              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                                <span className="text-muted">Vincular <b>{it.nome}</b> à despesa real onde:</span>
                                <span>categoria</span>
                                <select className={inp} value={linkForm.categoria} onChange={(e) => setLinkForm((f) => ({ ...f, categoria: e.target.value }))}>
                                  {CATEGORIAS.map((c) => <option key={c} value={c}>{c || "(qualquer)"}</option>)}
                                </select>
                                <span>e/ou descrição contém</span>
                                <input className={`${inp} w-[200px]`} placeholder="ex.: adas imove" value={linkForm.texto} onChange={(e) => setLinkForm((f) => ({ ...f, texto: e.target.value }))} />
                                <button onClick={() => salvarLink(it)} className="bg-accent hover:bg-accent2 text-white rounded-[8px] px-3 py-[6px] text-[12px]">Salvar vínculo</button>
                                <button onClick={() => setLinkEdit(null)} className="text-muted text-[12px]">cancelar</button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {!carregando && !itens.length && <tr><td colSpan={9} className="p-4 text-muted">Nenhum item ainda. Adicione abaixo.</td></tr>}
                  <tr className="bg-[#fafafa]">
                    <td className="p-[10px] border-t border-line"><input className={`${inp} w-full`} placeholder="novo item (ex.: Internet)" value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} /></td>
                    <td className="p-[10px] border-t border-line">
                      <select className={inp} value={novo.categoria} onChange={(e) => setNovo({ ...novo, categoria: e.target.value })}>{CATEGORIAS.map((c) => <option key={c} value={c}>{c || "—"}</option>)}</select>
                    </td>
                    <td colSpan={3} className="border-t border-line"></td>
                    <td className="p-[10px] border-t border-line text-right"><input className={`${inp} w-[100px] text-right`} placeholder="previsto" value={novo.valor} onChange={(e) => setNovo({ ...novo, valor: e.target.value })} /></td>
                    <td colSpan={3} className="p-[10px] border-t border-line"><button onClick={addItem} className="bg-accent hover:bg-accent2 text-white text-[12px] rounded-[8px] px-3 py-[6px]">Adicionar</button></td>
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
            <b>Vincular</b> liga o item a uma despesa real (categoria e/ou texto na descrição). Onde houver lançamentos, o valor <b>lançado</b> aparece e você aplica com <b>usar</b>; sua informação manual continua sendo a principal. Se o manual divergir do lançado, marca <b className="text-red">conflito</b> e você decide (usar lançado ou manter o seu).
          </div>
        </>
      )}
    </div>
  );
}
