import { useState, useMemo, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { Lancamento, PatchLocal, Mutate, Enqueue } from "../../types";
import { Kpi, Legenda } from "../ui";
import { CategoryPicker } from "../CategoryPicker";
import { sb } from "../../lib/supabase";
import { BRL0, ehGasto, ehReceita, ehTransfer, normEstab, precisaClassificar } from "../../lib/finance";
import { ehInterna, ehReceitaInvest } from "../../lib/lancClasses";
import { sugerirGrupo, type FonteSugestao, type Regra, type VinculoPlano, type FolhaHist } from "../../lib/classificador";
import { useToast } from "../Toast";
import { useCategorias } from "../../lib/categorias";

interface Props {
  dados: Lancamento[]; allDados: Lancamento[];
  openModal: (t: string, r: Lancamento[]) => void; reload: () => void;
  patchLocal: PatchLocal; mutate: Mutate; enqueue: Enqueue;
}

interface Grupo { key: string; ex: string; ids: number[]; rows: Lancamento[]; total: number; n: number; sugestao: string; sugestaoSub: string; fonte: FonteSugestao; conhecido: boolean; internaSug: boolean; receita: boolean; rinvest: boolean; rotuloReceita: string; }

// pistas de que um grupo é "provavelmente entre contas próprias" pelos próprios
// lançamentos (classe de transferência ou subtipo de movimento interno).
const RE_SUBTIPO_INTERNA = /fatura|entre contas|aporte|resgate|transfer/i;
const rowsParecemInternas = (rows: Lancamento[]) =>
  rows.some((d) => ehTransfer(d.classe) || RE_SUBTIPO_INTERNA.test(d.subtipo || ""));

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

export function Classificar({ dados, allDados, openModal, mutate }: Props) {
  const { toast } = useToast();
  const { categorias } = useCategorias();
  // categorias que TÊM subcategoria: nelas a classificação exige escolher uma sub
  // (nenhuma categoria com sub recebe valores dedicados a ela).
  const catComSub = useMemo(
    () => new Set(categorias.filter((c) => c.subs.length > 0).map((c) => c.nome)),
    [categorias]
  );
  // folha válida p/ gravar: categoria sem sub, ou categoria com sub E uma sub escolhida
  const folhaValida = (cat: string, sub?: string | null) => !!cat && (!catComSub.has(cat) || !!sub);
  const [escolhas, setEscolhas] = useState<Record<string, string>>({});
  // subcategoria escolhida por grupo (opcional; sempre subordinada à categoria escolhida)
  const [escolhasSub, setEscolhasSub] = useState<Record<string, string>>({});
  // grupos que o usuário (ou a sugestão) marcou como "entre contas próprias".
  // É só uma ESCOLHA pendente: nada é gravado até apertar Aplicar / Aplicar conhecidos.
  const [escolhaInterna, setEscolhaInterna] = useState<Record<string, boolean>>({});
  // ações agora são OTIMISTAS: a UI atualiza na hora e a escrita vai p/ a fila
  // em background — nada trava o produto, então não há mais estado `busy`.
  const busy = false;
  const [regras, setRegras] = useState<Record<string, string>>({}); // padrao(estab) -> categoria (p/ salvar/desfazer)
  const [regrasList, setRegrasList] = useState<Regra[]>([]);         // regras completas (p/ casar por palavra-chave)
  const [planos, setPlanos] = useState<VinculoPlano[]>([]);          // vínculos do Planejamento

  // triagem por teclado / seleção
  const [activeIdx, setActiveIdx] = useState(0);
  const [pickerKey, setPickerKey] = useState<string | null>(null); // linha com o seletor forçado aberto
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulkCat, setBulkCat] = useState("");
  const [bulkSub, setBulkSub] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      const { data } = await sb.from("regras").select("padrao,categoria,subcategoria,prioridade,match_type");
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

  // ---- regras aprendidas (padrão do estabelecimento -> categoria) ----
  // O aprendizado é LOCAL e imediato (mexe só nas sugestões futuras); a escrita
  // no banco vai para a fila, separada, para não bloquear a ação principal.
  const aprenderRegraLocal = (key: string, categoria: string, subcategoria?: string | null) => {
    setRegras((r) => ({ ...r, [key]: categoria }));
    setRegrasList((l) => [...l.filter((x) => x.padrao !== key), { padrao: key, categoria, subcategoria: subcategoria || null, prioridade: 100, match_type: "contains" }]);
  };
  const esquecerRegraLocal = (key: string) => {
    setRegras((r) => { const n = { ...r }; delete n[key]; return n; });
    setRegrasList((l) => l.filter((x) => x.padrao !== key));
  };
  // restaura a regra local ao estado anterior (usado no rollback / desfazer)
  const restaurarRegraLocal = (key: string, prev?: string) =>
    prev ? aprenderRegraLocal(key, prev) : esquecerRegraLocal(key);
  // escritas no banco (sem tocar no estado local — quem chama já cuidou disso)
  const salvarRegraDB = (key: string, categoria: string, subcategoria?: string | null) =>
    sb.from("regras").upsert({ padrao: key, categoria, subcategoria: subcategoria || null }, { onConflict: "user_id,padrao" }).then(() => {});
  const restaurarRegraDB = (key: string, prev?: string) =>
    (prev
      ? sb.from("regras").upsert({ padrao: key, categoria: prev }, { onConflict: "user_id,padrao" })
      : sb.from("regras").delete().eq("padrao", key)
    ).then(() => {});

  const erroToast = (e: unknown) =>
    toast({ message: "Erro ao salvar: " + ((e as { message?: string })?.message || e), variant: "error" });

  // histórico já classificado: estabelecimento -> FOLHA mais usada (categoria + sub).
  // A chave de contagem é "categoria//sub" para aprender também a subcategoria.
  const histMap = useMemo(() => {
    const cnt: Record<string, Record<string, number>> = {};
    allDados.forEach((d) => {
      if (!ehGasto(d.classe) || !d.categoria_manual) return;
      const k = normEstab(d.descricao);
      const folha = `${d.categoria_manual}//${d.subcategoria_manual || ""}`;
      (cnt[k] = cnt[k] || {})[folha] = (cnt[k][folha] || 0) + 1;
    });
    const m: Record<string, FolhaHist> = {};
    Object.keys(cnt).forEach((k) => {
      const top = Object.keys(cnt[k]).sort((a, b) => cnt[k][b] - cnt[k][a])[0];
      const [categoria, sub] = top.split("//");
      m[k] = { categoria, subcategoria: sub || null };
    });
    return m;
  }, [allDados]);

  // estabelecimentos que você JÁ SABE serem entre contas próprias: qualquer um que
  // já apareça como interno no histórico (marcado por você ou detectado). Serve p/
  // pré-marcar novos lançamentos do mesmo estabelecimento como "entre contas".
  const histInternaSet = useMemo(() => {
    const s = new Set<string>();
    allDados.forEach((d) => { if (ehInterna(d)) s.add(normEstab(d.descricao)); });
    return s;
  }, [allDados]);

  // grupos de gastos AINDA sem categoria, por estabelecimento, ordenados por valor
  const grupos = useMemo<Grupo[]>(() => {
    const map = new Map<string, Grupo>();
    dados.forEach((d) => {
      if (!precisaClassificar(d)) return;
      const k = normEstab(d.descricao);
      let g = map.get(k);
      if (!g) { g = { key: k, ex: d.descricao, ids: [], rows: [], total: 0, n: 0, sugestao: "", sugestaoSub: "", fonte: "nenhuma", conhecido: false, internaSug: false, receita: false, rinvest: false, rotuloReceita: "Receita" }; map.set(k, g); }
      g.ids.push(d.id); g.rows.push(d); g.total += Math.abs(d.valor); g.n++;
    });
    const arr = [...map.values()].map((g) => {
      const sug: Record<string, number> = {};
      g.rows.forEach((d) => { const s = d.categoria_auto || ""; if (s) sug[s] = (sug[s] || 0) + Math.abs(d.valor); });
      const top = Object.keys(sug).sort((a, b) => sug[b] - sug[a])[0] || "";
      const s = sugerirGrupo(g.key, g.ex, top, { regras: regrasList, planos, histMap });
      const internaSug = histInternaSet.has(g.key) || rowsParecemInternas(g.rows);
      // grupo de receita: só entra receita (nenhum gasto). Rótulo = subtipo mais
      // frequente (ex.: "Salario"), com fallback "Receita".
      const receita = g.rows.some((d) => ehReceita(d.classe)) && !g.rows.some((d) => ehGasto(d.classe));
      // renda de investimento (juros, dividendos, rendimentos): classe própria,
      // confirmável em 1 clique como a receita — não é gasto.
      const rinvest = !receita && g.rows.some((d) => ehReceitaInvest(d.classe)) && !g.rows.some((d) => ehGasto(d.classe));
      const subCnt: Record<string, number> = {};
      g.rows.forEach((d) => { if (d.subtipo) subCnt[d.subtipo] = (subCnt[d.subtipo] || 0) + 1; });
      const rotuloReceita = Object.keys(subCnt).sort((a, b) => subCnt[b] - subCnt[a])[0] || (rinvest ? "Renda de investimento" : "Receita");
      // só é "conhecido" (aplicável em 1 clique) se a sugestão é uma folha válida:
      // categoria sem sub, ou categoria com sub E a sub sugerida junto.
      const conhecido = s.conhecido && folhaValida(s.categoria, s.subcategoria);
      return { ...g, sugestao: s.categoria, sugestaoSub: s.subcategoria, fonte: s.fonte, conhecido, internaSug, receita, rinvest, rotuloReceita };
    });
    arr.sort((a, b) => b.total - a.total);
    return arr;
  }, [dados, regrasList, planos, histMap, histInternaSet, catComSub]);

  useEffect(() => {
    setEscolhas((prev) => { const i: Record<string, string> = {}; grupos.forEach((g) => { i[g.key] = prev[g.key] ?? g.sugestao; }); return i; });
    // pré-preenche a subcategoria sugerida (folha) junto da categoria
    setEscolhasSub((prev) => { const i: Record<string, string> = {}; grupos.forEach((g) => { const v = prev[g.key] ?? g.sugestaoSub; if (v) i[g.key] = v; }); return i; });
    // pré-marca "entre contas próprias" nos grupos que já sabemos serem internos
    // (histórico/transferência) — fica só selecionado, à espera do Aplicar.
    setEscolhaInterna((prev) => { const i: Record<string, boolean> = {}; grupos.forEach((g) => { i[g.key] = prev[g.key] ?? g.internaSug; }); return i; });
    setActiveIdx((i) => Math.min(i, Math.max(0, grupos.length - 1)));
    setSel((s) => { const valid = new Set(grupos.map((g) => g.key)); return new Set([...s].filter((k) => valid.has(k))); });
  }, [grupos]);

  const totalPendente = useMemo(() => grupos.reduce((s, g) => s + g.total, 0), [grupos]);
  const linhasPendentes = useMemo(() => grupos.reduce((s, g) => s + g.n, 0), [grupos]);
  const comEscolha = grupos.filter((g) => escolhas[g.key] || escolhaInterna[g.key]).length;
  // conhecidos = o que já sabemos resolver de uma vez em 1 clique:
  //  · categoria conhecida (vínculo do Planejamento / histórico), quando NÃO marcado interno;
  //  · movimento entre contas próprias já reconhecido (histórico/transferência), ainda marcado.
  const conhecidosCat = useMemo(
    () => grupos.filter((g) => !escolhaInterna[g.key] && g.conhecido && escolhas[g.key]),
    [grupos, escolhas, escolhaInterna]
  );
  const conhecidosInterna = useMemo(
    () => grupos.filter((g) => escolhaInterna[g.key] && g.internaSug),
    [grupos, escolhaInterna]
  );
  const conhecidos = useMemo(() => [...conhecidosCat, ...conhecidosInterna], [conhecidosCat, conhecidosInterna]);
  const sugeridos = grupos.filter((g) => !escolhaInterna[g.key] && !g.conhecido && escolhas[g.key]).length;

  // escrita crua no banco (chunked): categoria_manual (+ subcategoria) dos lançamentos
  async function dbCategoria(ids: number[], categoria: string | null, sub: string | null = null) {
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await sb.from("lancamentos")
        .update({ categoria_manual: categoria, subcategoria_manual: categoria ? sub : null })
        .in("id", ids.slice(i, i + 200));
      if (error) throw error;
    }
  }
  // escrita crua no banco (chunked): interna_manual + interna efetivo
  async function dbInterna(ids: number[], valor: boolean | null) {
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await sb.from("lancamentos")
        .update({ interna_manual: valor, interna: valor ?? false })
        .in("id", ids.slice(i, i + 200));
      if (error) throw error;
    }
  }

  // desfaz uma aplicação: volta os lançamentos a "sem categoria" e restaura as
  // regras — tudo otimista (some/reaparece na hora) + escrita em fila.
  const desfazer = (snap: Snap[]) => {
    snap.forEach((s) => {
      restaurarRegraLocal(s.key, s.prevRegra);
      mutate({
        ids: s.ids,
        patch: { categoria_manual: null, subcategoria_manual: null },
        persist: async () => { await dbCategoria(s.ids, null); await restaurarRegraDB(s.key, s.prevRegra); },
        onError: erroToast,
      });
    });
    toast({ message: "Classificação desfeita.", variant: "info" });
  };

  // aplica uma categoria (e sub opcional) a um conjunto de grupos, com toast de
  // desfazer. OTIMISTA: a linha recebe a categoria na hora (e sai das pendências);
  // a gravação no banco vai para a fila e, se falhar, o patch é revertido.
  function aplicar(alvo: { g: Grupo; cat: string; sub?: string | null }[], rotulo: string) {
    if (!alvo.length) return;
    const snap: Snap[] = alvo.map(({ g }) => ({ ids: g.ids, key: g.key, prevRegra: regras[g.key] }));
    alvo.forEach(({ g, cat, sub }) => {
      const prevRegra = regras[g.key];
      aprenderRegraLocal(g.key, cat, sub);
      mutate({
        ids: g.ids,
        patch: { categoria_manual: cat, subcategoria_manual: sub || null },
        persist: async () => { await dbCategoria(g.ids, cat, sub || null); await salvarRegraDB(g.key, cat, sub); },
        onError: (e) => { restaurarRegraLocal(g.key, prevRegra); erroToast(e); },
      });
    });
    setSel(new Set());
    toast({ message: rotulo, variant: "success", action: { label: "Desfazer", onClick: () => desfazer(snap) } });
  }

  // desfaz a marcação "entre contas próprias": volta interna_manual a null e interna a false
  const desfazerInterna = (ids: number[]) => {
    mutate({
      ids,
      patch: { interna_manual: null, interna: false },
      persist: () => dbInterna(ids, null),
      onError: erroToast,
    });
    toast({ message: "Marcação desfeita.", variant: "info" });
  };

  // marca um conjunto de grupos como "entre contas próprias", com toast de desfazer
  function marcarInterna(alvo: Grupo[], rotulo: string) {
    if (!alvo.length) return;
    const ids = alvo.flatMap((g) => g.ids);
    mutate({
      ids,
      patch: { interna_manual: true, interna: true },
      persist: () => dbInterna(ids, true),
      onError: erroToast,
    });
    setSel(new Set());
    toast({ message: rotulo, variant: "success", action: { label: "Desfazer", onClick: () => desfazerInterna(ids) } });
  }

  const marcarInternaUm = (g: Grupo) =>
    marcarInterna([g], `“${g.ex.slice(0, 24)}” → entre contas próprias`);
  const marcarInternaSelecionados = () => {
    const alvo = grupos.filter((g) => sel.has(g.key));
    if (!alvo.length) return;
    marcarInterna(alvo, `${alvo.length} marcados como entre contas próprias`);
  };

  // aplica em lote resoluções MISTAS numa só passada, com um único desfazer que
  // reverte tudo: categorias (catAlvo) + marcações "entre contas próprias" (internaAlvo).
  function aplicarLote(catAlvo: { g: Grupo; cat: string; sub?: string | null }[], internaAlvo: Grupo[], rotulo: string) {
    if (!catAlvo.length && !internaAlvo.length) return;
    const snap: Snap[] = catAlvo.map(({ g }) => ({ ids: g.ids, key: g.key, prevRegra: regras[g.key] }));
    const internaIds = internaAlvo.flatMap((g) => g.ids);
    catAlvo.forEach(({ g, cat, sub }) => {
      const prevRegra = regras[g.key];
      aprenderRegraLocal(g.key, cat, sub);
      mutate({
        ids: g.ids,
        patch: { categoria_manual: cat, subcategoria_manual: sub || null },
        persist: async () => { await dbCategoria(g.ids, cat, sub || null); await salvarRegraDB(g.key, cat, sub); },
        onError: (e) => { restaurarRegraLocal(g.key, prevRegra); erroToast(e); },
      });
    });
    if (internaIds.length) mutate({
      ids: internaIds,
      patch: { interna_manual: true, interna: true },
      persist: () => dbInterna(internaIds, true),
      onError: erroToast,
    });
    setSel(new Set());
    const desfazerLote = () => {
      snap.forEach((s) => {
        restaurarRegraLocal(s.key, s.prevRegra);
        mutate({
          ids: s.ids,
          patch: { categoria_manual: null, subcategoria_manual: null },
          persist: async () => { await dbCategoria(s.ids, null); await restaurarRegraDB(s.key, s.prevRegra); },
          onError: erroToast,
        });
      });
      if (internaIds.length) mutate({
        ids: internaIds,
        patch: { interna_manual: null, interna: false },
        persist: () => dbInterna(internaIds, null),
        onError: erroToast,
      });
      toast({ message: "Classificação desfeita.", variant: "info" });
    };
    toast({ message: rotulo, variant: "success", action: { label: "Desfazer", onClick: desfazerLote } });
  }

  const aplicarUm = (g: Grupo) => {
    if (escolhaInterna[g.key]) { marcarInternaUm(g); return; }
    const cat = escolhas[g.key]; if (!cat) return;
    const sub = escolhasSub[g.key] || null;
    if (!folhaValida(cat, sub)) {
      toast({ message: `“${cat}” tem subcategorias — escolha uma para classificar.`, variant: "error" });
      setPickerKey(g.key); // abre o seletor para escolher a sub
      return;
    }
    aplicar([{ g, cat, sub }], `“${g.ex.slice(0, 24)}” → ${cat}${sub ? ` › ${sub}` : ""}`);
  };
  const aplicarTodas = () => {
    const internaAlvo = grupos.filter((g) => escolhaInterna[g.key]);
    const catAlvo = grupos
      .filter((g) => !escolhaInterna[g.key] && escolhas[g.key])
      .map((g) => ({ g, cat: escolhas[g.key], sub: escolhasSub[g.key] || null }))
      .filter((x) => folhaValida(x.cat, x.sub)); // pula categorias com sub sem sub escolhida
    const n = internaAlvo.length + catAlvo.length;
    aplicarLote(catAlvo, internaAlvo, `${n} estabelecimento${n > 1 ? "s" : ""} resolvido${n > 1 ? "s" : ""} ✓`);
  };
  const aplicarConhecidos = () => {
    const catAlvo = conhecidosCat
      .map((g) => ({ g, cat: escolhas[g.key], sub: escolhasSub[g.key] || null }))
      .filter((x) => folhaValida(x.cat, x.sub));
    const n = catAlvo.length + conhecidosInterna.length;
    aplicarLote(catAlvo, conhecidosInterna, `${n} conhecido${n > 1 ? "s" : ""} aplicado${n > 1 ? "s" : ""} ✓`);
  };
  const marcarRestantesOutros = () => {
    const alvo = grupos.filter((g) => !escolhas[g.key] && !escolhaInterna[g.key]).map((g) => ({ g, cat: "Outros" }));
    aplicar(alvo, `${alvo.length} marcados como Outros`);
  };
  // alterna a escolha "entre contas próprias" de um grupo (sem gravar nada ainda)
  const toggleInterna = (key: string) =>
    setEscolhaInterna((s) => ({ ...s, [key]: !s[key] }));

  // confirma um grupo de RECEITA sem exigir categoria de despesa: grava o subtipo
  // (ex.: "Salario") como categoria_manual, tirando-o das pendências. Reaproveita o
  // fluxo `aplicar` — aprende a regra (pré-preenche no próximo mês) e dá desfazer.
  const confirmarReceita = (g: Grupo) =>
    aplicar([{ g, cat: g.rotuloReceita }], `“${g.ex.slice(0, 24)}” → ${g.rotuloReceita}`);
  const confirmarReceitasSelecionados = () => {
    const alvo = grupos.filter((g) => sel.has(g.key) && (g.receita || g.rinvest)).map((g) => ({ g, cat: g.rotuloReceita }));
    if (!alvo.length) return;
    aplicar(alvo, `${alvo.length} receita${alvo.length > 1 ? "s" : ""} confirmada${alvo.length > 1 ? "s" : ""} ✓`);
  };
  const selReceitas = grupos.filter((g) => sel.has(g.key) && (g.receita || g.rinvest)).length;
  // bulkCat (quando escolhido) sobrepõe todos; senão, usa a categoria de cada linha.
  // pula os selecionados que ainda não têm categoria nenhuma.
  const aplicarSelecionados = () => {
    const alvo = grupos
      .filter((g) => sel.has(g.key))
      .map((g) => ({ g, cat: bulkCat || escolhas[g.key], sub: bulkCat ? bulkSub : escolhasSub[g.key] || null }))
      .filter((x) => folhaValida(x.cat, x.sub));
    if (!alvo.length) return;
    aplicar(alvo, bulkCat ? `${alvo.length} selecionados → ${bulkCat}${bulkSub ? ` › ${bulkSub}` : ""}` : `${alvo.length} selecionados classificados ✓`);
    setBulkCat(""); setBulkSub(null);
  };

  // ---------- teclado: ↑/↓ navega · Enter abre seletor · espaço seleciona · A aplica ----------
  function rolarParaAtivo(i: number) {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${i}"]`)?.scrollIntoView({ block: "nearest" });
  }
  function onKey(e: ReactKeyboardEvent) {
    if (!grupos.length || pickerKey) return;
    // não sequestra a digitação quando o foco está num campo editável (ex.: o
    // seletor de categoria aberto por clique) — deixa a tecla ir pro input.
    const alvo = e.target as HTMLElement;
    if (alvo && (alvo.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName))) return;
    const g = grupos[activeIdx];
    if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); setActiveIdx((i) => { const n = Math.min(i + 1, grupos.length - 1); rolarParaAtivo(n); return n; }); }
    else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); setActiveIdx((i) => { const n = Math.max(i - 1, 0); rolarParaAtivo(n); return n; }); }
    else if (e.key === "Enter") { e.preventDefault(); if (g) setPickerKey(g.key); }
    else if (e.key === " ") { e.preventDefault(); if (g) setSel((s) => { const n = new Set(s); n.has(g.key) ? n.delete(g.key) : n.add(g.key); return n; }); }
    else if ((e.key === "a" || e.key === "A") && g && (escolhas[g.key] || escolhaInterna[g.key])) { e.preventDefault(); aplicarUm(g); }
    else if ((e.key === "e" || e.key === "E") && g) { e.preventDefault(); toggleInterna(g.key); }
  }
  const voltarFoco = () => { setPickerKey(null); listRef.current?.focus(); };

  const todosSelecionados = grupos.length > 0 && sel.size === grupos.length;
  // selecionados que têm categoria pra aplicar (a da linha, ou bulkCat sobrepondo todos)
  const selAplicaveis = grupos.filter((g) => sel.has(g.key) && (bulkCat || escolhas[g.key])).length;

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-[14px] mb-[18px]">
        <Kpi title="A classificar" value={BRL0(totalPendente)} sub={`${grupos.length} estab. · ${linhasPendentes} lançamentos`} color="text-amber" />
        <Kpi title="Conhecidos" value={conhecidos.length} sub={conhecidosInterna.length ? `${conhecidosInterna.length} entre contas · 1 clique` : "vínculo/histórico · 1 clique"} color="text-green" />
        <Kpi title="Sugeridos" value={sugeridos} sub="motor/banco · confira" color={sugeridos ? "text-accent" : "text-muted"} />
        <div className="bg-card border border-line rounded-[18px] p-4 shadow-card flex flex-col justify-center gap-2 min-w-0">
          <button disabled={busy || !conhecidos.length} onClick={aplicarConhecidos} className="btn-primary w-full" title="Aplica categorias conhecidas (vínculo/histórico) e as transferências entre contas próprias já reconhecidas">
            Aplicar conhecidos{conhecidos.length ? ` (${conhecidos.length})` : ""}
          </button>
          <div className="flex gap-2">
            <button disabled={busy || !comEscolha} onClick={aplicarTodas} className="btn-ghost flex-1 !py-[7px] !text-[12px]" title="Aplica também as sugestões do motor e do banco">Aplicar todas</button>
            <button disabled={busy || grupos.length === comEscolha} onClick={marcarRestantesOutros} className="btn-ghost flex-1 !py-[7px] !text-[12px]">Restantes: Outros</button>
          </div>
        </div>
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
                <CategoryPicker value={bulkCat} subValue={bulkSub} onSelect={(c, s) => { setBulkCat(c); setBulkSub(s || null); }} placeholder="Sobrepor categoria…" />
                <button
                  disabled={busy || selAplicaveis === 0}
                  onClick={aplicarSelecionados}
                  className="btn-primary !py-[7px] !px-3 !text-[12.5px]"
                  title={bulkCat
                    ? `Aplica “${bulkCat}” aos ${sel.size} selecionados`
                    : "Aplica a categoria de cada linha selecionada · escolha uma categoria acima para sobrepor todas"}
                >
                  Aplicar aos {selAplicaveis}
                </button>
                <button
                  disabled={busy}
                  onClick={marcarInternaSelecionados}
                  className="btn-ghost !py-[7px] !px-3 !text-[12.5px]"
                  title="Marca os selecionados como transferências entre contas próprias (interna)"
                >
                  ⇄ Marcar entre contas próprias
                </button>
                {selReceitas > 0 && (
                  <button
                    disabled={busy}
                    onClick={confirmarReceitasSelecionados}
                    className="btn-ghost !py-[7px] !px-3 !text-[12.5px]"
                    title="Confirma as receitas selecionadas (usa o subtipo como rótulo, ex.: Salário)"
                  >
                    ✓ Confirmar {selReceitas} receita{selReceitas > 1 ? "s" : ""}
                  </button>
                )}
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
              const interna = !!escolhaInterna[g.key];
              return (
                <div
                  key={g.key}
                  data-idx={i}
                  role="option"
                  aria-selected={selecionado}
                  onMouseDown={() => setActiveIdx(i)}
                  className={`flex flex-col md:flex-row md:flex-wrap md:items-center gap-x-3 gap-y-[10px] px-3 sm:px-4 py-[12px] transition-colors ${ativo ? "bg-fill/70" : "hover:bg-fill/30"}`}
                >
                  {/* linha 1 (mobile) / bloco esquerdo (desktop): checkbox + nome + resumo */}
                  <div className="flex items-start md:items-center gap-3 min-w-0 md:flex-1">
                    <input
                      type="checkbox"
                      checked={selecionado}
                      onChange={() => setSel((s) => { const n = new Set(s); n.has(g.key) ? n.delete(g.key) : n.add(g.key); return n; })}
                      onMouseDown={(e) => e.stopPropagation()}
                      aria-label={`Selecionar ${g.ex}`}
                      className="accent-accent w-[15px] h-[15px] shrink-0 mt-[3px] md:mt-0"
                    />
                    <button
                      className="min-w-0 flex-1 text-left bg-transparent border-0 p-0 cursor-pointer group"
                      onClick={() => openModal(g.ex, g.rows)}
                      title="Ver lançamentos do grupo"
                    >
                      <div className="text-[13.5px] font-medium truncate group-hover:text-accent transition-colors">{g.ex}</div>
                      <div className="text-[11.5px] text-muted">
                        <span className="whitespace-nowrap">{g.n} {g.n === 1 ? "lançamento" : "lançamentos"} · <span className={`tabular-nums ${g.receita || g.rinvest ? "text-green" : "text-red"}`}>{g.receita || g.rinvest ? "+" + BRL0(g.total) : BRL0(-g.total)}</span></span>
                        {interna
                          ? <span className="ml-2 inline-flex items-center rounded-full bg-violet/15 text-violet px-[7px] py-[1px] text-[10.5px] font-semibold">🔁 {g.internaSug ? "provavelmente entre contas" : "entre contas próprias"}</span>
                          : cat
                            ? (FONTE_BADGE[g.fonte] && <span className={`ml-2 inline-flex items-center rounded-full px-[7px] py-[1px] text-[10.5px] font-semibold ${FONTE_BADGE[g.fonte]!.cls}`}>{FONTE_BADGE[g.fonte]!.label}</span>)
                            : g.receita
                              ? <span className="ml-2 inline-flex items-center rounded-full bg-green/10 text-green px-[7px] py-[1px] text-[10.5px] font-semibold">💰 receita{g.rotuloReceita !== "Receita" ? ` · ${g.rotuloReceita}` : ""}</span>
                              : g.rinvest
                                ? <span className="ml-2 inline-flex items-center rounded-full bg-accent/10 text-accent px-[7px] py-[1px] text-[10.5px] font-semibold">📈 renda invest.</span>
                                : <span className="ml-2 inline-flex items-center rounded-full bg-amber/10 text-amber px-[7px] py-[1px] text-[10.5px] font-semibold">sem sugestão</span>}
                      </div>
                    </button>
                  </div>
                  {/* linha 2 (mobile) / bloco direito (desktop): categoria + ações */}
                  <div className="flex flex-wrap items-center gap-2 shrink-0 pl-[27px] md:pl-0 md:ml-auto" onMouseDown={(e) => e.stopPropagation()}>
                    <div className={interna ? "opacity-40" : ""}>
                      <CategoryPicker
                        key={pickerKey === g.key ? `open-${g.key}` : g.key}
                        value={cat}
                        subValue={escolhasSub[g.key] || null}
                        autoOpen={pickerKey === g.key}
                        onClose={voltarFoco}
                        // escolher uma categoria desmarca "entre contas próprias"
                        onSelect={(c, sub) => {
                          setEscolhas((s) => ({ ...s, [g.key]: c }));
                          setEscolhasSub((s) => { const n = { ...s }; if (sub) n[g.key] = sub; else delete n[g.key]; return n; });
                          setEscolhaInterna((s) => ({ ...s, [g.key]: false }));
                        }}
                      />
                    </div>
                    <button
                      disabled={busy || (!cat && !interna)}
                      onClick={() => aplicarUm(g)}
                      className="btn bg-accent hover:bg-accent2 text-onaccent text-[12px] rounded-[8px] px-3 py-[6px] border-0 disabled:opacity-40"
                    >
                      Aplicar
                    </button>
                    {(g.receita || g.rinvest) && !interna && !cat && (
                      <button
                        disabled={busy}
                        onClick={() => confirmarReceita(g)}
                        className="text-[12px] rounded-[8px] px-2 py-[6px] border border-green/40 bg-green/10 text-green transition-colors whitespace-nowrap"
                        title={`Confirmar como ${g.rinvest ? "renda de investimento" : "receita"} (${g.rotuloReceita}) sem escolher categoria de despesa`}
                      >
                        ✓ {g.rinvest ? "Renda invest." : "Receita"}
                      </button>
                    )}
                    <button
                      disabled={busy}
                      onClick={() => toggleInterna(g.key)}
                      aria-pressed={interna}
                      className={`text-[12px] rounded-[8px] px-2 py-[6px] border transition-colors ${
                        interna
                          ? "bg-violet/15 text-violet border-violet/40"
                          : "btn-ghost !px-2 !py-[6px]"
                      }`}
                      title={interna ? "Desmarcar “entre contas próprias” (só aplica ao clicar em Aplicar)" : "Marcar como entre contas próprias (só aplica ao clicar em Aplicar)"}
                    >
                      ⇄{interna ? " ✓" : ""}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* como funciona — legenda discreta no rodapé (abre pop-up) */}
      <div className="mt-3">
      <Legenda>
        Cada linha é um <b>estabelecimento</b> (descrições agrupadas), do maior gasto pro menor. Defina a <b>categoria</b> (use <b>Corporativo</b> para trabalho)
        e clique <b>Aplicar</b> — vale pra todos os lançamentos do grupo, vira sugestão e dá pra <b>desfazer</b>.
        <br />Agora aparecem também <b>receitas e transferências</b> ainda sem classificação. O botão <b>⇄</b> marca o grupo como <b className="text-violet">entre contas próprias</b> — é só uma escolha: <b>nada é gravado até você clicar em Aplicar</b>. Para <b className="text-green">receitas</b> (ex.: salário), use <b>✓ Receita</b> para confirmar sem precisar de categoria de despesa; juros/dividendos aparecem como <b className="text-accent">📈 renda invest.</b> e têm o próprio <b>✓ Renda invest.</b>.
        <br />Os que já sabemos serem <b className="text-violet">🔁 provavelmente entre contas</b> (histórico ou transferência) já vêm <b>pré-marcados</b> e entram, junto com os <b className="text-green">conhecidos</b> (🔗 vínculo e 🧠 histórico), no botão <b>Aplicar conhecidos</b>. Os <b className="text-accent">sugeridos</b> (⚙️ motor e 🏦 banco) vêm pré-preenchidos pra você confirmar.
        <span className="hidden sm:inline"> Pelo teclado: <kbd className="kbd">↑</kbd><kbd className="kbd">↓</kbd> navega, <kbd className="kbd">Enter</kbd> escolhe categoria, <kbd className="kbd">espaço</kbd> seleciona, <kbd className="kbd">E</kbd> entre contas, <kbd className="kbd">A</kbd> aplica.</span>
      </Legenda>
      </div>
    </div>
  );
}
