import { useState, useEffect, useMemo, useCallback, useRef, Fragment, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Kpi, Select, Seg, Toolbar, Panel } from "../ui";
import { useConfirm } from "../Confirm";
import { useToast } from "../Toast";
import { sb } from "../../lib/supabase";
import type { Lancamento } from "../../types";
import { BRL0, dvAddMes, dvLabel, mesComp, valorGasto, valorReceita } from "../../lib/finance";
import { useCategorias } from "../../lib/categorias";
import {
  type Plano, type TipoPlano, TIPOS, mesAtual, horizonte, projetar,
  contribNoMes, fimEfetivo, ehReceitaTipo, mesesEntre,
} from "../../lib/projecao";

const inp = "bg-card text-txt border border-line rounded-[8px] px-2 py-[6px] text-[13px] outline-none focus:border-muted transition-colors placeholder:text-muted/70";
// contorno sutil que sinaliza um valor editável (quadrado levemente arredondado) — quem usa
// acrescenta a cor da borda (border-line por padrão; border-accent/green quando ajustado)
const editavel = "inline-block border rounded-[6px] px-[7px] py-[2px] transition-colors";

// opções de mês para o formulário: de 6 meses atrás até ~3 anos à frente
const MES_OPCOES = (() => {
  const start = dvAddMes(mesAtual(), -6);
  return Array.from({ length: 42 }, (_, i) => { const k = dvAddMes(start, i); return { v: k, label: dvLabel(k) }; });
})();
// opções de mês para a visão "Mês": atual e 11 anteriores (mais recente primeiro)
const MES_SELECT = (() => {
  const cur = mesAtual();
  return Array.from({ length: 12 }, (_, i) => { const k = dvAddMes(cur, -i); return { v: k, label: dvLabel(k) }; });
})();
// início da linha do total do cartão: bem no passado, para cobrir o histórico exibido
const CARTAO_INICIO = dvAddMes(mesAtual(), -36);

const VALOR_LABEL: Record<TipoPlano, string> = {
  fixo: "Valor por mês", receita: "Valor por mês", pagamento: "Valor",
  parcelamento: "Valor da parcela", meta: "Valor total",
};
const NOME_PH: Record<TipoPlano, string> = {
  fixo: "Aluguel, Internet…", parcelamento: "Geladeira, Notebook…", pagamento: "IPVA, IPTU…",
  meta: "Viagem Europa…", receita: "Salário, Freela…",
};

const parseValor = (s: string): number => {
  if (!s || !s.trim()) return 0;
  const n = parseFloat(s.replace(/\./g, "").replace(",", "."));
  return isNaN(n) ? 0 : n;
};
const parseValorN = (s: string): number | null => {
  if (s == null || s.trim() === "") return null;
  let t = s.trim();
  if (t.includes(",")) {
    t = t.replace(/\./g, "").replace(",", ".");        // padrão BR: ponto é milhar, vírgula é decimal
  } else if (!/^-?\d+\.\d{1,2}$/.test(t)) {
    t = t.replace(/\./g, "");                          // só pontos e não é "117.02" → ponto é milhar (1.500, 4.368)
  }                                                    // senão (ex.: 117.02) mantém o ponto como decimal
  const n = parseFloat(t);
  return isNaN(n) ? null : n;
};
// célula compacta da projeção: reais inteiros
const fmtCell = (v: number) => (v < 0 ? "-" : "") + Math.abs(Math.round(v)).toLocaleString("pt-BR");
// célula da visão mês: até 2 casas, "—" quando vazio
const fmt = (v: number | null | undefined) => (v == null ? "—" : Math.round(Number(v)).toLocaleString("pt-BR"));

function resumoItem(p: Plano): string {
  const fim = fimEfetivo(p);
  const L = (k: string | null) => (k ? dvLabel(k) : "");
  switch (p.tipo) {
    case "fixo":
    case "receita":
      return `${BRL0(p.valor)}/mês` + (p.mes_fim ? ` · até ${L(p.mes_fim)}` : " · sem fim");
    case "pagamento":
      return `pagamento único · ${L(p.mes_inicio)}`;
    case "parcelamento":
      return `${p.parcelas || 1}× de ${BRL0(p.valor)} · termina ${L(fim)}`;
    case "meta": {
      const n = mesesEntre(p.mes_inicio, fim || p.mes_inicio) + 1;
      return `${BRL0(p.valor)} até ${L(fim)} · ${BRL0(p.valor / Math.max(1, n))}/mês`;
    }
  }
  return "";
}

const VAZIO = { tipo: "fixo" as TipoPlano, nome: "", categoria: "", valor: "", mes_inicio: mesAtual(), mes_fim: "", parcelas: "12", no_cartao: false };

// erro de coluna ainda não criada (migração do cartão não rodada)
const faltaColunaCartao = (msg?: string) => /no_cartao|could not find|schema cache/i.test(msg || "");
const MSG_MIGRACAO_CARTAO = 'Para usar o cartão de crédito, aplique as migrações em supabase/migrations/ (aplicadas automaticamente no merge para main; ou rode o SQL do arquivo *_cartao_credito.sql no SQL Editor).';
const faltaColunaConta = (msg?: string) => /eh_conta_total|could not find|schema cache/i.test(msg || "");
const MSG_MIGRACAO_CONTA = 'Para orçar a conta variável, aplique as migrações em supabase/migrations/ (aplicadas automaticamente no merge para main; ou rode o SQL do arquivo *_orcamento_conta.sql no SQL Editor).';
const faltaColunaReceita = (msg?: string) => /eh_receita_total|could not find|schema cache/i.test(msg || "");
const MSG_MIGRACAO_RECEITA = 'Para planejar a receita prevista, aplique as migrações em supabase/migrations/ (aplicadas automaticamente no merge para main; ou rode o SQL do arquivo *_receita_prevista.sql no SQL Editor).';

const SQL_HINT = `-- planos: itens; plano_mensal: realizado/pago por mês
create table if not exists public.planos (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) default auth.uid(),
  tipo text not null check (tipo in ('fixo','parcelamento','pagamento','meta','receita')),
  nome text not null, categoria text, valor numeric not null default 0,
  mes_inicio text not null, mes_fim text, parcelas integer,
  ativo boolean not null default true, ordem integer not null default 0,
  no_cartao boolean not null default false, eh_cartao_total boolean not null default false,
  link_categoria text, link_texto text, origem_orcamento_item bigint,
  criado_em timestamptz not null default now()
);
create table if not exists public.plano_mensal (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) default auth.uid(),
  plano_id bigint not null references public.planos(id) on delete cascade,
  competencia text not null, valor_real numeric, pago boolean not null default false,
  unique (plano_id, competencia)
);
alter table public.planos enable row level security;
alter table public.plano_mensal enable row level security;
drop policy if exists "proprios dados" on public.planos;
create policy "proprios dados" on public.planos for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "proprios dados" on public.plano_mensal;
create policy "proprios dados" on public.plano_mensal for all using (user_id = auth.uid()) with check (user_id = auth.uid());`;

interface Mensal { valor_real: number | null; pago: boolean; }

function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[11.5px] text-muted w-full sm:w-auto">
      {label}
      <div className="text-txt">{children}</div>
    </label>
  );
}

