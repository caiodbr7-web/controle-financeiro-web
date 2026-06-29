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

export interface Categoria { id: number; nome: string; cor: string; ordem: number }

export interface ResultadoRenomear { ok: boolean; erro?: string; afetadas?: number }
export interface ResultadoAdicionar { ok: boolean; erro?: string }

interface CategoriasCtx {
  categorias: Categoria[];
  carregando: boolean;
  pronto: boolean;            // tabela existe e já carregou ao menos uma vez
  recarregar: () => Promise<void>;
  adicionar: (nome: string, cor: string) => Promise<ResultadoAdicionar>;
  renomear: (id: number, nome: string) => Promise<ResultadoRenomear>;
  mudarCor: (id: number, cor: string) => Promise<void>;
  excluir: (id: number) => Promise<void>;
  reordenar: (ids: number[]) => Promise<void>;
  contarTransacoes: (nome: string) => Promise<number>;
}

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
      .from("categorias").select("id,nome,cor,ordem").order("ordem").order("id");
    if (error) {
      // tabela ainda não migrada → mantém os defaults p/ o app seguir funcionando
      setCategoriasRegistry(CATEGORIAS_DEFAULT);
      setPronto(false);
      setCarregando(false);
      return;
    }
    let linhas = (data || []) as Categoria[];
    // base nova (sem categorias): semeia os defaults uma única vez
    if (linhas.length === 0 && !seedEmAndamento.current) {
      seedEmAndamento.current = true;
      const seed = CATEGORIAS_DEFAULT.map((c, i) => ({ nome: c.nome, cor: c.cor, ordem: i }));
      const { data: ins } = await sb.from("categorias").insert(seed).select("id,nome,cor,ordem");
      linhas = (ins || []) as Categoria[];
      seedEmAndamento.current = false;
    }
    aplicar(linhas);
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

  const adicionar = useCallback(async (nome: string, cor: string): Promise<ResultadoAdicionar> => {
    const n = nome.trim();
    if (!n) return { ok: false, erro: "Informe um nome." };
    if (categorias.some((c) => c.nome.toLowerCase() === n.toLowerCase()))
      return { ok: false, erro: "Já existe uma categoria com esse nome." };
    const ordem = categorias.reduce((m, c) => Math.max(m, c.ordem), -1) + 1;
    const { error } = await sb.from("categorias").insert({ nome: n, cor, ordem });
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
    // os lançamentos da categoria voltam a "sem categoria"...
    await sb.from("lancamentos").update({ categoria_manual: null }).eq("categoria_manual", alvo.nome);
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

  const valor: CategoriasCtx = {
    categorias, carregando, pronto, recarregar,
    adicionar, renomear, mudarCor, excluir, reordenar, contarTransacoes,
  };
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useCategorias(): CategoriasCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCategorias precisa estar dentro de <CategoriasProvider>");
  return ctx;
}
