import { useState, useMemo, useEffect } from "react";
import type { Lancamento } from "../../types";
import { Kpi } from "../ui";
import { sb } from "../../lib/supabase";
import { BRL, ehGasto, normEstab, CATEGORIAS } from "../../lib/finance";

interface Props { dados: Lancamento[]; allDados: Lancamento[]; openModal: (t: string, r: Lancamento[]) => void; reload: () => void; }

interface Grupo { key: string; ex: string; ids: number[]; rows: Lancamento[]; total: number; n: number; sugestao: string; }

export function Classificar({ dados, allDados, openModal, reload }: Props) {
  const [escolhas, setEscolhas] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [regras, setRegras] = useState<Record<string, string>>({}); // padrao(estab) -> categoria aprendida

  useEffect(() => {
    (async () => {
      const { data } = await sb.from("regras").select("padrao,categoria");
      const m: Record<string, string> = {};
      (data || []).forEach((x: any) => { m[x.padrao] = x.categoria; });
      setRegras(m);
    })();
  }, []);

  async function salvarRegra(key: string, categoria: string) {
    if (!key || !categoria) return;
    await sb.from("regras").upsert({ padrao: key, categoria }, { onConflict: "user_id,padrao" });
    setRegras((r) => ({ ...r, [key]: categoria }));
  }

  // histórico já classificado: estabelecimento -> categoria mais usada (aprende do passado)
  const histMap = useMemo(() => {
    const cnt: Record<string, Record<string, number>> = {};
    allDados.forEach((d) => {
      if (!ehGasto(d.classe) || !d.categoria_manual) return;
      const k = normEstab(d.descricao);
      (cnt[k] = cnt[k] || {})[d.categoria_manual] = (cnt[k][d.categoria_manual] || 0) + 1;
    });
    const m: Record<string, string> = {};
    Object.keys(cnt).forEach((k) => { m[k] = Object.keys(cnt[k]).sort((a, b) => cnt[k][b] - cnt[k][a])[0]; });
    return m;
  }, [allDados]);

  // grupos de gastos AINDA sem categoria, por estabelecimento, ordenados por valor
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
      // prioridade: regra salva -> categoria mais usada no histórico p/ esse estabelecimento -> palpite do parser
      const hist = histMap[g.key];
      const sugestao = regras[g.key] || (hist && CATEGORIAS.includes(hist) ? hist : "") || (CATEGORIAS.includes(top) ? top : "");
      return { ...g, sugestao };
    });
    arr.sort((a, b) => b.total - a.total);
    return arr;
  }, [dados, regras, histMap]);

  useEffect(() => {
    setEscolhas((prev) => { const i: Record<string, string> = {}; grupos.forEach((g) => { i[g.key] = prev[g.key] ?? g.sugestao; }); return i; });
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
    try { await atualizarIds(g.ids, cat); await salvarRegra(g.key, cat); await reload(); setMsg("Aplicado ✓ (virou sugestão p/ os próximos)"); }
    catch (e: any) { setMsg("Erro: " + (e?.message || e)); }
    finally { setBusy(false); }
  }

  async function marcarRestantesOutros() {
    const alvo = grupos.filter((g) => !escolhas[g.key]); // só os ainda sem categoria escolhida
    if (!alvo.length || busy) return;
    if (!confirm(`Marcar ${alvo.length} estabelecimentos restantes como "Outros" (${alvo.reduce((s, g) => s + g.n, 0)} lançamentos)?`)) return;
    setBusy(true);
    try {
      let feito = 0;
      for (const g of alvo) { setMsg(`Outros ${++feito}/${alvo.length}...`); await atualizarIds(g.ids, "Outros"); }
      await reload(); setMsg(`Pronto — ${alvo.length} marcados como Outros ✓`);
    } catch (e: any) { setMsg("Erro: " + (e?.message || e)); }
    finally { setBusy(false); }
  }

  async function aplicarTodas() {
    const alvo = grupos.filter((g) => escolhas[g.key]);
    if (!alvo.length || busy) return;
    if (!confirm(`Aplicar categoria a ${alvo.length} estabelecimentos (${alvo.reduce((s, g) => s + g.n, 0)} lançamentos)?`)) return;
    setBusy(true);
    try {
      let feito = 0;
      for (const g of alvo) { setMsg(`Aplicando ${++feito}/${alvo.length}: ${g.ex.slice(0, 28)}...`); await atualizarIds(g.ids, escolhas[g.key]); await salvarRegra(g.key, escolhas[g.key]); }
      await reload(); setMsg(`Pronto — ${alvo.length} estabelecimentos ✓`);
    } catch (e: any) { setMsg("Erro: " + (e?.message || e)); }
    finally { setBusy(false); }
  }

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-[14px] mb-[18px]">
        <Kpi title="A classificar" value={BRL(totalPendente)} sub={`${grupos.length} estab. · ${linhasPendentes} lançamentos`} color="text-amber" />
        <Kpi title="Com sugestão" value={comEscolha} sub="prontos p/ aplicar" color="text-green" />
        <Kpi title="Sem sugestão" value={grupos.length - comEscolha} sub="precisam de escolha" color={grupos.length - comEscolha ? "text-red" : "text-green"} />
        <div className="bg-card border border-line rounded-[18px] p-4 shadow-card flex flex-col justify-center gap-2 min-w-0">
          <button disabled={busy || !comEscolha} onClick={aplicarTodas} className="btn-primary w-full">
            Aplicar todas as sugestões
          </button>
          <button disabled={busy || grupos.length === comEscolha} onClick={marcarRestantesOutros} className="btn-ghost w-full !py-[7px] !text-[12.5px]">
            Marcar restantes como Outros
          </button>
          <div className="text-muted text-[11.5px] min-h-[14px]">{msg}</div>
        </div>
      </div>

      <div className="text-muted text-[12.5px] mb-3 leading-relaxed">
        Cada linha é um <b>estabelecimento</b> (descrições agrupadas), do maior gasto pro menor. Defina a <b>categoria</b> (use <b>Corporativo</b> para gastos de trabalho)
        e clique <b>Aplicar</b> — vale para todos os lançamentos do grupo. <b>Aplicar todas as sugestões</b> resolve o grosso de uma vez. Já classificados saem da lista.
      </div>

      {grupos.length === 0 ? (
        <div className="bg-card border border-line rounded-[18px] p-6 shadow-card text-muted">Tudo classificado nesta visão. 🎉</div>
      ) : (
        <div className="bg-card border border-line rounded-[18px] shadow-card overflow-hidden">
          <div className="max-h-[600px] overflow-auto scroll-thin">
            <table className="tbl min-w-[640px]">
              <thead><tr>
                <th className="sticky top-0 bg-card z-[1]">Estabelecimento</th>
                <th className="sticky top-0 bg-card z-[1] num">Qtd</th>
                <th className="sticky top-0 bg-card z-[1] num">Total</th>
                <th className="sticky top-0 bg-card z-[1]">Categoria</th>
                <th className="sticky top-0 bg-card z-[1]"></th>
              </tr></thead>
              <tbody>
                {grupos.map((g) => (
                  <tr key={g.key}>
                    <td className="max-w-[280px] truncate" title={g.ex}>
                      <button className="text-left bg-transparent border-0 p-0 cursor-pointer text-txt hover:text-accent transition-colors" onClick={() => openModal(g.ex, g.rows)}>{g.ex}</button>
                    </td>
                    <td className="num">{g.n}</td>
                    <td className="num text-red">{BRL(g.total)}</td>
                    <td>
                      <select className="select-chev min-w-[150px] pl-2 py-[6px] text-[13px] bg-card text-txt border border-line rounded-[8px] cursor-pointer outline-none"
                        value={escolhas[g.key] ?? ""} onChange={(e) => setEscolhas((s) => ({ ...s, [g.key]: e.target.value }))}>
                        {CATEGORIAS.map((c) => <option key={c} value={c}>{c || "— escolher —"}</option>)}
                      </select>
                    </td>
                    <td className="!text-center">
                      <button disabled={busy || !escolhas[g.key]} onClick={() => aplicarUm(g)}
                        className="btn bg-accent hover:bg-accent2 text-white text-[12px] rounded-[8px] px-3 py-[6px] border-0">
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
