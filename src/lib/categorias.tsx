import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { sb } from "./supabase";
import { CATEGORIAS_DEFAULT, setCategoriasRegistry } from "./finance";

/* ---------------------------------------------------------------------------
   Categorias do usuário (tabela public.categorias) — fonte da verdade da lista
   de categorias, suas cores e a ORDEM em que aparecem nos dropdowns.

   Este provider:
     • carrega as categorias da conta logada (semeando os defaults numa base nova);
     • mantém o registry em memória (finance.ts) em sincronia, p/ que os módulos
       puros (corCategoria, matrizMensal, classificador) continuem funcionando
       sem prop-drilling;
     • expõe as operações de CRUD (adicionar/renomear/cor/excluir/reordenar).

   Renomear/excluir reflete nos LANÇAMENTOS (categoria_manual) e nas REGRAS de
   auto-classificação, para a base nunca apontar p/ uma categoria inexistente.
--------------------------------------------------------------------------- */

export type TipoCategoria = "despesa" | "receita";

export interface Subcategoria { id: number; categoria_id: number; nome: string; ordem: number }
export interface Categoria {
  id: number; nome: string; cor: string; ordem: number;
  tipo: TipoCategoria;
  subs: Subcategoria[];
}

export interface ResultadoRenomear { ok: boolean; erro?: string; afetadas?: number }
export interface ResultadoAdicionar { ok: boolean; erro?: string }

interface CategoriasCtx {
  categorias: Categoria[];
  carregando: boolean;
  pronto: boolean;            // tabela existe e já carregou ao menos uma vez
  recarregar: () => Promise<void>;
  adicionar: (nome: string, cor: string, tipo?: TipoCategoria) => Promise<ResultadoAdicionar>;
  renomear: (id: number, nome: string) => Promise<ResultadoRenomear>;
  mudarCor: (id: number, cor: string) => Promise<void>;
  excluir: (id: number) => Promise<void>;
  reordenar: (ids: number[]) => Promise<void>;
  contarTransacoes: (nome: string) => Promise<number>;
  // subcategorias (opcionais; qualquer categoria pode ter)
  adicionarSub: (categoriaId: number, nome: string) => Promise<ResultadoAdicionar>;
  renomearSub: (subId: number, nome: string) => Promise<ResultadoAdicionar>;
  excluirSub: (subId: number) => Promise<void>;
  reordenarSub: (categoriaId: number, subIds: number[]) => Promise<void>;
  // movimentos entre níveis da hierarquia
  converterEmSub: (catId: number, destinoId: number) => Promise<ResultadoAdicionar>;
  promoverSub: (subId: number) => Promise<ResultadoAdicionar>;
  moverSubPara: (subId: number, destinoId: number) => Promise<ResultadoAdicionar>;
}

// linha crua da tabela categorias (antes de anexar as subcategorias)
interface CategoriaRow { id: number; nome: string; cor: string; ordem: number; tipo?: string }

const Ctx = createContext<CategoriasCtx | null>(null);

const ordenar = (xs: Categoria[]) =>
  xs.slice().sort((a, b) => a.ordem - b.ordem || a.id - b.id);

const sincronizarRegistry = (xs: Categoria[]) =>
  setCategoriasRegistry(xs.map((c) => ({ nome: c.nome, cor: c.cor })));

