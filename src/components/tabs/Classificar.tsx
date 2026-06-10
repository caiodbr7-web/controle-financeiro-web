import { useState, useMemo, useEffect } from "react";
import type { Lancamento } from "../../types";
import { Kpi } from "../ui";
import { sb } from "../../lib/supabase";
import { BRL, ehGasto, normEstab, CATEGORIAS } from "../../lib/finance";

interface Props { dados: Lancamento[]; openModal: (t: string, r: Lancamento[]) => void; reload: () => void; }

interface Grupo { key: string; ex: string; ids: number[]; rows: Lancamento[]; total: number; n: number; sugestao: string; }

export function Classificar({ dados, openModal, reload }: Props) {
  const [escolhas, setEscolhas] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  // grupos de gastos AINDA sem categoria manual, por estabelecimento, ordenados por valor
  const grupos = useMemo<Grupo[]>(() => {
    const map = new Map<string, Grupo>();
    dados.forEach((d) => {
      if (!ehGasto(d.classe)) return;
      if (d.categoria_manual) return;
      const k = normEstab(d.descricao);
      let g = map.get(k);
      if (!g) { g = { key: k, ex: d.descricao, ids: [], rows: [], total: 0, n: 0, sugestao: "" }; map.set(k, g); }
      g.ids.push(d.id); g.rows.push(d); g.total += Math.abs(d.valor); g.n++;
    });
    const arr = [...map.values()].map((g) => {
      const sug: Record<string, number> = {};
      g.rows.forEach((d) => { const s = d.categoria_auto || ""; if (s) sug[s] = (sug[s] || 0) + Math.abs(d.valor); });
      const top = Object.keys(sug).sort((a, b) => sug[b] - sug[a])[0] || "";
      return { ...g, sugestao: CATEGORIAS.includes(top) ? top : "" };
    });
    arr.sort((a, b) => b.total - a.total);
    return arr;
  }, [dados]);

  useEffect(() => {
    setEscolhas((prev) => {
      const init: Record<string, string> = {};
      grupos.forEach((g) => { init[g.key] = prev[g.key] ?? g.sugestao; });
      return init;
    });
  }, [grupos]);

  const totalPendente = useMemo(() => grupos.reduce((s, g) => s + g.total, 0), [grupos]);
  const linhasPendentes = useMemo(() => grupos.reduce((s, g) => s + g.n, 0), [grupos]);
  const comEscolha = grupos.filter((g) => escolhas[g.key]).length;

  async function atualizarIds(ids: number[], categoria: string) {
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const { error } = await sb.from("lancamentos").update({ categoria_manual: categoria }).in("id", chunk);
      if (error) throw error;
    }
  }

  async function aplicarUm(g: Grupo) {
    const cat = escolhas[g.key]; if (!cat || busy) return;
    setBusy(true); setMsg(`Aplicando "${cat}" a ${g.n} lançamento(s)...`);
    try { await atualizarIds(g.ids, cat); await reload(); setMsg("Aplicado ✓"); }
    catch (e: any) { setMsg("Erro: " + (e?.message || e)); }
    finally { setBusy(false); }
  }

  async function aplicarTodas() {
    const alvo = grupos.filter((g) => escolhas[g.key]);
    if (!alvo.length || busy) return;
    if (!confirm(`Aplicar categorias a ${alvo.length} estabelecimentos (${alvo.reduce((s, g) => s + g.n, 0)} lançamentos)?`)) return;
    setBusy(true);
    try {
      let feito = 0;
      for (const g of alvo) { setMsg(`Aplicando ${++feito}/${alvo.length}: ${g.ex.slice(0, 30)}...`); await atualizarIds(g.ids, escolhas[g.key]); }
      await reload(); setMsg(`Pronto — ${alvo.length} estabelecimentos classificados ✓`);
    } catch (e: any) { setMsg("Erro: " + (e?.message || e)); }
    finally { setBusy(false); }
  }

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-[14px] mb-5">
        <Kpi title="A classificar" value={BRL(totalPendente)} sub={`${grupos.length} estabelecimentos · ${linhasPendentes} lançamentos`} color="text-amber" />
        <Kpi title="Com sugestão pronta" value={comEscolha} sub="prontos p/ aplicar" color="text-green" />
        <Kpi title="Sem sugestão" value={grupos.length - comEscolha} sub="precisam de escolha" color={grupos.length - comEscolha ? "text-red" : "text-green"} />
        <div className="bg-card border border-line rounded-[18px] p-[18px] shadow-card flex flex-col justify-center gap-2">
          <button disabled={busy || !comEscolha} onClick={aplicarTodas}
            className="bg-accent hover:bg-accent2 disabled:opacity-50 text-white font-medium rounded-[10px] px-4 py-2 cursor-pointer">
            Aplicar todas as sugestões
          </button>
          <div className="text-muted text-[11.5px] min-h-[14px]">{msg}</div>
        </div>
      </div>

      <div className="text-muted text-[12.5px] mb-3 leading-relaxed">
        Cada linha é um <b>estabelecimento</b> (descrições agrupadas), do maior gasto para o menor. A categoria sugerida vem do classificador automático;
        ajuste se precisar e clique em <b>Aplicar</b> — vale para todos os lançamentos daquele estabelecimento. Quando vazio, escolha a categoria. Já classificados saem da lista.
      </div>

      {grupos.length === 0 ? (
        <div className="bg-card border border-line rounded-[18px] p-6 shadow-card text-muted">Tudo classificado nesta visão. 🎉</div>
      ) : (
        <div className="bg-card border border-line rounded-[18px] shadow-card overflow-hidden">
          <div className="max-h-[600px] overflow-auto">
            <table className="w-full min-w-[640px] border-collapse text-[13.5px]">
              <thead><tr className="text-muted text-[11px] uppercase">
                <th className="text-left p-[10px] border-b border-line sticky top-0 bg-card z-[1]">Estabelecimento</th>
                <th className="text-right p-[10px] border-b border-line sticky top-0 bg-card z-[1]">Qtd</th>
                <th className="text-right p-[10px] border-b border-line sticky top-0 bg-card z-[1]">Total</th>
                <th className="text-left p-[10px] border-b border-line sticky top-0 bg-card z-[1]">Categoria</th>
                <th className="p-[10px] border-b border-line sticky top-0 bg-card z-[1]"></th>
              </tr></thead>
              <tbody>
                {grupos.map((g) => (
                  <tr key={g.key}>
                    <td className="text-left p-[10px] border-b border-line max-w-[280px] truncate" title={g.ex}>
                      <button className="text-left hover:text-accent" onClick={() => openModal(g.ex, g.rows)}>{g.ex}</button>
                    </td>
                    <td className="text-right p-[10px] border-b border-line">{g.n}</td>
                    <td className="text-right p-[10px] border-b border-line text-red">{BRL(g.total)}</td>
                    <td className="text-left p-[10px] border-b border-line">
                      <select className="min-w-[150px] px-2 py-[6px] text-[13px] bg-card border border-line rounded-[8px]"
                        value={escolhas[g.key] ?? ""} onChange={(e) => setEscolhas((s) => ({ ...s, [g.key]: e.target.value }))}>
                        {CATEGORIAS.map((c) => <option key={c} value={c}>{c || "— escolher —"}</option>)}
                      </select>
                    </td>
                    <td className="p-[10px] border-b border-line text-center">
                      <button disabled={busy || !escolhas[g.key]} onClick={() => aplicarUm(g)}
                        className="bg-accent hover:bg-accent2 disabled:opacity-40 text-white text-[12px] rounded-[8px] px-3 py-[6px] cursor-pointer">
                        Aplicar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
