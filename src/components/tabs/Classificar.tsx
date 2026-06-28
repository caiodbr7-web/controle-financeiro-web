import { useState, useMemo, useEffect, useRef, useCallback, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { Lancamento } from "../../types";
import { Kpi } from "../ui";
import { CategoryPicker } from "../CategoryPicker";
import { sb } from "../../lib/supabase";
import { BRL0, ehGasto, normEstab } from "../../lib/finance";
import { sugerirGrupo, type FonteSugestao, type Regra, type VinculoPlano } from "../../lib/classificador";
import { useToast } from "../Toast";

interface Props { dados: Lancamento[]; allDados: Lancamento[]; openModal: (t: string, r: Lancamento[]) => void; reload: () => void; }

interface Grupo { key: string; ex: string; ids: number[]; rows: Lancamento[]; total: number; n: number; sugestao: string; fonte: FonteSugestao; conhecido: boolean; }

// selo de procedência da sugestão (de onde veio a categoria proposta)
const FONTE_BADGE: Record<FonteSugestao, { label: string; cls: string } | null> = {
  vinculo: { label: "🔗 vínculo", cls: "bg-green/10 text-green" },
  historico: { label: "🧠 histórico", cls: "bg-green/10 text-green" },
  motor: { label: "⚙️ sugestão do app", cls: "bg-accent/10 text-accent" },
  banco: { label: "🏦 sugestão do banco", cls: "bg-violet/15 text-violet" },
  nenhuma: null,
};

// snapshot p/ desfazer: o que era nulo + a regra que existia antes
interface Snap { ids: number[]; key: string; prevRegra?: string }

export function Classificar({ dados, allDados, openModal, reload }: Props) {
  const { toast } = useToast();
  const [escolhas, setEscolhas] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [regras, setRegras] = useState<Record<string, string>>({}); // padrao(estab) -> categoria (p/ salvar/desfazer)
  const [regrasList, setRegrasList] = useState<Regra[]>([]);         // regras completas (p/ casar por palavra-chave)
  const [planos, setPlanos] = useState<VinculoPlano[]>([]);          // vínculos do Planejamento

  // triagem por teclado / seleção
  const [activeIdx, setActiveIdx] = useState(0);
  const [pickerKey, setPickerKey] = useState<string | null>(null); // linha com o seletor forçado aberto
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulkCat, setBulkCat] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      const { data } = await sb.from("regras").select("padrao,categoria,prioridade,match_type");
      const m: Record<string, string> = {};
      (data || []).forEach((x: any) => { m[x.padrao] = x.categoria; });
      setRegras(m);
      setRegrasList((data || []) as Regra[]);
    })();
    (async () => {
      // vínculos do Planejamento (a tabela pode não existir numa base nova → ignora o erro)
      const { data, error } = await sb.from("planos").select("link_texto,categoria,ativo");
      if (!error) setPlanos((data || []) as VinculoPlano[]);
    })();
  }, []);

  // mantém o mapa (p/ desfazer) e a lista (p/ casar) em sincronia com a regra aprendida
  const aprenderRegra = (key: string, categoria: string) => {
    setRegras((r) => ({ ...r, [key]: categoria }));
    setRegrasList((l) => [...l.filter((x) => x.padrao !== key), { padrao: key, categoria, prioridade: 100, match_type: "contains" }]);
  };
  async function salvarRegra(key: string, categoria: string) {
    if (!key || !categoria) return;
    await sb.from("regras").upsert({ padrao: key, categoria }, { onConflict: "user_id,padrao" });
    aprenderRegra(key, categoria);
  }
  async function restaurarRegra(key: string, prev?: string) {
    if (prev) {
      await sb.from("regras").upsert({ padrao: key, categoria: prev }, { onConflict: "user_id,padrao" });
      aprenderRegra(key, prev);
    } else {
      await sb.from("regras").delete().eq("padrao", key);
      setRegras((r) => { const n = { ...r }; delete n[key]; return n; });
      setRegrasList((l) => l.filter((x) => x.padrao !== key));
    }
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
      if (!g) { g = { key: k, ex: d.descricao, ids: [], rows: [], total: 0, n: 0, sugestao: "", fonte: "nenhuma", conhecido: false }; map.set(k, g); }
      g.ids.push(d.id); g.rows.push(d); g.total += Math.abs(d.valor); g.n++;
    });
    const arr = [...map.values()].map((g) => {
      const sug: Record<string, number> = {};
      g.rows.forEach((d) => { const s = d.categoria_auto || ""; if (s) sug[s] = (sug[s] || 0) + Math.abs(d.valor); });
      const top = Object.keys(sug).sort((a, b) => sug[b] - sug[a])[0] || "";
      const s = sugerirGrupo(g.key, g.ex, top, { regras: regrasList, planos, histMap });
      return { ...g, sugestao: s.categoria, fonte: s.fonte, conhecido: s.conhecido };
    });
    arr.sort((a, b) => b.total - a.total);
    return arr;
  }, [dados, regrasList, planos, histMap]);

  useEffect(() => {
    setEscolhas((prev) => { const i: Record<string, string> = {}; grupos.forEach((g) => { i[g.key] = prev[g.key] ?? g.sugestao; }); return i; });
    setActiveIdx((i) => Math.min(i, Math.max(0, grupos.length - 1)));
    setSel((s) => { const valid = new Set(grupos.map((g) => g.key)); return new Set([...s].filter((k) => valid.has(k))); });
  }, [grupos]);

  const totalPendente = useMemo(() => grupos.reduce((s, g) => s + g.total, 0), [grupos]);
  const linhasPendentes = useMemo(() => grupos.reduce((s, g) => s + g.n, 0), [grupos]);
  const comEscolha = grupos.filter((g) => escolhas[g.key]).length;
  // conhecidos = vínculo do Planejamento + o que você já classificou (1 clique aplica todos)
  const conhecidos = useMemo(() => grupos.filter((g) => g.conhecido && escolhas[g.key]), [grupos, escolhas]);
  const sugeridos = grupos.filter((g) => !g.conhecido && escolhas[g.key]).length;

  async function atualizarIds(ids: number[], categoria: string | null) {
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const { error } = await sb.from("lancamentos").update({ categoria_manual: categoria }).in("id", chunk);
      if (error) throw error;
    }
  }

  // desfaz uma aplicação: volta os lançamentos a "sem categoria" e restaura as regras
  const desfazer = useCallback(async (snap: Snap[]) => {
    setBusy(true);
    try {
      for (const s of snap) { await atualizarIds(s.ids, null); await restaurarRegra(s.key, s.prevRegra); }
      await reload();
      toast({ message: "Classificação desfeita.", variant: "info" });
    } catch (e: any) { toast({ message: "Erro ao desfazer: " + (e?.message || e), variant: "error" }); }
    finally { setBusy(false); }
  }, [reload, toast]);

  // aplica uma categoria a um conjunto de grupos, com toast de desfazer
  async function aplicar(alvo: { g: Grupo; cat: string }[], rotulo: string) {
    if (!alvo.length || busy) return;
    const snap: Snap[] = alvo.map(({ g }) => ({ ids: g.ids, key: g.key, prevRegra: regras[g.key] }));
    setBusy(true);
    try {
      for (const { g, cat } of alvo) { await atualizarIds(g.ids, cat); await salvarRegra(g.key, cat); }
      await reload();
      setSel(new Set());
      toast({ message: rotulo, variant: "success", action: { label: "Desfazer", onClick: () => desfazer(snap) } });
    } catch (e: any) { toast({ message: "Erro: " + (e?.message || e), variant: "error" }); }
    finally { setBusy(false); }
  }

  const aplicarUm = (g: Grupo) => {
    const cat = escolhas[g.key]; if (!cat) return;
    aplicar([{ g, cat }], `“${g.ex.slice(0, 24)}” → ${cat}`);
  };
  const aplicarTodas = () => {
    const alvo = grupos.filter((g) => escolhas[g.key]).map((g) => ({ g, cat: escolhas[g.key] }));
    aplicar(alvo, `${alvo.length} estabelecimentos classificados ✓`);
  };
  const aplicarConhecidos = () => {
    const alvo = conhecidos.map((g) => ({ g, cat: escolhas[g.key] }));
    aplicar(alvo, `${alvo.length} conhecido${alvo.length > 1 ? "s" : ""} classificado${alvo.length > 1 ? "s" : ""} ✓`);
  };
  const marcarRestantesOutros = () => {
    const alvo = grupos.filter((g) => !escolhas[g.key]).map((g) => ({ g, cat: "Outros" }));
    aplicar(alvo, `${alvo.length} marcados como Outros`);
  };
  const aplicarSelecionados = () => {
    if (!bulkCat) return;
    const alvo = grupos.filter((g) => sel.has(g.key)).map((g) => ({ g, cat: bulkCat }));
    aplicar(alvo, `${alvo.length} selecionados → ${bulkCat}`);
    setBulkCat("");
  };

  // ---------- teclado: ↑/↓ navega · Enter abre seletor · espaço seleciona · A aplica ----------
  function rolarParaAtivo(i: number) {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${i}"]`)?.scrollIntoView({ block: "nearest" });
  }
  function onKey(e: ReactKeyboardEvent) {
    if (!grupos.length || pickerKey) return;
    const g = grupos[activeIdx];
    if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); setActiveIdx((i) => { const n = Math.min(i + 1, grupos.length - 1); rolarParaAtivo(n); return n; }); }
    else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); setActiveIdx((i) => { const n = Math.max(i - 1, 0); rolarParaAtivo(n); return n; }); }
    else if (e.key === "Enter") { e.preventDefault(); if (g) setPickerKey(g.key); }
    else if (e.key === " ") { e.preventDefault(); if (g) setSel((s) => { const n = new Set(s); n.has(g.key) ? n.delete(g.key) : n.add(g.key); return n; }); }
    else if ((e.key === "a" || e.key === "A") && g && escolhas[g.key]) { e.preventDefault(); aplicarUm(g); }
  }
  const voltarFoco = () => { setPickerKey(null); listRef.current?.focus(); };

  const todosSelecionados = grupos.length > 0 && sel.size === grupos.length;

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-[14px] mb-[18px]">
        <Kpi title="A classificar" value={BRL0(totalPendente)} sub={`${grupos.length} estab. · ${linhasPendentes} lançamentos`} color="text-amber" />
        <Kpi title="Conhecidos" value={conhecidos.length} sub="vínculo/histórico · 1 clique" color="text-green" />
        <Kpi title="Sugeridos" value={sugeridos} sub="motor/banco · confira" color={sugeridos ? "text-accent" : "text-muted"} />
        <div className="bg-card border border-line rounded-[18px] p-4 shadow-card flex flex-col justify-center gap-2 min-w-0">
          <button disabled={busy || !conhecidos.length} onClick={aplicarConhecidos} className="btn-primary w-full" title="Aplica os vínculos do Planejamento e o que você já classificou antes">
            Aplicar conhecidos{conhecidos.length ? ` (${conhecidos.length})` : ""}
          </button>
          <div className="flex gap-2">
            <button disabled={busy || !comEscolha} onClick={aplicarTodas} className="btn-ghost flex-1 !py-[7px] !text-[12px]" title="Aplica também as sugestões do motor e do banco">Aplicar todas</button>
            <button disabled={busy || grupos.length === comEscolha} onClick={marcarRestantesOutros} className="btn-ghost flex-1 !py-[7px] !text-[12px]">Restantes: Outros</button>
          </div>
        </div>
      </div>

      <div className="text-muted text-[12.5px] mb-3 leading-relaxed">
        Cada linha é um <b>estabelecimento</b> (descrições agrupadas), do maior gasto pro menor. Defina a <b>categoria</b> (use <b>Corporativo</b> para trabalho)
        e clique <b>Aplicar</b> — vale pra todos os lançamentos do grupo, vira sugestão e dá pra <b>desfazer</b>.
        <br />Os <b className="text-green">conhecidos</b> (🔗 vínculo do Planejamento e 🧠 o que você já classificou) vão todos de uma vez em <b>Aplicar conhecidos</b>. Os <b className="text-accent">sugeridos</b> (⚙️ motor do app e 🏦 categoria do banco) vêm pré-preenchidos pra você confirmar.
        <span className="hidden sm:inline"> Pelo teclado: <kbd className="kbd">↑</kbd><kbd className="kbd">↓</kbd> navega, <kbd className="kbd">Enter</kbd> escolhe categoria, <kbd className="kbd">espaço</kbd> seleciona, <kbd className="kbd">A</kbd> aplica.</span>
      </div>

      {grupos.length === 0 ? (
        <div className="bg-card border border-line rounded-[18px] p-6 shadow-card flex items-center gap-2 text-green text-[14px]">
          <span className="w-[22px] h-[22px] rounded-full bg-green/10 flex items-center justify-center text-[12px]">✓</span>
          Tudo classificado nesta visão. 🎉
        </div>
      ) : (
        <div className="bg-card border border-line rounded-[18px] shadow-card overflow-hidden">
          {/* cabeçalho: selecionar todos + barra de ação em massa */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 sm:px-4 py-[10px] border-b border-line bg-card2/60">
            <label className="flex items-center gap-2 text-[12.5px] text-muted cursor-pointer select-none">
              <input
                type="checkbox"
                checked={todosSelecionados}
                ref={(el) => { if (el) el.indeterminate = sel.size > 0 && !todosSelecionados; }}
                onChange={() => setSel(todosSelecionados ? new Set() : new Set(grupos.map((g) => g.key)))}
                className="accent-accent w-[15px] h-[15px]"
              />
              {sel.size > 0 ? `${sel.size} selecionado${sel.size > 1 ? "s" : ""}` : "Selecionar tudo"}
            </label>
            {sel.size > 0 && (
              <div className="flex flex-wrap items-center gap-2 ml-auto">
                <CategoryPicker value={bulkCat} onSelect={setBulkCat} placeholder="Categoria…" />
                <button disabled={busy || !bulkCat} onClick={aplicarSelecionados} className="btn-primary !py-[7px] !px-3 !text-[12.5px]">
                  Aplicar aos {sel.size}
                </button>
                <button onClick={() => setSel(new Set())} className="btn-ghost !py-[7px] !px-3 !text-[12.5px]">Limpar</button>
              </div>
            )}
          </div>

          <div
            ref={listRef}
            tabIndex={0}
            onKeyDown={onKey}
            role="listbox"
            aria-label="Estabelecimentos a classificar"
            className="max-h-[600px] overflow-auto scroll-thin outline-none divide-y divide-line"
          >
            {grupos.map((g, i) => {
              const ativo = i === activeIdx;
              const selecionado = sel.has(g.key);
              const cat = escolhas[g.key] || "";
              return (
                <div
                  key={g.key}
                  data-idx={i}
                  role="option"
                  aria-selected={selecionado}
                  onMouseDown={() => setActiveIdx(i)}
                  className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-3 sm:px-4 py-[11px] transition-colors ${ativo ? "bg-fill/70" : "hover:bg-fill/30"}`}
                >
                  <input
                    type="checkbox"
                    checked={selecionado}
                    onChange={() => setSel((s) => { const n = new Set(s); n.has(g.key) ? n.delete(g.key) : n.add(g.key); return n; })}
                    onMouseDown={(e) => e.stopPropagation()}
                    aria-label={`Selecionar ${g.ex}`}
                    className="accent-accent w-[15px] h-[15px] shrink-0"
                  />
                  <button
                    className="min-w-0 flex-1 text-left bg-transparent border-0 p-0 cursor-pointer group"
                    onClick={() => openModal(g.ex, g.rows)}
                    title="Ver lançamentos do grupo"
                  >
                    <div className="text-[13.5px] font-medium truncate group-hover:text-accent transition-colors">{g.ex}</div>
                    <div className="text-[11.5px] text-muted">
                      {g.n} {g.n === 1 ? "lançamento" : "lançamentos"} · <span className="text-red tabular-nums">{BRL0(g.total)}</span>
                      {cat
                        ? (FONTE_BADGE[g.fonte] && <span className={`ml-2 inline-flex items-center rounded-full px-[7px] py-[1px] text-[10.5px] font-semibold ${FONTE_BADGE[g.fonte]!.cls}`}>{FONTE_BADGE[g.fonte]!.label}</span>)
                        : <span className="ml-2 inline-flex items-center rounded-full bg-amber/10 text-amber px-[7px] py-[1px] text-[10.5px] font-semibold">sem sugestão</span>}
                    </div>
                  </button>
                  <div className="flex items-center gap-2 shrink-0 ml-auto" onMouseDown={(e) => e.stopPropagation()}>
                    <CategoryPicker
                      key={pickerKey === g.key ? `open-${g.key}` : g.key}
                      value={cat}
                      autoOpen={pickerKey === g.key}
                      onClose={voltarFoco}
                      onSelect={(c) => setEscolhas((s) => ({ ...s, [g.key]: c }))}
                    />
                    <button
                      disabled={busy || !cat}
                      onClick={() => aplicarUm(g)}
                      className="btn bg-accent hover:bg-accent2 text-white text-[12px] rounded-[8px] px-3 py-[6px] border-0 disabled:opacity-40"
                    >
                      Aplicar
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