export function CategoriasProvider({ children }: { children: ReactNode }) {
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [pronto, setPronto] = useState(false);
  const seedEmAndamento = useRef(false);

  const aplicar = useCallback((xs: Categoria[]) => {
    const ord = ordenar(xs);
    setCategorias(ord);
    sincronizarRegistry(ord);
  }, []);

  const recarregar = useCallback(async () => {
    const { data: sess } = await sb.auth.getSession();
    if (!sess.session) {
      // sem sessão: volta o registry aos defaults (fallback) e zera a lista
      setCategorias([]);
      setCategoriasRegistry(CATEGORIAS_DEFAULT);
      setPronto(false);
      return;
    }
    setCarregando(true);
    const { data, error } = await sb
      .from("categorias").select("id,nome,cor,ordem,tipo").order("ordem").order("id");
    if (error) {
      // tabela ainda não migrada → mantém os defaults p/ o app seguir funcionando
      setCategoriasRegistry(CATEGORIAS_DEFAULT);
      setPronto(false);
      setCarregando(false);
      return;
    }
    let linhas = (data || []) as CategoriaRow[];
    // base nova (sem categorias): semeia os defaults uma única vez
    if (linhas.length === 0 && !seedEmAndamento.current) {
      seedEmAndamento.current = true;
      const seed = CATEGORIAS_DEFAULT.map((c, i) => ({ nome: c.nome, cor: c.cor, ordem: i }));
      const { data: ins } = await sb.from("categorias").insert(seed).select("id,nome,cor,ordem,tipo");
      linhas = (ins || []) as CategoriaRow[];
      seedEmAndamento.current = false;
    }
    // subcategorias (best-effort: se a tabela não existir, segue sem elas)
    let subs: Subcategoria[] = [];
    const { data: subData } = await sb
      .from("subcategorias").select("id,categoria_id,nome,ordem").order("ordem").order("id");
    if (subData) subs = subData as Subcategoria[];
    const porCat = new Map<number, Subcategoria[]>();
    for (const s of subs) {
      const arr = porCat.get(s.categoria_id) || [];
      arr.push(s);
      porCat.set(s.categoria_id, arr);
    }
    const completas: Categoria[] = linhas.map((c) => ({
      id: c.id, nome: c.nome, cor: c.cor, ordem: c.ordem,
      tipo: (c.tipo === "receita" ? "receita" : "despesa") as TipoCategoria,
      subs: porCat.get(c.id) || [],
    }));
    aplicar(completas);
    setPronto(true);
    setCarregando(false);
  }, [aplicar]);

  // carrega na 1ª montagem e sempre que a sessão muda (login/logout)
  useEffect(() => {
    recarregar();
    const { data: sub } = sb.auth.onAuthStateChange(() => { recarregar(); });
    return () => sub.subscription.unsubscribe();
  }, [recarregar]);

  const contarTransacoes = useCallback(async (nome: string) => {
    const { count } = await sb
      .from("lancamentos").select("id", { count: "exact", head: true })
      .eq("categoria_manual", nome);
    return count || 0;
  }, []);

  const adicionar = useCallback(async (nome: string, cor: string, tipo: TipoCategoria = "despesa"): Promise<ResultadoAdicionar> => {
    const n = nome.trim();
    if (!n) return { ok: false, erro: "Informe um nome." };
    if (categorias.some((c) => c.nome.toLowerCase() === n.toLowerCase()))
      return { ok: false, erro: "Já existe uma categoria com esse nome." };
    const ordem = categorias.reduce((m, c) => Math.max(m, c.ordem), -1) + 1;
    const { error } = await sb.from("categorias").insert({ nome: n, cor, ordem, tipo });
    if (error) return { ok: false, erro: error.message };
    await recarregar();
    return { ok: true };
  }, [categorias, recarregar]);

  const renomear = useCallback(async (id: number, nome: string): Promise<ResultadoRenomear> => {
    const n = nome.trim();
    const atual = categorias.find((c) => c.id === id);
    if (!atual) return { ok: false, erro: "Categoria não encontrada." };
    if (!n) return { ok: false, erro: "O nome não pode ficar vazio." };
    if (n === atual.nome) return { ok: true, afetadas: 0 };
    if (categorias.some((c) => c.id !== id && c.nome.toLowerCase() === n.toLowerCase()))
      return { ok: false, erro: "Já existe uma categoria com esse nome." };

    // conta quantos lançamentos serão renomeados (antes de mexer)
    const afetadas = await contarTransacoes(atual.nome);

    const { error } = await sb.from("categorias").update({ nome: n }).eq("id", id);
    if (error) return { ok: false, erro: error.message };

    // propaga o novo nome p/ os lançamentos já classificados...
    await sb.from("lancamentos").update({ categoria_manual: n }).eq("categoria_manual", atual.nome);
    // ...e p/ as regras de auto-classificação (best-effort)
    await sb.from("regras").update({ categoria: n }).eq("categoria", atual.nome);
    // vínculos do Planejamento podem referenciar a categoria pelo nome (best-effort)
    await sb.from("planos").update({ categoria: n }).eq("categoria", atual.nome);
    await sb.from("planos").update({ link_categoria: n }).eq("link_categoria", atual.nome);

    await recarregar();
    return { ok: true, afetadas };
  }, [categorias, recarregar, contarTransacoes]);

  const mudarCor = useCallback(async (id: number, cor: string) => {
    // otimista: atualiza local + registry na hora; persiste em seguida
    aplicar(categorias.map((c) => (c.id === id ? { ...c, cor } : c)));
    await sb.from("categorias").update({ cor }).eq("id", id);
  }, [categorias, aplicar]);

  const excluir = useCallback(async (id: number) => {
    const alvo = categorias.find((c) => c.id === id);
    if (!alvo) return;
    // os lançamentos da categoria voltam a "sem categoria" (sub inclusa)...
    await sb.from("lancamentos").update({ categoria_manual: null, subcategoria_manual: null }).eq("categoria_manual", alvo.nome);
    // ...e as regras que apontavam p/ ela são removidas (não re-sugerir categoria morta)
    await sb.from("regras").delete().eq("categoria", alvo.nome);
    await sb.from("categorias").delete().eq("id", id);
    await recarregar();
  }, [categorias, recarregar]);

  const reordenar = useCallback(async (ids: number[]) => {
    const byId = new Map(categorias.map((c) => [c.id, c]));
    const nova = ids.map((id, i) => ({ ...(byId.get(id) as Categoria), ordem: i }));
    aplicar(nova); // reflete na hora
    await Promise.all(nova.map((c) => sb.from("categorias").update({ ordem: c.ordem }).eq("id", c.id)));
  }, [categorias, aplicar]);

  /* ----------------------------- subcategorias ----------------------------- */
  const adicionarSub = useCallback(async (categoriaId: number, nome: string): Promise<ResultadoAdicionar> => {
    const n = nome.trim();
    if (!n) return { ok: false, erro: "Informe um nome." };
    const cat = categorias.find((c) => c.id === categoriaId);
    if (!cat) return { ok: false, erro: "Categoria não encontrada." };
    if (cat.subs.some((s) => s.nome.toLowerCase() === n.toLowerCase()))
      return { ok: false, erro: "Já existe uma subcategoria com esse nome." };
    const ordem = cat.subs.reduce((m, s) => Math.max(m, s.ordem), -1) + 1;
    const { error } = await sb.from("subcategorias").insert({ categoria_id: categoriaId, nome: n, ordem });
    if (error) return { ok: false, erro: error.message };
    await recarregar();
    return { ok: true };
  }, [categorias, recarregar]);

  const renomearSub = useCallback(async (subId: number, nome: string): Promise<ResultadoAdicionar> => {
    const n = nome.trim();
    if (!n) return { ok: false, erro: "O nome não pode ficar vazio." };
    const cat = categorias.find((c) => c.subs.some((s) => s.id === subId));
    const atual = cat?.subs.find((s) => s.id === subId);
    if (!cat || !atual) return { ok: false, erro: "Subcategoria não encontrada." };
    if (n === atual.nome) return { ok: true };
    if (cat.subs.some((s) => s.id !== subId && s.nome.toLowerCase() === n.toLowerCase()))
      return { ok: false, erro: "Já existe uma subcategoria com esse nome." };
    const { error } = await sb.from("subcategorias").update({ nome: n }).eq("id", subId);
    if (error) return { ok: false, erro: error.message };
    // propaga o novo nome p/ os lançamentos já classificados nessa sub (best-effort)
    await sb.from("lancamentos").update({ subcategoria_manual: n })
      .eq("categoria_manual", cat.nome).eq("subcategoria_manual", atual.nome);
    await recarregar();
    return { ok: true };
  }, [categorias, recarregar]);

  const excluirSub = useCallback(async (subId: number) => {
    const cat = categorias.find((c) => c.subs.some((s) => s.id === subId));
    const alvo = cat?.subs.find((s) => s.id === subId);
    // os lançamentos da sub voltam a só ter a categoria-mãe
    if (cat && alvo) {
      await sb.from("lancamentos").update({ subcategoria_manual: null })
        .eq("categoria_manual", cat.nome).eq("subcategoria_manual", alvo.nome);
    }
    await sb.from("subcategorias").delete().eq("id", subId);
    await recarregar();
  }, [categorias, recarregar]);

  const reordenarSub = useCallback(async (categoriaId: number, subIds: number[]) => {
    const cat = categorias.find((c) => c.id === categoriaId);
    if (!cat) return;
    const byId = new Map(cat.subs.map((s) => [s.id, s]));
    const nova = subIds.map((id, i) => ({ ...(byId.get(id) as Subcategoria), ordem: i }));
    // reflete na hora
    aplicar(categorias.map((c) => (c.id === categoriaId ? { ...c, subs: nova } : c)));
    await Promise.all(nova.map((s) => sb.from("subcategorias").update({ ordem: s.ordem }).eq("id", s.id)));
  }, [categorias, aplicar]);

  /* ---------------------- movimentos entre níveis ----------------------
     Três operações reestruturam a hierarquia SEM perder classificação:
       · converterEmSub: uma categoria vira subcategoria de outra — suas
         transações viram "Destino › NomeAntigo" e as subs dela são
         achatadas como irmãs no destino (mesclando homônimas);
       · promoverSub: uma subcategoria vira categoria própria;
       · moverSubPara: uma subcategoria muda de categoria-mãe.
     Regras/planos que apontavam pela categoria antiga passam a apontar
     para a nova mãe (mesmo padrão do renomear). */

  const converterEmSub = useCallback(async (catId: number, destinoId: number): Promise<ResultadoAdicionar> => {
    const cat = categorias.find((c) => c.id === catId);
    const destino = categorias.find((c) => c.id === destinoId);
    if (!cat || !destino) return { ok: false, erro: "Categoria não encontrada." };
    if (cat.id === destino.id) return { ok: false, erro: "Escolha uma categoria diferente." };
    if (destino.subs.some((s) => s.nome.toLowerCase() === cat.nome.toLowerCase()))
      return { ok: false, erro: `“${destino.nome}” já tem uma subcategoria “${cat.nome}”.` };

    // 1) a própria categoria vira sub no destino
    let ordem = destino.subs.reduce((m, s) => Math.max(m, s.ordem), -1) + 1;
    const { error } = await sb.from("subcategorias").insert({ categoria_id: destino.id, nome: cat.nome, ordem: ordem++ });
    if (error) return { ok: false, erro: error.message };

    // 2) as subs da categoria são achatadas como irmãs no destino (homônimas mesclam)
    for (const s of cat.subs) {
      const jaExiste = destino.subs.some((d) => d.nome.toLowerCase() === s.nome.toLowerCase());
      if (jaExiste) await sb.from("subcategorias").delete().eq("id", s.id);
      else await sb.from("subcategorias").update({ categoria_id: destino.id, ordem: ordem++ }).eq("id", s.id);
    }

    // 3) transações: sem sub → "Destino › NomeAntigo"; com sub → mantém a sub sob o destino
    await sb.from("lancamentos")
      .update({ categoria_manual: destino.nome, subcategoria_manual: cat.nome })
      .eq("categoria_manual", cat.nome).is("subcategoria_manual", null);
    await sb.from("lancamentos")
      .update({ categoria_manual: destino.nome })
      .eq("categoria_manual", cat.nome).not("subcategoria_manual", "is", null);

    // 4) regras e planos passam a apontar para a nova mãe (best-effort)
    await sb.from("regras").update({ categoria: destino.nome }).eq("categoria", cat.nome);
    await sb.from("planos").update({ categoria: destino.nome }).eq("categoria", cat.nome);
    await sb.from("planos").update({ link_categoria: destino.nome }).eq("link_categoria", cat.nome);

    // 5) remove a categoria antiga
    await sb.from("categorias").delete().eq("id", cat.id);
    await recarregar();
    return { ok: true };
  }, [categorias, recarregar]);

  const promoverSub = useCallback(async (subId: number): Promise<ResultadoAdicionar> => {
    const mae = categorias.find((c) => c.subs.some((s) => s.id === subId));
    const sub = mae?.subs.find((s) => s.id === subId);
    if (!mae || !sub) return { ok: false, erro: "Subcategoria não encontrada." };
    if (categorias.some((c) => c.nome.toLowerCase() === sub.nome.toLowerCase()))
      return { ok: false, erro: "Já existe uma categoria com esse nome." };

    // nova categoria herda cor e tipo da mãe, no fim da lista
    const ordem = categorias.reduce((m, c) => Math.max(m, c.ordem), -1) + 1;
    const { error } = await sb.from("categorias").insert({ nome: sub.nome, cor: mae.cor, tipo: mae.tipo, ordem });
    if (error) return { ok: false, erro: error.message };

    await sb.from("lancamentos")
      .update({ categoria_manual: sub.nome, subcategoria_manual: null })
      .eq("categoria_manual", mae.nome).eq("subcategoria_manual", sub.nome);
    await sb.from("subcategorias").delete().eq("id", sub.id);
    await recarregar();
    return { ok: true };
  }, [categorias, recarregar]);

  const moverSubPara = useCallback(async (subId: number, destinoId: number): Promise<ResultadoAdicionar> => {
    const mae = categorias.find((c) => c.subs.some((s) => s.id === subId));
    const sub = mae?.subs.find((s) => s.id === subId);
    const destino = categorias.find((c) => c.id === destinoId);
    if (!mae || !sub || !destino) return { ok: false, erro: "Subcategoria não encontrada." };
    if (destino.id === mae.id) return { ok: false, erro: "Escolha uma categoria diferente." };
    if (destino.subs.some((s) => s.nome.toLowerCase() === sub.nome.toLowerCase()))
      return { ok: false, erro: `“${destino.nome}” já tem uma subcategoria “${sub.nome}”.` };

    const ordem = destino.subs.reduce((m, s) => Math.max(m, s.ordem), -1) + 1;
    const { error } = await sb.from("subcategorias").update({ categoria_id: destino.id, ordem }).eq("id", sub.id);
    if (error) return { ok: false, erro: error.message };

    await sb.from("lancamentos")
      .update({ categoria_manual: destino.nome })
      .eq("categoria_manual", mae.nome).eq("subcategoria_manual", sub.nome);
    await recarregar();
    return { ok: true };
  }, [categorias, recarregar]);

  const valor: CategoriasCtx = {
    categorias, carregando, pronto, recarregar,
    adicionar, renomear, mudarCor, excluir, reordenar, contarTransacoes,
    adicionarSub, renomearSub, excluirSub, reordenarSub,
    converterEmSub, promoverSub, moverSubPara,
  };
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useCategorias(): CategoriasCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCategorias precisa estar dentro de <CategoriasProvider>");
  return ctx;
}