// `lancamentos` já vem filtrado pela Visão (Pessoal/Corp/Tudo) — o realizado (vínculo e
// total do cartão) respeita o filtro; os itens do plano não têm natureza, então não filtram.
export function Planejamento({ lancamentos }: { lancamentos: Lancamento[] }) {
  const confirm = useConfirm();
  const { toast } = useToast();
  const { categorias } = useCategorias();
  // opções de categoria com a opção vazia na frente ("(qualquer)" / "—")
  const catOpcoes = useMemo(() => ["", ...categorias.map((c) => c.nome)], [categorias]);
  const [planos, setPlanos] = useState<Plano[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");
  const [semTabela, setSemTabela] = useState(false);
  const [temCartaoCol, setTemCartaoCol] = useState(true); // coluna no_cartao existe?
  const [temOrcCartao, setTemOrcCartao] = useState(true); // coluna eh_cartao_total existe?
  const [temOrcConta, setTemOrcConta] = useState(true); // coluna eh_conta_total existe?
  const [temOrcReceita, setTemOrcReceita] = useState(true); // coluna eh_receita_total existe?
  const [cartaoPlano, setCartaoPlano] = useState<Plano | null>(null); // linha especial do TOTAL do cartão
  const [contaPlano, setContaPlano] = useState<Plano | null>(null); // linha especial do orçamento da conta variável
  const [receitaPlano, setReceitaPlano] = useState<Plano | null>(null); // linha especial da receita prevista (orçamento de receita)
  // edição do orçamento previsto a partir do realizado (botão "↑ orçar" / "↑ prever")
  const [orcEdit, setOrcEdit] = useState<null | "conta" | "cartao" | "receita">(null);
  const [orcVal, setOrcVal] = useState("");
  // pop-up de sugestão (média móvel) ao passar o mouse no valor previsto orçável
  const [sug, setSug] = useState<{ tipo: "conta" | "cartao" | "receita"; left: number; top: number; up: boolean } | null>(null);
  const sugCloseT = useRef<number | undefined>(undefined);
  const [cartaoOrc, setCartaoOrc] = useState(""); // orçamento mensal do cartão (texto do input)
  const [cartaoReal, setCartaoReal] = useState(""); // total real do cartão no mês selecionado (texto)
  const [copiado, setCopiado] = useState(false);
  const [view, setView] = useState<"mes" | "proj">("mes");
  // grupos colapsáveis (chave -> minimizado?): cada "grande nome" (recorrentes, outros…)
  // pode esconder seus itens e mostrar só o total na própria linha-cabeçalho
  const [colapsado, setColapsado] = useState<Record<string, boolean>>({});
  const toggleGrupo = useCallback((k: string) => setColapsado((c) => ({ ...c, [k]: !c[k] })), []);

  // projeção
  const [n, setN] = useState(12);
  // ajustes manuais por mês na projeção (override por duplo clique): comp -> plano_id -> valor
  const [ovr, setOvr] = useState<Record<string, Record<number, number>>>({});
  const [editCell, setEditCell] = useState<{ id: number; k: string } | null>(null);
  const [editVal, setEditVal] = useState("");
  // visão mês
  const [comp, setComp] = useState(MES_SELECT[0].v);
  const [mensal, setMensal] = useState<Record<string, Record<number, Mensal>>>({});
  const [reais, setReais] = useState<Record<number, string>>({});
  // formulário (compartilhado)
  const [form, setForm] = useState(VAZIO);
  const [editId, setEditId] = useState<number | null>(null);
  // vínculo a lançamentos
  const [linkEdit, setLinkEdit] = useState<number | null>(null);
  const [linkForm, setLinkForm] = useState({ categoria: "", texto: "" });

  const histMeses = useMemo(() => [dvAddMes(comp, -3), dvAddMes(comp, -2), dvAddMes(comp, -1)], [comp]);

  const carregar = useCallback(async () => {
    setLoading(true); setErro(""); setSemTabela(false);
    const { data, error } = await sb.from("planos").select("*").order("ordem").order("id");
    if (error) {
      if (/does not exist|schema cache|relation|could not find/i.test(error.message)) setSemTabela(true);
      else setErro(error.message);
      setLoading(false); return;
    }
    const todos = (data || []) as Plano[];
    // separa as linhas especiais (TOTAL do cartão, orçamento da conta e receita prevista) dos itens comuns
    const card = todos.find((p) => (p as any).eh_cartao_total) || null;
    const conta = todos.find((p) => (p as any).eh_conta_total) || null;
    const rec = todos.find((p) => (p as any).eh_receita_total) || null;
    setCartaoPlano(card);
    setContaPlano(conta);
    setReceitaPlano(rec);
    setPlanos(todos.filter((p) => p.id !== card?.id && p.id !== conta?.id && p.id !== rec?.id));
    // detecta se as colunas do cartão/conta/receita já existem (migração rodada)
    if (todos.length) {
      setTemCartaoCol("no_cartao" in (todos[0] as object));
      setTemOrcCartao("eh_cartao_total" in (todos[0] as object));
      setTemOrcConta("eh_conta_total" in (todos[0] as object));
      setTemOrcReceita("eh_receita_total" in (todos[0] as object));
    } else {
      const p1 = await sb.from("planos").select("no_cartao").limit(1);
      const p2 = await sb.from("planos").select("eh_cartao_total").limit(1);
      const p3 = await sb.from("planos").select("eh_conta_total").limit(1);
      const p4 = await sb.from("planos").select("eh_receita_total").limit(1);
      setTemCartaoCol(!p1.error); setTemOrcCartao(!p2.error); setTemOrcConta(!p3.error); setTemOrcReceita(!p4.error);
    }
    setLoading(false);
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const carregarMensal = useCallback(async (atual: string, hist: string[]) => {
    const todos = [...hist, atual];
    const { data, error } = await sb.from("plano_mensal").select("plano_id,competencia,valor_real,pago").in("competencia", todos);
    if (error) return;
    const byComp: Record<string, Record<number, Mensal>> = {}; todos.forEach((c) => (byComp[c] = {}));
    (data || []).forEach((m: any) => { (byComp[m.competencia] = byComp[m.competencia] || {})[m.plano_id] = { valor_real: m.valor_real, pago: m.pago }; });
    setMensal(byComp);
    const r: Record<number, string> = {};
    Object.entries(byComp[atual] || {}).forEach(([id, m]) => { if (m.valor_real != null) r[+id] = String(m.valor_real).replace(".", ","); });
    setReais(r);
  }, []);
  useEffect(() => { if (!semTabela) carregarMensal(comp, histMeses); }, [comp, histMeses, semTabela, carregarMensal]);

  // mantém os inputs do total do cartão sincronizados com o que está salvo
  useEffect(() => {
    setCartaoOrc(cartaoPlano?.valor ? String(cartaoPlano.valor).replace(".", ",") : "");
  }, [cartaoPlano]);
  useEffect(() => {
    const v = cartaoPlano ? (mensal[comp]?.[cartaoPlano.id]?.valor_real ?? null) : null;
    setCartaoReal(v != null ? String(v).replace(".", ",") : "");
  }, [cartaoPlano, mensal, comp]);

  // ---------- realizado automático (lançamentos vinculados) ----------
  function matchLink(d: Lancamento, p: Plano) {
    if (!p.link_categoria && !p.link_texto) return false;
    if (valorGasto(d) <= 0) return false; // gasto real, não-interno (exclui transferência interna/aporte)
    if (p.link_categoria && d.categoria_manual !== p.link_categoria) return false;
    if (p.link_texto && !String(d.descricao || "").toLowerCase().includes(p.link_texto.toLowerCase())) return false;
    return true;
  }
  const autos = useMemo(() => {
    const todos = [...histMeses, comp];
    const out: Record<number, Record<string, number | null>> = {};
    planos.forEach((p) => {
      out[p.id] = {};
      todos.forEach((c) => {
        if (!p.link_categoria && !p.link_texto) { out[p.id][c] = null; return; }
        let sum = 0, cnt = 0;
        lancamentos.forEach((d) => { if (mesComp(d) === c && matchLink(d, p)) { sum += valorGasto(d); cnt++; } });
        out[p.id][c] = cnt > 0 ? Math.round(sum * 100) / 100 : null;
      });
    });
    return out;
  }, [planos, lancamentos, comp, histMeses]);

  // ---------- total REAL do cartão (lançamentos com origem "Cartao...") por mês ----------
  // O que de fato caiu no cartão em cada mês: soma dos gastos importados (classe Gasto,
  // NÃO-interna — exclui pagamento de fatura/transf.) cuja origem começa com "Cartao".
  // Eixo = competência (mesComp); valorGasto respeita interna e desconta estorno.
  const autosCartao = useMemo(() => {
    const todos = [...histMeses, comp];
    const out: Record<string, number | null> = {};
    todos.forEach((c) => {
      let sum = 0, cnt = 0;
      lancamentos.forEach((d) => {
        const g = valorGasto(d);
        if (mesComp(d) === c && g > 0 && String(d.origem || "").startsWith("Cartao")) { sum += g; cnt++; }
      });
      out[c] = cnt > 0 ? Math.round(sum * 100) / 100 : null;
    });
    return out;
  }, [lancamentos, comp, histMeses]);

  // ---------- total REAL da conta (lançamentos com origem "Conta...") por mês ----------
  // O que de fato saiu da conta (Pix, débito) em cada mês, excluindo transferências
  // internas/aportes (valorGasto = 0 quando interna).
  const autosConta = useMemo(() => {
    const todos = [...histMeses, comp];
    const out: Record<string, number | null> = {};
    todos.forEach((c) => {
      let sum = 0, cnt = 0;
      lancamentos.forEach((d) => {
        const g = valorGasto(d);
        if (mesComp(d) === c && g > 0 && String(d.origem || "").startsWith("Conta")) { sum += g; cnt++; }
      });
      out[c] = cnt > 0 ? Math.round(sum * 100) / 100 : null;
    });
    return out;
  }, [lancamentos, comp, histMeses]);

  // ---------- total REAL de RECEITAS (classe Receita, NÃO-interna) por mês ----------
  // O que de fato entrou no mês (salário, freela) — base do Saldo do mês real. Exclui
  // receita de investimento e transferências internas (valorReceita já filtra).
  const autosReceita = useMemo(() => {
    const todos = [...histMeses, comp];
    const out: Record<string, number | null> = {};
    todos.forEach((c) => {
      let sum = 0, cnt = 0;
      lancamentos.forEach((d) => {
        const r = valorReceita(d);
        if (mesComp(d) === c && r > 0) { sum += r; cnt++; }
      });
      out[c] = cnt > 0 ? Math.round(sum * 100) / 100 : null;
    });
    return out;
  }, [lancamentos, comp, histMeses]);

  function dados(p: Plano, c: string) {
    const previsto = contribNoMes(p, c);
    const manual = mensal[c]?.[p.id]?.valor_real ?? null;
    const auto = autos[p.id]?.[c] ?? null;
    const efetivo = manual != null ? manual : (auto != null ? auto : (previsto || null));
    const conflito = manual != null && auto != null && Math.abs(manual - auto) > 1;
    return { previsto, manual, auto, efetivo, conflito, pago: mensal[c]?.[p.id]?.pago ?? false };
  }

  async function upsert(planoId: number, c: string, valor_real: number | null, pago: boolean) {
    const { error } = await sb.from("plano_mensal").upsert({ plano_id: planoId, competencia: c, valor_real, pago }, { onConflict: "plano_id,competencia" });
    if (!error) setMensal((v) => ({ ...v, [c]: { ...(v[c] || {}), [planoId]: { valor_real, pago } } }));
  }
  async function salvarReal(p: Plano, valorStr: string) { const v = parseValorN(valorStr); await upsert(p.id, comp, v, v != null || (mensal[comp]?.[p.id]?.pago ?? false)); }
  async function usarLancado(p: Plano, v: number) { await upsert(p.id, comp, v, true); setReais((r) => ({ ...r, [p.id]: String(v).replace(".", ",") })); }
  async function togglePago(p: Plano) { const cur = mensal[comp]?.[p.id]; await upsert(p.id, comp, cur?.valor_real ?? null, !(cur?.pago ?? false)); }

  // ---------- CRUD de itens ----------
  function resetForm() { setForm(VAZIO); setEditId(null); setErro(""); }
  async function salvar() {
    const nome = form.nome.trim();
    if (!nome) { setErro("Dê um nome ao item."); return; }
    if (form.tipo === "meta" && !form.mes_fim) { setErro("Uma meta precisa de um mês-alvo."); return; }
    const payload = {
      tipo: form.tipo, nome,
      categoria: form.tipo === "receita" ? null : (form.categoria || null),
      valor: parseValor(form.valor),
      mes_inicio: form.mes_inicio,
      mes_fim: form.tipo === "fixo" || form.tipo === "receita" || form.tipo === "meta" ? (form.mes_fim || null) : null,
      parcelas: form.tipo === "parcelamento" ? Math.max(1, parseInt(form.parcelas) || 1) : null,
      ativo: true,
      // só manda no_cartao se a coluna existe (não quebra antes da migração)
      ...(temCartaoCol ? { no_cartao: form.tipo === "receita" ? false : !!form.no_cartao } : {}),
    };
    const { error } = editId
      ? await sb.from("planos").update(payload).eq("id", editId)
      : await sb.from("planos").insert(payload);
    if (error) { setErro(faltaColunaCartao(error.message) ? MSG_MIGRACAO_CARTAO : error.message); if (faltaColunaCartao(error.message)) setTemCartaoCol(false); return; }
    resetForm(); carregar();
  }
  function editar(p: Plano) {
    setEditId(p.id);
    setForm({
      tipo: p.tipo, nome: p.nome, categoria: p.categoria || "",
      valor: p.valor ? String(p.valor).replace(".", ",") : "",
      mes_inicio: p.mes_inicio, mes_fim: p.mes_fim || "",
      parcelas: p.parcelas ? String(p.parcelas) : "12",
      no_cartao: !!p.no_cartao,
    });
    setErro("");
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  }
  async function remover(p: Plano) {
    if (!(await confirm({ title: `Remover “${p.nome}”?`, message: "O item sai do planejamento. Esta ação não pode ser desfeita.", confirmLabel: "Remover", danger: true }))) return;
    const { error } = await sb.from("planos").delete().eq("id", p.id);
    if (error) { toast({ message: "Erro ao remover: " + error.message, variant: "error" }); return; }
    if (editId === p.id) resetForm();
    carregar();
    toast({ message: `“${p.nome}” removido.`, variant: "success" });
  }
  async function toggleAtivo(p: Plano) {
    const { error } = await sb.from("planos").update({ ativo: !p.ativo }).eq("id", p.id);
    if (!error) setPlanos((arr) => arr.map((x) => (x.id === p.id ? { ...x, ativo: !x.ativo } : x)));
  }
  async function toggleCartao(p: Plano) {
    const novo = !p.no_cartao;
    const { error } = await sb.from("planos").update({ no_cartao: novo }).eq("id", p.id);
    if (error) { setErro(faltaColunaCartao(error.message) ? MSG_MIGRACAO_CARTAO : error.message); if (faltaColunaCartao(error.message)) setTemCartaoCol(false); return; }
    setErro("");
    setPlanos((arr) => arr.map((x) => (x.id === p.id ? { ...x, no_cartao: novo } : x)));
  }

  // ---------- reordenar itens (arrastar e soltar) ----------
  // os itens são exibidos em três grupos (recorrentes/outros/receitas); o arrasto só vale
  // dentro do mesmo grupo. Ao soltar, recalcula `ordem` de todos e persiste o que mudou.
  const dragId = useRef<number | null>(null);
  const [dropAlvo, setDropAlvo] = useState<number | null>(null);
  const grupoDe = (p: Plano) => (ehReceitaTipo(p.tipo) ? "rec" : p.tipo === "fixo" ? "fix" : "out");

  async function soltarSobre(alvo: Plano) {
    const id = dragId.current;
    dragId.current = null; setDropAlvo(null);
    if (id == null || id === alvo.id) return;
    const orig = planos.find((p) => p.id === id);
    if (!orig || grupoDe(orig) !== grupoDe(alvo)) return;
    const g = grupoDe(alvo);
    const grupo = planos.filter((p) => grupoDe(p) === g);
    const from = grupo.findIndex((p) => p.id === id);
    const to = grupo.findIndex((p) => p.id === alvo.id);
    if (from < 0 || to < 0) return;
    const novoGrupo = [...grupo];
    const [movido] = novoGrupo.splice(from, 1);
    novoGrupo.splice(to, 0, movido);
    // recompõe a lista completa mantendo os outros itens em suas posições
    const idsGrupo = new Set(grupo.map((p) => p.id));
    const fila = [...novoGrupo];
    const novaLista = planos.map((p) => (idsGrupo.has(p.id) ? fila.shift()! : p));
    const antes = new Map(planos.map((p) => [p.id, p.ordem]));
    const comOrdem = novaLista.map((p, i) => ({ ...p, ordem: i }));
    setPlanos(comOrdem);
    // persiste só os itens cuja ordem mudou
    const mudados = comOrdem.filter((p) => antes.get(p.id) !== p.ordem);
    const res = await Promise.all(mudados.map((p) => sb.from("planos").update({ ordem: p.ordem }).eq("id", p.id)));
    const err = res.find((r) => r.error);
    if (err?.error) { toast({ message: "Erro ao reordenar: " + err.error.message, variant: "error" }); carregar(); }
  }

  // reordenar por botão (▲/▼): alternativa de TOQUE ao arrastar — troca com o
  // vizinho do mesmo grupo reusando a mesma lógica/persistência do drag&drop.
  async function moverItem(p: Plano, dir: -1 | 1) {
    const g = grupoDe(p);
    const grupo = planos.filter((x) => grupoDe(x) === g);
    const i = grupo.findIndex((x) => x.id === p.id);
    const alvo = grupo[i + dir];
    if (!alvo) return;
    dragId.current = p.id;
    await soltarSobre(alvo);
  }

  // botão-alça de arrasto (desktop) + setas ▲/▼ (mobile, onde o drag não funciona)
  function DragHandle({ p }: { p: Plano }) {
    return (
      <>
        <span draggable
          onDragStart={(e) => { dragId.current = p.id; e.dataTransfer.effectAllowed = "move"; }}
          onDragEnd={() => { dragId.current = null; setDropAlvo(null); }}
          title="arraste para reordenar"
          className="hidden md:inline shrink-0 cursor-grab active:cursor-grabbing text-muted hover:text-txt select-none text-[13px] leading-none">⠿</span>
        <span className="md:hidden inline-flex flex-col shrink-0">
          <button onClick={() => moverItem(p, -1)} title="Mover para cima"
            className="w-[26px] h-[20px] flex items-center justify-center text-muted bg-transparent border-0 cursor-pointer p-0 text-[10px] leading-none">▲</button>
          <button onClick={() => moverItem(p, 1)} title="Mover para baixo"
            className="w-[26px] h-[20px] flex items-center justify-center text-muted bg-transparent border-0 cursor-pointer p-0 text-[10px] leading-none">▼</button>
        </span>
      </>
    );
  }
  // props de alvo de drop para a <tr> de um item
  const dropProps = (p: Plano) => ({
    onDragOver: (e: DragEvent) => {
      const orig = dragId.current == null ? null : planos.find((x) => x.id === dragId.current);
      if (!orig || grupoDe(orig) !== grupoDe(p)) return;
      e.preventDefault();
      if (dropAlvo !== p.id) setDropAlvo(p.id);
    },
    onDrop: (e: DragEvent) => { e.preventDefault(); soltarSobre(p); },
  });

  // ---------- total do cartão (linha especial: orçamento mensal + real por mês) ----------
  async function garantirCartaoPlano(): Promise<Plano | null> {
    if (cartaoPlano) return cartaoPlano;
    const payload = {
      tipo: "fixo", nome: "Cartão de crédito", categoria: null, valor: 0,
      mes_inicio: CARTAO_INICIO, mes_fim: null, parcelas: null, ativo: true,
      no_cartao: false, eh_cartao_total: true,
    };
    const { data, error } = await sb.from("planos").insert(payload).select().single();
    if (error) { setErro(faltaColunaCartao(error.message) ? MSG_MIGRACAO_CARTAO : error.message); if (faltaColunaCartao(error.message)) setTemOrcCartao(false); return null; }
    const novo = data as Plano; setCartaoPlano(novo); return novo;
  }
  // recebe o valor JÁ numérico (não passa pelo parser pt-BR: aqui o ponto é decimal, não milhar)
  async function salvarOrcamentoCartao(valor: number) {
    const v = Math.round(valor * 100) / 100;
    if (!v && !cartaoPlano) return; // nada digitado e nada salvo: não cria à toa
    const p = await garantirCartaoPlano(); if (!p) return;
    const { error } = await sb.from("planos").update({ valor: v }).eq("id", p.id);
    if (!error) setCartaoPlano({ ...p, valor: v });
  }

  // ---------- orçamento da conta variável (linha especial, mesmo padrão do cartão) ----------
  async function garantirContaPlano(): Promise<Plano | null> {
    if (contaPlano) return contaPlano;
    const payload = {
      tipo: "fixo", nome: "Gastos na conta (orçamento)", categoria: null, valor: 0,
      mes_inicio: CARTAO_INICIO, mes_fim: null, parcelas: null, ativo: true,
      no_cartao: false, eh_cartao_total: false, eh_conta_total: true,
    };
    const { data, error } = await sb.from("planos").insert(payload).select().single();
    if (error) { setErro(faltaColunaConta(error.message) ? MSG_MIGRACAO_CONTA : error.message); if (faltaColunaConta(error.message)) setTemOrcConta(false); return null; }
    const novo = data as Plano; setContaPlano(novo); return novo;
  }
  async function salvarOrcamentoConta(valorStr: string) {
    const v = parseValor(valorStr);
    if (!v && !contaPlano) return;
    const p = await garantirContaPlano(); if (!p) return;
    const { error } = await sb.from("planos").update({ valor: v }).eq("id", p.id);
    if (!error) { setErro(""); setContaPlano({ ...p, valor: v }); }
  }

  // ---------- receita prevista (linha especial, mesmo padrão do orçamento da conta) ----------
  async function garantirReceitaPlano(): Promise<Plano | null> {
    if (receitaPlano) return receitaPlano;
    const payload = {
      tipo: "receita", nome: "Receita prevista", categoria: null, valor: 0,
      mes_inicio: CARTAO_INICIO, mes_fim: null, parcelas: null, ativo: true,
      no_cartao: false, eh_cartao_total: false, eh_conta_total: false, eh_receita_total: true,
    };
    const { data, error } = await sb.from("planos").insert(payload).select().single();
    if (error) { setErro(faltaColunaReceita(error.message) ? MSG_MIGRACAO_RECEITA : error.message); if (faltaColunaReceita(error.message)) setTemOrcReceita(false); return null; }
    const novo = data as Plano; setReceitaPlano(novo); return novo;
  }
  async function salvarOrcamentoReceita(valorStr: string) {
    const v = parseValor(valorStr);
    if (!v && !receitaPlano) return;
    const p = await garantirReceitaPlano(); if (!p) return;
    const { error } = await sb.from("planos").update({ valor: v }).eq("id", p.id);
    if (!error) { setErro(""); setReceitaPlano({ ...p, valor: v }); }
  }
  // duplo clique numa célula da Projeção: ajusta a receita prevista SÓ daquele mês (override)
  async function editarReceitaCelula(k: string) {
    let p = receitaPlano;
    if (!p) { p = await garantirReceitaPlano(); if (!p) return; }
    const o = ovr[k]?.[p.id];
    const v = o != null ? o : contribNoMes(p, k);
    setEditCell({ id: p.id, k });
    setEditVal(v ? String(v).replace(".", ",") : "");
  }
  async function salvarRealCartao(valorStr: string) {
    const v = parseValorN(valorStr);
    if (v == null && !cartaoPlano) return;
    const p = await garantirCartaoPlano(); if (!p) return;
    await upsert(p.id, comp, v, v != null || (mensal[comp]?.[p.id]?.pago ?? false));
  }
  async function togglePagoCartao() {
    const p = await garantirCartaoPlano(); if (!p) return;
    const cur = mensal[comp]?.[p.id];
    await upsert(p.id, comp, cur?.valor_real ?? null, !(cur?.pago ?? false));
  }
  // grava o total real do cartão lançado (origem cartão) como valor do mês
  async function usarCartaoLancado(v: number) {
    const p = await garantirCartaoPlano(); if (!p) return;
    await upsert(p.id, comp, v, true);
    setCartaoReal(String(v).replace(".", ","));
  }

  function abrirLink(p: Plano) { setLinkEdit(linkEdit === p.id ? null : p.id); setLinkForm({ categoria: p.link_categoria || "", texto: p.link_texto || "" }); }
  async function salvarLink(p: Plano) {
    const { error } = await sb.from("planos").update({ link_categoria: linkForm.categoria || null, link_texto: linkForm.texto.trim() || null }).eq("id", p.id);
    if (!error) { setLinkEdit(null); carregar(); }
  }

  // ---------- projeção ----------
  const meses = useMemo(() => horizonte(n), [n]);
  const proj = useMemo(() => projetar(planos, meses, cartaoPlano, contaPlano, receitaPlano, ovr), [planos, meses, cartaoPlano, contaPlano, receitaPlano, ovr]);

  // carrega os ajustes manuais dos meses da projeção (reaproveita plano_mensal.valor_real)
  const carregarOverrides = useCallback(async (ks: string[]) => {
    if (!ks.length) return;
    const { data, error } = await sb.from("plano_mensal").select("plano_id,competencia,valor_real").in("competencia", ks);
    if (error) return;
    const m: Record<string, Record<number, number>> = {};
    (data || []).forEach((r: any) => { if (r.valor_real != null) (m[r.competencia] = m[r.competencia] || {})[r.plano_id] = r.valor_real; });
    setOvr(m);
  }, []);
  useEffect(() => { if (!semTabela && view === "proj") carregarOverrides(meses.map((m) => m.k)); }, [view, meses, semTabela, carregarOverrides]);

  // valor efetivo de um item num mês da projeção (ajuste manual, senão a regra do item)
  const valProj = (p: Plano, k: string) => { const o = ovr[k]?.[p.id]; return o != null ? o : contribNoMes(p, k); };

  // duplo clique → começa a editar aquela célula
  function editarCelula(p: Plano, k: string) {
    if (!p.ativo) return;
    const v = valProj(p, k);
    setEditCell({ id: p.id, k });
    setEditVal(v ? String(v).replace(".", ",") : "");
  }
  // grava o ajuste manual; vazio ou igual à regra remove o override
  async function salvarOverride(p: Plano, k: string) {
    setEditCell(null);
    const base = contribNoMes(p, k);
    const v = parseValorN(editVal);
    const tinha = ovr[k]?.[p.id] != null;
    const pago = mensal[k]?.[p.id]?.pago ?? false;
    if (v == null || Math.abs(v - base) < 0.005) {
      if (!tinha) return; // nada a fazer
      await sb.from("plano_mensal").upsert({ plano_id: p.id, competencia: k, valor_real: null, pago }, { onConflict: "plano_id,competencia" });
      setOvr((o) => { const c = { ...(o[k] || {}) }; delete c[p.id]; return { ...o, [k]: c }; });
      // mantém o cache da visão Mês em sincronia (lê o mesmo plano_mensal por outro store)
      setMensal((m) => ({ ...m, [k]: { ...(m[k] || {}), [p.id]: { valor_real: null, pago } } }));
      return;
    }
    const { error } = await sb.from("plano_mensal").upsert({ plano_id: p.id, competencia: k, valor_real: v, pago }, { onConflict: "plano_id,competencia" });
    if (!error) {
      setOvr((o) => ({ ...o, [k]: { ...(o[k] || {}), [p.id]: v } }));
      setMensal((m) => ({ ...m, [k]: { ...(m[k] || {}), [p.id]: { valor_real: v, pago } } }));
    }
  }
  const gastoMedio = proj.length ? proj.reduce((s, m) => s + m.gerais, 0) / proj.length : 0;
  const saldoMedio = proj.length ? proj.reduce((s, m) => s + m.saldo, 0) / proj.length : 0;
  const maior = proj.reduce((a, m) => (m.gerais > a.gerais ? m : a), proj[0] || { gerais: 0, label: "—" });
  const comprometidoParc = planos
    .filter((p) => p.ativo && p.tipo === "parcelamento")
    .reduce((s, p) => s + meses.reduce((ss, m) => ss + contribNoMes(p, m.k), 0), 0);

  // ---------- visão mês: itens relevantes ----------
  const janela = useMemo(() => [...histMeses, comp], [histMeses, comp]);
  function relevante(p: Plano): boolean {
    if (!p.ativo) return false;
    return janela.some((c) => contribNoMes(p, c) !== 0 || mensal[c]?.[p.id]?.valor_real != null || (autos[p.id]?.[c] ?? null) != null);
  }
  const itensMes = useMemo(() => planos.filter(relevante), [planos, janela, mensal, autos]);
  const gastosMes = itensMes.filter((p) => !ehReceitaTipo(p.tipo));
  const receitasMes = itensMes.filter((p) => ehReceitaTipo(p.tipo));

  const somaPrev = (arr: Plano[], c: string) => arr.reduce((s, p) => s + contribNoMes(p, c), 0);
  const somaEfet = (arr: Plano[], c: string) => arr.reduce((s, p) => s + (dados(p, c).efetivo ?? 0), 0);

  // ---------- consolidação em 3 baldes que NÃO se sobrepõem (nada conta em dobro) ----------
  //  1) recorrentes  — itens fixos, qualquer forma de pagamento
  //  2) conta variável — o que saiu da conta (Pix/débito) ALÉM dos recorrentes
  //  3) cartão variável — o que caiu no cartão ALÉM dos recorrentes marcados
  const gastosRecorrentes = gastosMes.filter((p) => p.tipo === "fixo");        // fixos mensais
  const recorrNaConta = gastosRecorrentes.filter((p) => !p.no_cartao);          // recorrentes pagos na conta
  const recorrNoCartao = gastosRecorrentes.filter((p) => p.no_cartao);          // recorrentes pagos no cartão
  const gastosCartaoFlag = gastosMes.filter((p) => p.no_cartao);                // marcados como cartão
  const gastosContaItens = gastosMes.filter((p) => p.tipo !== "fixo" && !p.no_cartao); // avulsos pela conta (metas/parcelas/pagamentos)
  const gastosOutrosLista = gastosMes.filter((p) => p.tipo !== "fixo");          // itens não-recorrentes (listados após o total dos recorrentes)
  const orcCartao = (c: string) => (cartaoPlano && cartaoPlano.ativo ? contribNoMes(cartaoPlano, c) : 0);
  const realCartao = (c: string) => (cartaoPlano ? (mensal[c]?.[cartaoPlano.id]?.valor_real ?? null) : null);
  const orcConta = (c: string) => (contaPlano && contaPlano.ativo ? contribNoMes(contaPlano, c) : 0);
  // receita PREVISTA (linha especial): valor-base do mês, com ajuste por mês (override no plano_mensal).
  // É a MESMA fonte de dados da Projeção (lá o override vem de `ovr`; aqui, de `mensal`) — por isso
  // editar num lado reflete no outro.
  const orcReceita = (c: string) => (receitaPlano && receitaPlano.ativo ? contribNoMes(receitaPlano, c) : 0);
  const receitaPrevMes = (c: string): number => {
    const o = receitaPlano ? (mensal[c]?.[receitaPlano.id]?.valor_real ?? null) : null;
    return o != null ? o : orcReceita(c);
  };
  // total previsto de receita = receita prevista (linha editável) + itens de receita do plano (se houver)
  const receitaPrevTotal = (c: string) => receitaPrevMes(c) + somaPrev(receitasMes, c);

  // 1) recorrentes (fixos), independentemente da forma de pagamento
  const recorrPrev = (c: string) => somaPrev(gastosRecorrentes, c);
  const recorrEfet = (c: string) => somaEfet(gastosRecorrentes, c);

  // total REAL do cartão no mês: fatura digitada → lançado importado → soma dos marcados
  const cartaoTotalEfet = (c: string) => {
    const r = realCartao(c); if (r != null) return r;
    const a = autosCartao[c]; if (a != null) return a;
    const o = orcCartao(c); return o > 0 ? o : somaEfet(gastosCartaoFlag, c);
  };

  // 2) conta variável = total real da conta (lançamentos origem Conta) − recorrentes pagos na conta
  // previsto = orçamento que você define (via "↑ orçar") + itens avulsos pela conta (metas/parcelas/pagamentos)
  const contaVarPrev = (c: string): number | null => {
    const tot = orcConta(c) + somaPrev(gastosContaItens, c);
    return tot > 0 ? tot : null;
  };
  const contaVarEfet = (c: string): number | null => {
    const a = autosConta[c];
    return a == null ? null : Math.max(0, a - somaEfet(recorrNaConta, c));
  };
  // 2 dividido em duas linhas: gerais (orçamento) + outros (avulsos: metas/parcelas/pagamentos)
  const contaOutrosPrev = (c: string) => somaPrev(gastosContaItens, c);
  const contaOutrosEfet = (c: string) => somaEfet(gastosContaItens, c);
  const contaGeralPrev = (c: string): number | null => { const o = orcConta(c); return o > 0 ? o : null; };
  const contaGeralEfet = (c: string): number | null => {
    const a = autosConta[c];
    return a == null ? null : Math.max(0, a - somaEfet(recorrNaConta, c) - contaOutrosEfet(c));
  };
  // 3) cartão variável = total do cartão − recorrentes já marcados como cartão
  const cartaoVarPrev = (c: string): number | null => { const o = orcCartao(c); return o > 0 ? Math.max(0, o - somaPrev(recorrNoCartao, c)) : null; };
  const cartaoVarEfet = (c: string) => Math.max(0, cartaoTotalEfet(c) - somaEfet(recorrNoCartao, c));

  // mês ainda em aberto: só é "real" quando termina. Para o cartão, o gasto importado do
  // mês corrente é parcial (a fatura ainda fecha) — não chamamos de valor real até virar o mês.
  const mesFechado = (c: string) => c < mesAtual();
  const cartaoParcial = (c: string) => !mesFechado(c) && realCartao(c) == null && autosCartao[c] != null;
  const TIP_PARCIAL = "Mês em aberto: é o gasto parcial do cartão (lançamentos importados até agora), ainda não a fatura fechada. Vira valor real quando o mês terminar — ou digite a fatura na linha 💳 do rodapé.";

  // ---------- sugestão de orçamento: média móvel dos meses fechados do histórico ----------
  // Mostrada num POP-UP ao passar o mouse no valor (não substitui nada sozinha). Aplicar é
  // ação explícita (botão "Usar"); clicar no valor apenas edita o que já está lá.
  function dadosSugestao(tipo: "conta" | "cartao" | "receita") {
    const fn = tipo === "conta" ? contaGeralEfet
      : tipo === "cartao" ? cartaoVarEfet
      : (c: string) => autosReceita[c] ?? null; // receita: o que entrou de fato (lançado)
    const itens = histMeses.map((c) => ({ label: dvLabel(c), valor: fn(c) }));
    const vs = itens.map((m) => m.valor).filter((v): v is number => v != null);
    const media = vs.length ? Math.round(vs.reduce((a, b) => a + b, 0) / vs.length) : 0;
    return { itens, media, n: vs.length };
  }
  // valor já orçado/previsto da linha no mês atual (para editar sem sobrescrever)
  const orcAtual = (tipo: "conta" | "cartao" | "receita") =>
    tipo === "conta" ? contaGeralPrev(comp) : tipo === "cartao" ? cartaoVarPrev(comp) : (receitaPrevMes(comp) || null);
  function iniciarOrc(tipo: "conta" | "cartao" | "receita") {
    window.clearTimeout(sugCloseT.current); setSug(null); // some o pop-up ao entrar em edição
    const atual = orcAtual(tipo);
    // já tem previsto → edita o valor atual; vazio → parte da média como ponto de partida
    const base = atual != null ? atual : dadosSugestao(tipo).media;
    setOrcVal(base ? String(base).replace(".", ",") : "");
    setOrcEdit(tipo);
  }
  function usarMedia(tipo: "conta" | "cartao" | "receita") {
    const { media } = dadosSugestao(tipo);
    setOrcVal(media ? String(media).replace(".", ",") : "");
    setOrcEdit(tipo);
  }
  // pop-up de sugestão (hover): abre na posição do valor; fecha com pequeno atraso para
  // dar tempo de levar o mouse até a caixa e clicar em "Usar".
  function abrirSug(tipo: "conta" | "cartao" | "receita", el: HTMLElement) {
    window.clearTimeout(sugCloseT.current);
    const r = el.getBoundingClientRect();
    const w = 244, h = 168;
    const espacoAbaixo = window.innerHeight - r.bottom;
    const up = espacoAbaixo < h && r.top > espacoAbaixo;
    let left = r.left;
    if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
    setSug({ tipo, left: Math.max(8, left), top: up ? r.top : r.bottom, up });
  }
  const fecharSugLento = () => { sugCloseT.current = window.setTimeout(() => setSug(null), 140); };
  const fecharSugJa = () => { window.clearTimeout(sugCloseT.current); setSug(null); };
  async function salvarOrcConta() { setOrcEdit(null); await salvarOrcamentoConta(orcVal); }
  async function salvarOrcReceita() { setOrcEdit(null); await salvarOrcamentoReceita(orcVal); }
  async function salvarOrcCartaoVar() {
    setOrcEdit(null);
    // o digitado é o previsto VARIÁVEL; o orçamento TOTAL do cartão = variável + recorrentes já no cartão
    const total = parseValor(orcVal) + somaPrev(recorrNoCartao, comp);
    await salvarOrcamentoCartao(total);
  }

  // total geral consolidado = soma EXATA das quatro linhas exibidas, na ordem da planilha:
  //   Σ Gastos gerais = 🔁 recorrentes + 📦 outros + 🏦 conta (gerais) + 💳 cartão
  //   (equivale ao =+H17+H16+H13+H4 da célula; baldes disjuntos, nada conta em dobro)
  const geraisPrev = (c: string) => recorrPrev(c) + contaOutrosPrev(c) + (contaGeralPrev(c) ?? 0) + (cartaoVarPrev(c) ?? 0);
  const geraisEfet = (c: string) => recorrEfet(c) + contaOutrosEfet(c) + (contaGeralEfet(c) ?? 0) + cartaoVarEfet(c);

  // receita REAL do mês: o que entrou de fato (lançamentos classe Receita). Sem lançamento,
  // mês FECHADO cai só nos itens de receita do plano (não na receita prevista — coluna é "real");
  // mês corrente/futuro (aberto) usa o previsto cheio como estimativa. Base do Saldo "real".
  const receitaReal = (c: string): number => {
    const a = autosReceita[c];
    if (a != null) return a;
    return c < mesAtual() ? somaEfet(receitasMes, c) : receitaPrevTotal(c);
  };
  const prevRec = receitaPrevTotal(comp), efetRec = receitaReal(comp);
  const prevGer = geraisPrev(comp), efetGer = geraisEfet(comp);
  const preenchidos = gastosMes.filter((p) => dados(p, comp).manual != null).length;
  const conflitos = itensMes.filter((p) => dados(p, comp).conflito).length;

  // ---------- tabelas ainda não existem ----------
  if (semTabela) {
    return (
      <Panel title="Quase lá — falta criar as tabelas" sub="passo único de configuração">
        <p className="text-[13.5px] leading-relaxed mb-3">
          Rode em <b>Supabase → SQL Editor → New query → Run</b> a migração{" "}
          <code className="text-[12px] bg-fill px-1 py-[1px] rounded">supabase/migrations/*_unificar_planejamento.sql</code>{" "}
          (traz seus dados de Orçamento). Em uma base nova, basta o SQL abaixo:
        </p>
        <div className="relative">
          <pre className="bg-fill border border-line rounded-[10px] p-3 text-[11.5px] overflow-x-auto scroll-thin leading-snug">{SQL_HINT}</pre>
          <button
            onClick={() => { navigator.clipboard?.writeText(SQL_HINT); setCopiado(true); setTimeout(() => setCopiado(false), 1500); }}
            className="absolute top-2 right-2 btn bg-accent hover:bg-accent2 text-onaccent rounded-[8px] px-3 py-[5px] text-[12px] border-0"
          >{copiado ? "copiado!" : "copiar"}</button>
        </div>
        <button onClick={carregar} className="mt-4 btn bg-accent hover:bg-accent2 text-onaccent rounded-[8px] px-4 py-[8px] text-[13px] border-0">Já rodei — verificar</button>
      </Panel>
    );
  }

  const colCount = 1 + meses.length + 1;
  const minW = 250 + meses.length * 64 + 90;
  const podeCategoria = form.tipo !== "receita";
  const temFim = form.tipo === "fixo" || form.tipo === "receita";
  const ehMeta = form.tipo === "meta";
  const ehMesUnico = form.tipo === "pagamento" || form.tipo === "parcelamento";

  // botão 💳 por item: marca que o gasto cai no cartão de crédito
  function CartaoToggle({ p }: { p: Plano }) {
    if (!temCartaoCol || ehReceitaTipo(p.tipo)) return null;
    return (
      <button
        onClick={() => toggleCartao(p)}
        title={p.no_cartao ? "Está no cartão de crédito — clique para tirar" : "Marcar: este gasto cai no cartão de crédito"}
        className={`shrink-0 text-[12px] leading-none rounded-[7px] px-[7px] py-[4px] border transition-colors cursor-pointer ${p.no_cartao ? "bg-violet/15 border-violet text-violet" : "bg-transparent border-line text-muted hover:border-violet hover:text-violet"}`}
      >💳</button>
    );
  }

  // linha de item na visão "Mês"
  function LinhaMes(p: Plano) {
    const d = dados(p, comp);
    const rec = ehReceitaTipo(p.tipo);
    return (
      <Fragment key={p.id}>
        <tr {...dropProps(p)} className={dropAlvo === p.id ? "bg-accent/10" : ""}>
          <td className="font-medium !pl-[10px]">
            <div className="flex items-center gap-2">
              <DragHandle p={p} />
              <input type="checkbox" checked={p.ativo} onChange={() => toggleAtivo(p)} title="ativo" className="cursor-pointer" />
              <div className="min-w-0">
                <div className="truncate">{p.nome}{(p.link_categoria || p.link_texto) && <span title="vínculo a lançamentos" className="ml-1 text-accent text-[11px]">🔗</span>}</div>
                <div className="text-muted text-[11px] font-normal">{resumoItem(p)}</div>
              </div>
              <CartaoToggle p={p} />
            </div>
          </td>
          <td className="text-muted hidden md:table-cell">{p.categoria || "—"}</td>
          {histMeses.map((c) => <td key={c} className="num text-muted hidden md:table-cell">{fmt(dados(p, c).efetivo)}</td>)}
          <td className="num text-muted">{d.previsto ? fmt(d.previsto) : "—"}</td>
          <td className="num">
            <input className={`${inp} w-[100px] text-right ${d.conflito ? "!border-red" : ""} ${rec ? "text-green" : ""}`} value={reais[p.id] ?? ""}
              placeholder={d.auto != null ? fmt(d.auto) : (d.previsto ? fmt(d.previsto) : "—")}
              onChange={(e) => setReais((r) => ({ ...r, [p.id]: e.target.value }))} onBlur={(e) => salvarReal(p, e.target.value)} />
            {d.auto != null && (d.conflito || d.manual == null) && (
              <div className={`text-[11px] mt-1 flex items-center gap-1 justify-end ${d.conflito ? "text-red" : "text-muted"}`}>
                {d.conflito ? "⚠ lançado" : "lançado"} {fmt(d.auto)}
                <button onClick={() => usarLancado(p, d.auto as number)} className="bg-transparent border-0 p-0 cursor-pointer underline text-accent">usar</button>
              </div>
            )}
          </td>
          <td className="!text-center">
            <button onClick={() => togglePago(p)} title={d.pago ? "Pago" : "Marcar pago"}
              className={`tap w-7 h-7 rounded-[8px] border-2 flex items-center justify-center mx-auto text-[15px] font-bold cursor-pointer transition-colors ${d.pago ? "bg-green border-green text-onaccent" : "bg-transparent border-line text-transparent hover:border-green"}`}>✓</button>
          </td>
          <td className="!text-center whitespace-nowrap text-[12px]">
            <button onClick={() => abrirLink(p)} className="bg-transparent border-0 p-0 cursor-pointer text-muted hover:text-accent transition-colors">vincular</button>
            <span className="text-line mx-1">·</span>
            <button onClick={() => editar(p)} className="bg-transparent border-0 p-0 cursor-pointer text-muted hover:text-accent transition-colors">editar</button>
            <span className="text-line mx-1">·</span>
            <button onClick={() => remover(p)} className="bg-transparent border-0 p-0 cursor-pointer text-muted hover:text-red transition-colors">remover</button>
          </td>
        </tr>
        {linkEdit === p.id && (
          <tr className="bg-accent/5">
            <td colSpan={9} className="!p-[12px]">
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <span className="text-muted">Vincular <b>{p.nome}</b> à despesa real onde:</span>
                <span>categoria</span>
                <select className={`select-chev ${inp} cursor-pointer`} value={linkForm.categoria} onChange={(e) => setLinkForm((f) => ({ ...f, categoria: e.target.value }))}>
                  {catOpcoes.map((c) => <option key={c} value={c}>{c || "(qualquer)"}</option>)}
                </select>
                <span>e/ou descrição contém</span>
                <input className={`${inp} w-[200px]`} placeholder="ex.: adas imove" value={linkForm.texto} onChange={(e) => setLinkForm((f) => ({ ...f, texto: e.target.value }))} />
                <button onClick={() => salvarLink(p)} className="btn bg-accent hover:bg-accent2 text-onaccent rounded-[8px] px-3 py-[6px] text-[12px] border-0">Salvar vínculo</button>
                <button onClick={() => setLinkEdit(null)} className="bg-transparent border-0 p-0 cursor-pointer text-muted text-[12px]">cancelar</button>
              </div>
            </td>
          </tr>
        )}
      </Fragment>
    );
  }

  // cabeçalho de um grupo colapsável na visão "Mês": o "grande nome" no topo já com o
  // total do mês (hist./previsto/real) na própria linha; clicar minimiza/expande os itens.
  function GrupoMes({ gkey, titulo, sub, histFn, prev, real, count, dashZero = false, colorCls = "" }: {
    gkey: string; titulo: string; sub?: string;
    histFn: (c: string) => number | null; prev: number | null; real: number | null;
    count: number; dashZero?: boolean; colorCls?: string;
  }) {
    const col = !!colapsado[gkey];
    const cell = (v: number | null) => (v == null || (dashZero && !v) ? "—" : fmtCell(v));
    return (
      <tr className={`font-bold bg-card2 ${colorCls}`}>
        <td className="border-t-2 !border-t-line" colSpan={2}>
          <button onClick={() => toggleGrupo(gkey)} title={col ? "Mostrar os itens deste grupo" : "Minimizar: esconder os itens e ver só o total"}
            className="bg-transparent border-0 p-0 cursor-pointer inline-flex items-center gap-[6px] text-left text-inherit font-bold">
            <span className="text-muted w-[10px] text-[10px] leading-none">{col ? "▶" : "▼"}</span>
            <span>{titulo}{sub && <span className="text-muted font-normal"> · {sub}</span>}{col && <span className="text-muted font-normal text-[11px]"> · {count} {count === 1 ? "item" : "itens"}</span>}</span>
          </button>
        </td>
        {histMeses.map((c) => <td key={c} className="num border-t-2 !border-t-line hidden md:table-cell">{cell(histFn(c))}</td>)}
        <td className="num border-t-2 !border-t-line">{cell(prev)}</td>
        <td className="num border-t-2 !border-t-line">{cell(real)}</td>
        <td className="border-t-2 !border-t-line" colSpan={2}></td>
      </tr>
    );
  }

  // linha de item na visão "Projeção" (uma célula por mês do horizonte, com duplo clique p/ ajuste)
  function LinhaProj(p: Plano) {
    return (
      <tr key={p.id} {...dropProps(p)} className={`${p.ativo ? "" : "opacity-45"} ${dropAlvo === p.id ? "bg-accent/10" : ""}`}>
        <td className="sticky left-0 z-10 bg-card min-w-[150px] max-w-[46vw] md:min-w-[230px] md:max-w-none !pl-[10px]">
          <div className="flex items-center gap-2">
            <DragHandle p={p} />
            <input type="checkbox" checked={p.ativo} onChange={() => toggleAtivo(p)} title={p.ativo ? "ativo" : "ignorado"} className="cursor-pointer" />
            <div className="min-w-0">
              <div className="font-medium truncate">{p.nome}{p.categoria && <span className="text-muted text-[11px] font-normal"> · {p.categoria}</span>}</div>
              <div className="text-muted text-[11px]">{resumoItem(p)}</div>
            </div>
            <CartaoToggle p={p} />
          </div>
        </td>
        {meses.map((m) => {
          const editando = editCell?.id === p.id && editCell?.k === m.k;
          const ajustado = ovr[m.k]?.[p.id] != null;
          const v = p.ativo ? valProj(p, m.k) : 0;
          return (
            <td key={m.k} onClick={() => { if (!editando) editarCelula(p, m.k); }}
              title={p.ativo ? "clique/toque para ajustar só este mês" : undefined}
              className={`num ${ehReceitaTipo(p.tipo) ? "text-green" : ""} ${p.ativo && !editando ? "cursor-pointer" : ""}`}>
              {editando ? (
                <input autoFocus className={`${inp} w-[58px] text-right`} value={editVal}
                  onChange={(e) => setEditVal(e.target.value)}
                  onBlur={() => salvarOverride(p, m.k)}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); else if (e.key === "Escape") setEditCell(null); }} />
              ) : v ? (
                <span className={`${editavel} ${ajustado ? "border-accent text-accent font-medium underline decoration-dotted underline-offset-2" : "border-line hover:border-accent"}`}
                  title={ajustado ? "ajustado manualmente" : "clique/toque para ajustar só este mês"}>
                  {fmtCell(v)}
                </span>
              ) : (
                <span className="text-line">·</span>
              )}
            </td>
          );
        })}
        <td className="whitespace-nowrap text-[12px] text-right">
          <button onClick={() => editar(p)} className="bg-transparent border-0 p-0 cursor-pointer text-muted hover:text-accent transition-colors">editar</button>
          <span className="text-line mx-1">·</span>
          <button onClick={() => remover(p)} className="bg-transparent border-0 p-0 cursor-pointer text-muted hover:text-red transition-colors">remover</button>
        </td>
      </tr>
    );
  }

  // cabeçalho de um grupo colapsável na visão "Projeção": "grande nome" no topo com o total
  // por mês do horizonte na própria linha; clicar minimiza/expande os itens (mesmo padrão do Mês).
  function GrupoProj({ gkey, titulo, sub, valor, count, colorCls = "" }: {
    gkey: string; titulo: string; sub?: string;
    valor: (i: number) => number; count: number; colorCls?: string;
  }) {
    const col = !!colapsado[gkey];
    return (
      <tr className={`font-bold bg-card2 ${colorCls}`}>
        <td className="border-t-2 !border-t-line sticky left-0 z-10 bg-card2">
          <button onClick={() => toggleGrupo(gkey)} title={col ? "Mostrar os itens deste grupo" : "Minimizar: esconder os itens e ver só o total"}
            className="bg-transparent border-0 p-0 cursor-pointer inline-flex items-center gap-[6px] text-left text-inherit font-bold">
            <span className="text-muted w-[10px] text-[10px] leading-none">{col ? "▶" : "▼"}</span>
            <span>{titulo}{sub && <span className="text-muted font-normal"> · {sub}</span>}{col && <span className="text-muted font-normal text-[11px]"> · {count} {count === 1 ? "item" : "itens"}</span>}</span>
          </button>
        </td>
        {proj.map((m, i) => { const v = valor(i); return <td key={m.k} className={`num border-t-2 !border-t-line ${i === 0 ? "text-accent" : ""}`}>{v ? fmtCell(v) : <span className="text-line">·</span>}</td>; })}
        <td className="border-t-2 !border-t-line"></td>
      </tr>
    );
  }

  return (
    <div>
      <Toolbar
        right={view === "mes"
          ? <span className="text-muted text-[12px]">{preenchidos}/{gastosMes.length} preenchidos{conflitos ? ` · ${conflitos} conflito(s)` : ""}</span>
          : <span className="text-muted text-[12px]">{planos.filter((p) => p.ativo).length} itens ativos</span>}
      >
        <Seg value={view} onChange={(v) => setView(v as "mes" | "proj")} options={[{ v: "mes", label: "Mês · real" }, { v: "proj", label: "Projeção" }]} />
        {view === "mes"
          ? <Select value={comp} onChange={setComp}>{MES_SELECT.map((m) => <option key={m.v} value={m.v}>{m.label}</option>)}</Select>
          : <Seg value={String(n)} onChange={(v) => setN(+v)} options={[{ v: "6", label: "6 meses" }, { v: "12", label: "12 meses" }, { v: "18", label: "18 meses" }]} />}
      </Toolbar>

      {erro && <div className="bg-card border border-line rounded-[14px] p-3 shadow-card text-red mb-[18px] text-[13px]">{erro}</div>}

      {view === "mes" ? (
        <>
          {sug && createPortal(
            <div
              className="fixed z-[71] bg-card border border-line rounded-[12px] shadow-pop p-3 text-[12px] fade-in"
              style={{ left: sug.left, width: 244, ...(sug.up ? { bottom: window.innerHeight - sug.top + 6 } : { top: sug.top + 6 }) }}
              onMouseEnter={() => window.clearTimeout(sugCloseT.current)}
              onMouseLeave={fecharSugJa}
            >
              {(() => {
                const { itens, media, n } = dadosSugestao(sug.tipo);
                const base = sug.tipo === "conta" ? "gasto na conta (gerais)"
                  : sug.tipo === "cartao" ? "gasto no cartão (fora recorrentes)" : "receita que entrou (lançada)";
                const cor = sug.tipo === "cartao" ? "bg-violet" : sug.tipo === "receita" ? "bg-green" : "bg-accent";
                return (
                  <>
                    <button onClick={fecharSugJa} aria-label="Fechar"
                      className="tap absolute top-[6px] right-[6px] w-[22px] h-[22px] rounded-full bg-fill text-muted border-0 cursor-pointer flex items-center justify-center text-[11px] md:hidden">✕</button>
                    <div className="font-semibold text-txt mb-[2px]">📊 Média móvel</div>
                    <div className="text-muted mb-2 leading-snug">média do {base} nos meses fechados do histórico</div>
                    <div className="flex flex-col gap-[3px] mb-[10px]">
                      {itens.map((m) => (
                        <div key={m.label} className="flex justify-between tabular-nums">
                          <span className="text-muted">{m.label}</span>
                          <span className={m.valor == null ? "text-line" : "text-txt"}>{m.valor == null ? "sem dado" : fmtCell(m.valor)}</span>
                        </div>
                      ))}
                      <div className="flex justify-between border-t border-line pt-[4px] mt-[1px] font-semibold tabular-nums">
                        <span>média{n ? ` · ${n}` : ""}</span><span>{media ? fmtCell(media) : "—"}</span>
                      </div>
                    </div>
                    {n > 0 ? (
                      <button onClick={() => { usarMedia(sug.tipo); fecharSugJa(); }}
                        className={`btn w-full ${cor} hover:opacity-90 text-white rounded-[8px] px-3 py-[6px] text-[12px] border-0 transition-opacity`}>
                        Usar {fmtCell(media)} como previsto
                      </button>
                    ) : (
                      <div className="text-muted text-[11.5px]">Sem meses fechados com dado para sugerir uma média.</div>
                    )}
                  </>
                );
              })()}
            </div>,
            document.body
          )}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-[14px] mb-[18px]">
            <Kpi title={`Gastos previstos · ${dvLabel(comp)}`} value={BRL0(prevGer)} sub="recorrentes (plano)" />
            <Kpi title="Gastos realizados" value={BRL0(efetGer)} sub={cartaoParcial(comp) ? "cartão ainda parcial · mês em aberto" : "recorrente + conta + cartão"} color="text-amber" />
            <Kpi title="Saldo previsto" value={BRL0(prevRec - prevGer)} sub="receita − gastos (plano)" color={prevRec - prevGer < 0 ? "text-red" : "text-green"} />
            <Kpi title="Saldo realizado" value={BRL0(efetRec - efetGer)} sub="receita − gastos (real)" color={efetRec - efetGer < 0 ? "text-red" : "text-green"} />
          </div>

          <div className="bg-card border border-line rounded-[18px] shadow-card overflow-hidden">
            <div className="overflow-x-auto scroll-thin">
              <table className="tbl min-w-[560px] md:min-w-[960px]">
                <thead>
                  <tr>
                    <th rowSpan={2} className="!text-left">Item</th>
                    <th rowSpan={2} className="hidden md:table-cell">Categoria</th>
                    <th colSpan={3} className="!text-center !p-[6px] !text-[10px] hidden md:table-cell">Realizado — meses anteriores</th>
                    <th colSpan={2} className="!text-center text-accent">{dvLabel(comp)}</th>
                    <th rowSpan={2} className="!text-center">Pago</th>
                    <th rowSpan={2}></th>
                  </tr>
                  <tr>
                    {histMeses.map((c) => <th key={c} className="num !font-normal hidden md:table-cell">{dvLabel(c)}</th>)}
                    <th className="num">Previsto</th>
                    <th className="num">Real</th>
                  </tr>
                </thead>
                <tbody>
                  {/* GASTOS — grupos colapsáveis: cada "grande nome" (recorrentes, outros) traz o
                      total na própria linha-cabeçalho e lista os itens logo abaixo (dá pra minimizar). */}
                  {!!gastosMes.length && <tr className="bg-card2"><td colSpan={9} className="!py-[6px] text-[11px] uppercase tracking-wide text-muted font-semibold">Gastos</td></tr>}

                  {/* 🔁 Gastos recorrentes (fixos) — cabeçalho com total no topo; itens logo abaixo */}
                  {!loading && !!gastosRecorrentes.length && (
                    <GrupoMes gkey="recorrentes" titulo="🔁 Gastos recorrentes" sub="fixos mensais"
                      histFn={recorrEfet} prev={recorrPrev(comp)} real={recorrEfet(comp)} count={gastosRecorrentes.length} />
                  )}
                  {!colapsado.recorrentes && gastosRecorrentes.map(LinhaMes)}

                  {/* 📦 Outros gastos (parcelas, metas, pagamentos) — cabeçalho com total no topo; itens abaixo */}
                  {!loading && !!gastosOutrosLista.length && (
                    <GrupoMes gkey="outros" titulo="📦 Outros gastos" sub="parcelamento, meta…"
                      histFn={contaOutrosEfet} prev={contaOutrosPrev(comp)} real={contaOutrosEfet(comp)} count={gastosOutrosLista.length} dashZero />
                  )}
                  {!colapsado.outros && gastosOutrosLista.map(LinhaMes)}

                  {!loading && (!!itensMes.length || !!receitaPlano || !!contaPlano || !!cartaoPlano) && (
                    <Fragment key="resumo-gastos">
                      {/* 🏦 conta — gerais (orçado) · começa o bloco consolidado (borda no topo) */}
                      <tr className="text-[12.5px]" title="gasto corriqueiro da conta (Pix/débito) que você orça; realizado = o que saiu da conta além dos recorrentes e dos itens avulsos">
                        <td colSpan={2} className="border-t-2 !border-t-line">🏦 Gastos na conta <span className="text-muted font-normal">· gerais (orçado)</span></td>
                        {histMeses.map((c) => { const v = contaGeralEfet(c); return <td key={c} className="num text-muted border-t-2 !border-t-line hidden md:table-cell">{v == null ? "—" : fmtCell(v)}</td>; })}
                        <td className="num text-muted !py-1 border-t-2 !border-t-line">
                          {orcEdit === "conta" ? (
                            <input autoFocus className={`${inp} w-[84px] text-right`} value={orcVal}
                              onChange={(e) => setOrcVal(e.target.value)} onBlur={salvarOrcConta}
                              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); else if (e.key === "Escape") setOrcEdit(null); }} />
                          ) : (
                            <span className="inline-block" onMouseEnter={(e) => abrirSug("conta", e.currentTarget)} onMouseLeave={fecharSugLento}>
                              <button onClick={() => iniciarOrc("conta")} title="clique para digitar o previsto · passe o mouse para ver a média móvel"
                                className={`${editavel} border-line bg-transparent cursor-pointer hover:border-accent hover:text-accent`}>
                                {contaGeralPrev(comp) == null ? <span className="text-accent">↑ orçar</span> : fmtCell(contaGeralPrev(comp) as number)}
                              </button>
                              <button onClick={(e) => { e.stopPropagation(); abrirSug("conta", e.currentTarget); }} title="ver média móvel"
                                className="md:hidden tap ml-1 bg-transparent border-0 p-0 cursor-pointer text-[12px] align-middle">📊</button>
                            </span>
                          )}
                        </td>
                        <td className="num text-muted border-t-2 !border-t-line">{(() => { const v = contaGeralEfet(comp); return v == null ? "—" : fmtCell(v); })()}</td>
                        <td colSpan={2} className="border-t-2 !border-t-line"></td>
                      </tr>
                      {/* 💳 cartão variável, fora os recorrentes marcados */}
                      <tr className="text-violet text-[12.5px]" title="o que caiu no cartão além dos recorrentes marcados — vem dos lançamentos importados (origem Cartao)">
                        <td colSpan={2}>💳 Gastos no cartão <span className="text-muted font-normal">· fora os recorrentes</span></td>
                        {histMeses.map((c) => <td key={c} className="num hidden md:table-cell">{fmtCell(cartaoVarEfet(c))}</td>)}
                        <td className="num !py-1">
                          {orcEdit === "cartao" ? (
                            <input autoFocus className={`${inp} w-[84px] text-right`} value={orcVal}
                              onChange={(e) => setOrcVal(e.target.value)} onBlur={salvarOrcCartaoVar}
                              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); else if (e.key === "Escape") setOrcEdit(null); }} />
                          ) : (
                            <span className="inline-block" onMouseEnter={(e) => abrirSug("cartao", e.currentTarget)} onMouseLeave={fecharSugLento}>
                              <button onClick={() => iniciarOrc("cartao")} title="clique para digitar o previsto · passe o mouse para ver a média móvel"
                                className={`${editavel} border-line bg-transparent cursor-pointer hover:border-violet hover:text-violet`}>
                                {cartaoVarPrev(comp) == null ? <span className="text-violet">↑ orçar</span> : fmtCell(cartaoVarPrev(comp) as number)}
                              </button>
                              <button onClick={(e) => { e.stopPropagation(); abrirSug("cartao", e.currentTarget); }} title="ver média móvel"
                                className="md:hidden tap ml-1 bg-transparent border-0 p-0 cursor-pointer text-[12px] align-middle">📊</button>
                            </span>
                          )}
                        </td>
                        <td className={`num ${cartaoParcial(comp) ? "!text-muted" : ""}`} title={cartaoParcial(comp) ? TIP_PARCIAL : undefined}>
                          {fmtCell(cartaoVarEfet(comp))}{cartaoParcial(comp) && <span className="font-normal text-[10px] text-muted"> · parcial</span>}
                        </td>
                        <td colSpan={2}></td>
                      </tr>
                      {/* Σ total geral consolidado */}
                      <tr className="font-bold">
                        <td colSpan={2}>Σ Gastos gerais</td>
                        {histMeses.map((c) => <td key={c} className="num hidden md:table-cell">{fmtCell(geraisEfet(c))}</td>)}
                        <td className="num">{fmtCell(geraisPrev(comp))}</td>
                        <td className="num" title={cartaoParcial(comp) ? TIP_PARCIAL : undefined}>{fmtCell(geraisEfet(comp))}{cartaoParcial(comp) && <span className="font-normal text-[10px] text-muted"> *</span>}</td>
                        <td colSpan={2}></td>
                      </tr>
                      {/* 💰 Receitas — Hist/Real = lançado (real); Previsto = receita prevista editável (mesma da Projeção, conectado) */}
                      <tr className="text-green text-[12.5px]" title="Hist. e Real = o que de fato entrou no mês (seus lançamentos). Previsto = a receita que você planeja por mês: clique para definir o valor-base; ajuste só um mês na aba Projeção (um clique/toque). É a mesma receita prevista da Projeção — editar aqui muda lá e vice-versa.">
                        <td colSpan={2}>💰 Receitas <span className="text-muted font-normal">· real lançado · previsto editável</span></td>
                        {histMeses.map((c) => { const v = receitaReal(c); return <td key={c} className="num hidden md:table-cell">{v ? fmtCell(v) : "—"}</td>; })}
                        <td className="num !py-1">
                          {orcEdit === "receita" ? (
                            <input autoFocus className={`${inp} w-[84px] text-right`} value={orcVal}
                              onChange={(e) => setOrcVal(e.target.value)} onBlur={salvarOrcReceita}
                              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); else if (e.key === "Escape") setOrcEdit(null); }} />
                          ) : (
                            <span className="inline-block" onMouseEnter={(e) => abrirSug("receita", e.currentTarget)} onMouseLeave={fecharSugLento}>
                              <button onClick={() => iniciarOrc("receita")} title="clique para digitar a receita prevista · passe o mouse para ver a média do que entrou. Para mudar só um mês, use a aba Projeção."
                                className={`${editavel} border-line bg-transparent cursor-pointer hover:border-green hover:text-green`}>
                                {(() => {
                                  const v = receitaPrevMes(comp);
                                  const ajust = !!receitaPlano && (mensal[comp]?.[receitaPlano.id]?.valor_real ?? null) != null;
                                  return v
                                    ? <span className={ajust ? "underline decoration-dotted underline-offset-2" : ""} title={ajust ? "ajustado neste mês na aba Projeção" : undefined}>{fmtCell(v)}</span>
                                    : <span className="text-green underline decoration-dotted">↑ prever</span>;
                                })()}
                              </button>
                              <button onClick={(e) => { e.stopPropagation(); abrirSug("receita", e.currentTarget); }} title="ver média móvel"
                                className="md:hidden tap ml-1 bg-transparent border-0 p-0 cursor-pointer text-[12px] align-middle">📊</button>
                            </span>
                          )}
                        </td>
                        <td className="num">{efetRec ? fmtCell(efetRec) : "—"}</td>
                        <td colSpan={2}></td>
                      </tr>
                      {/* Saldo do mês = receita − gerais */}
                      <tr className="font-bold">
                        <td className="border-t-2 !border-t-line" colSpan={2}>Saldo do mês</td>
                        {histMeses.map((c) => { const s = receitaReal(c) - geraisEfet(c); return <td key={c} className={`num border-t-2 !border-t-line hidden md:table-cell ${s < 0 ? "text-red" : "text-green"}`}>{fmtCell(s)}</td>; })}
                        <td className={`num border-t-2 !border-t-line ${prevRec - prevGer < 0 ? "text-red" : "text-green"}`}>{fmtCell(prevRec - prevGer)}</td>
                        <td className={`num border-t-2 !border-t-line ${efetRec - efetGer < 0 ? "text-red" : "text-green"}`}>{fmtCell(efetRec - efetGer)}</td>
                        <td className="border-t-2 !border-t-line" colSpan={2}></td>
                      </tr>
                    </Fragment>
                  )}

                  {/* RECEITAS — abaixo do saldo */}
                  {!!receitasMes.length && <tr className="bg-card2"><td colSpan={9} className="!pt-[14px] !pb-[6px] text-[11px] uppercase tracking-wide text-muted font-semibold">Receitas</td></tr>}
                  {receitasMes.map(LinhaMes)}
                  {!!receitasMes.length && (
                    <tr className="font-bold text-green">
                      <td colSpan={2}>Σ Receitas previstas <span className="text-muted font-normal">· plano</span></td>
                      {histMeses.map((c) => <td key={c} className="num hidden md:table-cell">{fmtCell(somaEfet(receitasMes, c))}</td>)}
                      <td className="num">{fmtCell(somaPrev(receitasMes, comp))}</td>
                      <td className="num">{fmtCell(somaEfet(receitasMes, comp))}</td>
                      <td colSpan={2}></td>
                    </tr>
                  )}

                  {!loading && !itensMes.length && <tr><td colSpan={9} className="!p-4 text-muted">Nenhum item ativo neste mês. Adicione abaixo.</td></tr>}
                  {loading && <tr><td colSpan={9} className="!p-4 text-muted">Carregando…</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-[14px] mb-[18px]">
            <Kpi title="Gasto médio / mês" value={BRL0(gastoMedio)} sub={`projeção de ${n} meses`} />
            <Kpi title="Maior mês" value={BRL0(maior.gerais)} sub={maior.label} color="text-amber" />
            <Kpi title="Em parcelas (período)" value={BRL0(comprometidoParc)} sub="parcelamentos no horizonte" color="text-violet" />
            <Kpi title="Saldo médio / mês" value={BRL0(saldoMedio)} sub={saldoMedio < 0 ? "no vermelho" : "sobra prevista"} color={saldoMedio < 0 ? "text-red" : "text-green"} />
          </div>

          <div className="bg-card border border-line rounded-[18px] shadow-card overflow-hidden">
            <div className="overflow-x-auto scroll-thin">
              <table className="tbl" style={{ minWidth: minW }}>
                <thead>
                  <tr>
                    <th className="!text-left sticky left-0 z-20 bg-card">Item</th>
                    {meses.map((m, i) => <th key={m.k} className={`num ${i === 0 ? "text-accent" : ""}`}>{m.label}</th>)}
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {/* mesma estrutura da visão "Mês": grupos colapsáveis com o total no cabeçalho */}
                  {(() => {
                    const fixos = planos.filter((p) => p.tipo === "fixo");
                    const outros = planos.filter((p) => p.tipo !== "fixo" && !ehReceitaTipo(p.tipo));
                    return (
                      <>
                        {/* 🔁 Gastos recorrentes (fixos) — cabeçalho com total no topo; itens logo abaixo */}
                        {!!fixos.length && <GrupoProj gkey="proj-fixo" titulo="🔁 Gastos recorrentes" sub="fixos mensais" valor={(i) => proj[i].recorr} count={fixos.length} />}
                        {!!fixos.length && !colapsado["proj-fixo"] && fixos.map(LinhaProj)}
                        {/* 📦 Outros gastos (parcelamentos, pagamentos, metas) — cabeçalho com total no topo; itens abaixo */}
                        {!!outros.length && <GrupoProj gkey="proj-outros" titulo="📦 Outros gastos" sub="parcelamento, meta…" valor={(i) => proj[i].contaOutros} count={outros.length} />}
                        {!!outros.length && !colapsado["proj-outros"] && outros.map(LinhaProj)}
                      </>
                    );
                  })()}
                  {!loading && !planos.length && <tr><td colSpan={colCount} className="!p-4 text-muted">Nenhum item ainda. Adicione abaixo.</td></tr>}
                  {loading && <tr><td colSpan={colCount} className="!p-4 text-muted">Carregando…</td></tr>}
                </tbody>
                {(!!planos.length || cartaoPlano || contaPlano || receitaPlano) && (
                  <tfoot>
                    {/* mesma estrutura da visão "Mês": baldes disjuntos → Σ gerais → saldo.
                        (o total dos recorrentes fica no tbody, logo abaixo dos fixos) */}
                    {/* 🏦 conta — gerais (orçado) */}
                    <tr className="text-[12.5px]" title="orçamento previsto da conta (definido na visão Mês via ↑ orçar) — o gasto corriqueiro de Pix/débito">
                      <td className="border-t-2 !border-t-line sticky left-0 z-10 bg-card">🏦 Gastos na conta <span className="text-muted font-normal">· gerais (orçado)</span></td>
                      {proj.map((m, i) => <td key={m.k} className={`num text-muted border-t-2 !border-t-line ${i === 0 ? "!text-accent" : ""}`}>{m.contaOrc ? fmtCell(m.contaOrc) : <span className="text-line">·</span>}</td>)}
                      <td className="border-t-2 !border-t-line"></td>
                    </tr>
                    {/* 💳 cartão variável (total do cartão fora os recorrentes marcados) */}
                    <tr className="text-violet text-[12.5px]" title="total do cartão (orçamento, senão soma dos itens marcados 💳) além dos recorrentes já marcados">
                      <td className="sticky left-0 z-10 bg-card">💳 Gastos no cartão <span className="text-muted font-normal">· fora os recorrentes</span></td>
                      {proj.map((m, i) => <td key={m.k} className={`num ${i === 0 ? "!text-accent" : ""}`}>{m.cartaoVar ? fmtCell(m.cartaoVar) : <span className="text-line">·</span>}</td>)}
                      <td></td>
                    </tr>
                    {/* Σ total geral consolidado */}
                    <tr className="font-bold">
                      <td className="sticky left-0 z-10 bg-card">Σ Gastos gerais</td>
                      {proj.map((m, i) => <td key={m.k} className={`num ${i === 0 ? "text-accent" : ""}`}>{fmtCell(m.gerais)}</td>)}
                      <td></td>
                    </tr>
                    {/* 💰 Receita prevista — editável por mês (duplo clique ajusta só aquele mês); valor-base vem da visão Mês (↑ prever) */}
                    <tr className="text-green">
                      <td className="sticky left-0 z-10 bg-card">💰 Receita prevista <span className="text-muted font-normal">· clique p/ ajustar o mês</span></td>
                      {proj.map((m, i) => {
                        const p = receitaPlano;
                        const editando = !!p && editCell?.id === p.id && editCell?.k === m.k;
                        const ajustado = !!p && ovr[m.k]?.[p.id] != null;
                        const v = m.receita || 0; // total previsto (orçamento + itens) = o que o Saldo usa; o duplo clique ajusta o orçamento
                        return (
                          <td key={m.k} onClick={() => { if (!editando) editarReceitaCelula(m.k); }}
                            title="clique/toque para ajustar a receita prevista só deste mês"
                            className={`num ${i === 0 ? "!text-accent" : ""} ${editando ? "" : "cursor-pointer"}`}>
                            {editando ? (
                              <input autoFocus className={`${inp} w-[58px] text-right`} value={editVal}
                                onChange={(e) => setEditVal(e.target.value)}
                                onBlur={() => { if (p) salvarOverride(p, m.k); }}
                                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); else if (e.key === "Escape") setEditCell(null); }} />
                            ) : v ? (
                              <span className={`${editavel} ${ajustado ? "border-accent text-accent font-medium underline decoration-dotted underline-offset-2" : "border-line hover:border-green"}`}
                                title={ajustado ? "ajustado manualmente" : "clique/toque para ajustar a receita prevista só deste mês"}>
                                {fmtCell(v)}
                              </span>
                            ) : (
                              <span className="text-line">·</span>
                            )}
                          </td>
                        );
                      })}
                      <td></td>
                    </tr>
                    {/* Saldo do mês = receita − gerais */}
                    <tr className="font-bold">
                      <td className="border-t-2 !border-t-line sticky left-0 z-10 bg-card">Saldo do mês</td>
                      {proj.map((m) => <td key={m.k} className={`num border-t-2 !border-t-line ${m.saldo < 0 ? "text-red" : "text-green"}`}>{fmtCell(m.saldo)}</td>)}
                      <td className="border-t-2 !border-t-line"></td>
                    </tr>
                    {/* 💰 Receitas previstas (itens do plano) — abaixo do saldo, como na visão Mês */}
                    {(() => {
                      const receitas = planos.filter((p) => ehReceitaTipo(p.tipo));
                      if (!receitas.length) return null;
                      const total = (i: number) => receitas.reduce((s, p) => s + (p.ativo ? valProj(p, meses[i].k) : 0), 0);
                      return (
                        <>
                          <GrupoProj gkey="proj-receita" titulo="💰 Receitas previstas" sub="plano" valor={total} count={receitas.length} colorCls="text-green" />
                          {!colapsado["proj-receita"] && receitas.map(LinhaProj)}
                        </>
                      );
                    })()}
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </>
      )}

      {/* ---------- formulário de adicionar / editar (compartilhado) ---------- */}
      <Panel title={editId ? "Editar item" : "Adicionar item"} className="mt-[18px]">
        <div className="flex flex-wrap gap-3 items-end">
          <Field label="Tipo">
            <Select value={form.tipo} onChange={(v) => setForm((f) => ({ ...f, tipo: v as TipoPlano }))} className="w-full sm:w-[180px]">
              {TIPOS.map((t) => <option key={t.v} value={t.v}>{t.icon} {t.label.replace(/s$/, "")}</option>)}
            </Select>
          </Field>
          <Field label="Nome">
            <input className={`${inp} w-full sm:w-[190px]`} placeholder={NOME_PH[form.tipo]} value={form.nome} onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))} />
          </Field>
          {podeCategoria && (
            <Field label="Categoria">
              <select className={`select-chev ${inp} cursor-pointer w-full sm:w-[150px]`} value={form.categoria} onChange={(e) => setForm((f) => ({ ...f, categoria: e.target.value }))}>
                {catOpcoes.map((c) => <option key={c} value={c}>{c || "—"}</option>)}
              </select>
            </Field>
          )}
          <Field label={VALOR_LABEL[form.tipo]}>
            <input className={`${inp} w-full sm:w-[120px] text-right`} placeholder="0,00" value={form.valor} onChange={(e) => setForm((f) => ({ ...f, valor: e.target.value }))} />
          </Field>
          {form.tipo === "parcelamento" && (
            <Field label="Parcelas">
              <input className={`${inp} w-full sm:w-[70px] text-right`} value={form.parcelas} onChange={(e) => setForm((f) => ({ ...f, parcelas: e.target.value }))} />
            </Field>
          )}
          <Field label={ehMesUnico ? "Mês" : "Mês início"}>
            <Select value={form.mes_inicio} onChange={(v) => setForm((f) => ({ ...f, mes_inicio: v }))} className="w-full sm:w-[120px]">
              {MES_OPCOES.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
            </Select>
          </Field>
          {temFim && (
            <Field label="Até (opcional)">
              <Select value={form.mes_fim} onChange={(v) => setForm((f) => ({ ...f, mes_fim: v }))} className="w-full sm:w-[130px]">
                <option value="">sem fim</option>
                {MES_OPCOES.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
              </Select>
            </Field>
          )}
          {ehMeta && (
            <Field label="Mês-alvo">
              <Select value={form.mes_fim} onChange={(v) => setForm((f) => ({ ...f, mes_fim: v }))} className="w-full sm:w-[120px]">
                <option value="">—</option>
                {MES_OPCOES.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
              </Select>
            </Field>
          )}
          {podeCategoria && temCartaoCol && (
            <Field label="No cartão?">
              <button type="button" onClick={() => setForm((f) => ({ ...f, no_cartao: !f.no_cartao }))}
                title="marque se este gasto cai no cartão de crédito"
                className={`btn rounded-[8px] px-3 py-[7px] text-[13px] border transition-colors cursor-pointer ${form.no_cartao ? "bg-violet/15 border-violet text-violet" : "bg-card border-line text-muted hover:border-violet"}`}>
                💳 {form.no_cartao ? "Sim" : "Não"}
              </button>
            </Field>
          )}
          <button onClick={salvar} className="btn bg-accent hover:bg-accent2 text-onaccent rounded-[8px] px-4 py-[8px] text-[13px] border-0">{editId ? "Salvar" : "Adicionar"}</button>
          {editId && <button onClick={resetForm} className="bg-transparent border-0 p-0 cursor-pointer text-muted text-[12px]">cancelar</button>}
        </div>
        <div className="text-muted text-[12px] mt-3 leading-relaxed">
          {form.tipo === "meta"
            ? <><b>Meta / caixinha:</b> o valor total é dividido igualmente pelos meses entre o início e o mês-alvo — ideal para juntar aos poucos para uma viagem.</>
            : form.tipo === "parcelamento"
            ? <><b>Parcelamento:</b> informe o valor da parcela e quantas vezes — a projeção espalha pelos meses e mostra quando termina.</>
            : form.tipo === "fixo"
            ? <><b>Gasto fixo:</b> repete todo mês a partir do início (deixe "até" em branco para recorrente sem fim).</>
            : form.tipo === "receita"
            ? <><b>Receita prevista:</b> entra todo mês e alimenta o saldo previsto de cada mês.</>
            : <><b>Pagamento futuro:</b> lança o valor uma única vez no mês escolhido.</>}
        </div>
      </Panel>

      {/* legenda explicativa — por último, abaixo do formulário */}
      {view === "mes" ? (
        <div className="text-muted text-[12px] mt-2 leading-relaxed">
          <b>Previsto</b> vem da regra de cada item; <b>Real</b> você preenche (ou puxa do <b>lançado</b> via <b>vincular</b>). Marque um gasto com <b className="text-violet">💳</b> se ele cai no cartão. No rodapé: <b>🏦 conta</b> soma os gastos fora do cartão, <b className="text-violet">💳 cartão</b> é o total (Previsto = orçamento que você digita; <b>Real = o que realmente caiu no cartão, dos seus lançamentos importados</b> — pode sobrescrever digitando) e <b>Σ gerais</b> é tudo junto. Na linha <b className="text-green">💰 Receitas</b>, <b>Hist.</b> e <b>Real</b> são o que de fato entrou (seus lançamentos) e o <b>Previsto</b> é a receita que você planeja: clique para definir o valor-base por mês (ou <b className="text-green">↑ prever</b>, que sugere a média do que entrou). É a mesma <b>Receita prevista</b> da aba <b>Projeção</b> — editar num lado muda no outro; para mexer só num mês, ajuste lá na Projeção (um clique/toque). O <b>Saldo do mês</b> usa a receita <b>real</b> (coluna Real) e a <b>prevista</b> (coluna Previsto). Os itens 💳 já estão dentro do cartão, não somam de novo. Enquanto o mês <b>não fecha</b>, o cartão aparece como <b>· parcial</b> (gasto importado até agora) e só vira valor real quando o mês termina — ou se você digitar a fatura fechada. Na coluna <b>Previsto</b> das linhas 🏦, 💳 e 💰, <b>clique</b> para digitar o valor (não sobrescreve o que já está lá) e <b>passe o mouse</b> em cima para abrir um pop-up com a <b>média móvel dos meses fechados</b> — clique em <b>Usar</b> ali para aplicá-la. Clique no nome de um grupo (<b>🔁 Gastos recorrentes</b>, <b>📦 Outros gastos</b>) para <b>minimizar</b> — os itens somem e fica só o total na linha-cabeçalho. Arraste a alça <b>⠿</b> no início de cada item (ou use as setas ▲▼ no celular) para <b>reordenar</b> as linhas dentro do grupo. O <b>Σ Gastos gerais</b> é a soma das quatro linhas acima: <b>🔁 recorrentes + 📦 outros + 🏦 conta (gerais) + 💳 cartão</b>.
          {!temOrcCartao && <> <span className="text-amber">{MSG_MIGRACAO_CARTAO}</span></>}
          {!temOrcConta && <> <span className="text-amber">{MSG_MIGRACAO_CONTA}</span></>}
          {!temOrcReceita && <> <span className="text-amber">{MSG_MIGRACAO_RECEITA}</span></>}
        </div>
      ) : (
        <div className="text-muted text-[12px] mt-2 leading-relaxed">
          Valores em reais (sem centavos); a primeira coluna é o mês atual. Toque ou <b>clique</b> em qualquer valor para ajustar só aquele mês (fica <span className="text-accent">destacado</span>; apague ou iguale à regra para voltar ao previsto). <b>Mesma estrutura da visão Mês</b>: <b>🔁 Gastos recorrentes</b> e <b>📦 Outros gastos</b> trazem o total no próprio cabeçalho — clique no nome para <b>minimizar</b> e esconder os itens (arraste a alça <b>⠿</b> de cada item, ou use as setas ▲▼ no celular, para <b>reordenar</b>); depois vêm <b>🏦 conta</b> e <b className="text-violet">💳 cartão</b> fora os recorrentes, <b>Σ gerais</b> (a soma dos quatro, sem contar em dobro), a <b className="text-green">💰 Receita prevista</b> e o <b>Saldo do mês</b>. A <b className="text-green">💰 Receita prevista</b> é editável: <b>um clique/toque</b> numa célula ajusta só aquele mês; o valor-base (que se repete) você define na visão <b>Mês</b> (linha 💰, <b className="text-green">↑ prever</b>). Defina o orçamento do cartão na visão <b>Mês</b> (linha 💳) — sem orçamento, o cartão mostra a soma dos itens marcados.
          {!temOrcCartao && <> <span className="text-amber">{MSG_MIGRACAO_CARTAO}</span></>}
          {!temOrcReceita && <> <span className="text-amber">{MSG_MIGRACAO_RECEITA}</span></>}
        </div>
      )}
    </div>
  );
}
