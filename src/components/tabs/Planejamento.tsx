import { useState, useEffect, useMemo, useCallback, Fragment, type ReactNode } from "react";
import { Kpi, Select, Seg, Toolbar, Panel } from "../ui";
import { useConfirm } from "../Confirm";
import { useToast } from "../Toast";
import { sb } from "../../lib/supabase";
import type { Lancamento } from "../../types";
import { BRL, CATEGORIAS, dvAddMes, dvLabel, mesComp, valorGasto, valorReceita } from "../../lib/finance";
import {
  type Plano, type TipoPlano, TIPOS, mesAtual, horizonte, projetar,
  contribNoMes, fimEfetivo, ehReceitaTipo, mesesEntre,
} from "../../lib/projecao";

const inp = "bg-card text-txt border border-line rounded-[8px] px-2 py-[6px] text-[13px] outline-none focus:border-muted transition-colors placeholder:text-muted/70";

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
const fmt = (v: number | null | undefined) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 }));

function resumoItem(p: Plano): string {
  const fim = fimEfetivo(p);
  const L = (k: string | null) => (k ? dvLabel(k) : "");
  switch (p.tipo) {
    case "fixo":
    case "receita":
      return `${BRL(p.valor)}/mês` + (p.mes_fim ? ` · até ${L(p.mes_fim)}` : " · sem fim");
    case "pagamento":
      return `pagamento único · ${L(p.mes_inicio)}`;
    case "parcelamento":
      return `${p.parcelas || 1}× de ${BRL(p.valor)} · termina ${L(fim)}`;
    case "meta": {
      const n = mesesEntre(p.mes_inicio, fim || p.mes_inicio) + 1;
      return `${BRL(p.valor)} até ${L(fim)} · ${BRL(p.valor / Math.max(1, n))}/mês`;
    }
  }
  return "";
}

const VAZIO = { tipo: "fixo" as TipoPlano, nome: "", categoria: "", valor: "", mes_inicio: mesAtual(), mes_fim: "", parcelas: "12", no_cartao: false };

// erro de coluna ainda não criada (migração do cartão não rodada)
const faltaColunaCartao = (msg?: string) => /no_cartao|could not find|schema cache/i.test(msg || "");
const MSG_MIGRACAO_CARTAO = 'Para usar o cartão de crédito, rode em Supabase → SQL Editor a migração db/migrations/2026-06-16-cartao-credito.sql (uma vez só).';
const faltaColunaConta = (msg?: string) => /eh_conta_total|could not find|schema cache/i.test(msg || "");
const MSG_MIGRACAO_CONTA = 'Para orçar a conta variável, rode em Supabase → SQL Editor a migração db/migrations/2026-06-18-orcamento-conta.sql (uma vez só).';
const faltaColunaReceita = (msg?: string) => /eh_receita_total|could not find|schema cache/i.test(msg || "");
const MSG_MIGRACAO_RECEITA = 'Para planejar a receita prevista, rode em Supabase → SQL Editor a migração db/migrations/2026-06-20-receita-prevista.sql (uma vez só).';

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
    <label className="flex flex-col gap-1 text-[11.5px] text-muted">
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
  const [cartaoOrc, setCartaoOrc] = useState(""); // orçamento mensal do cartão (texto do input)
  const [cartaoReal, setCartaoReal] = useState(""); // total real do cartão no mês selecionado (texto)
  const [copiado, setCopiado] = useState(false);
  const [view, setView] = useState<"mes" | "proj">("mes");

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
    const { data, error } = await sb.from("planos").select("*").order("tipo").order("ordem").order("id");
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

  // ---------- "subir" o realizado para o orçamento previsto ----------
  // sugestão = média dos meses já fechados que aparecem no histórico (ignora meses sem dado)
  const mediaFechados = (fn: (c: string) => number | null) => {
    const vs = histMeses.map(fn).filter((v): v is number => v != null);
    return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : 0;
  };
  function iniciarOrc(tipo: "conta" | "cartao" | "receita") {
    const sug = tipo === "conta" ? mediaFechados(contaGeralEfet)
      : tipo === "cartao" ? mediaFechados((c) => cartaoVarEfet(c))
      : mediaFechados((c) => autosReceita[c]); // receita: média do que entrou de fato (lançado)
    setOrcVal(sug ? String(Math.round(sug)).replace(".", ",") : "");
    setOrcEdit(tipo);
  }
  async function salvarOrcConta() { setOrcEdit(null); await salvarOrcamentoConta(orcVal); }
  async function salvarOrcReceita() { setOrcEdit(null); await salvarOrcamentoReceita(orcVal); }
  async function salvarOrcCartaoVar() {
    setOrcEdit(null);
    // o digitado é o previsto VARIÁVEL; o orçamento TOTAL do cartão = variável + recorrentes já no cartão
    const total = parseValor(orcVal) + somaPrev(recorrNoCartao, comp);
    await salvarOrcamentoCartao(total);
  }

  // total geral consolidado (recorrentes + variável conta + variável cartão)
  const geraisPrev = (c: string) => recorrPrev(c) + (contaVarPrev(c) ?? 0) + (cartaoVarPrev(c) ?? 0);
  const geraisEfet = (c: string) => recorrEfet(c) + (contaVarEfet(c) ?? 0) + cartaoVarEfet(c);

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
          <code className="text-[12px] bg-fill px-1 py-[1px] rounded">db/migrations/2026-06-15-unificar-planejamento.sql</code>{" "}
          (traz seus dados de Orçamento). Em uma base nova, basta o SQL abaixo:
        </p>
        <div className="relative">
          <pre className="bg-fill border border-line rounded-[10px] p-3 text-[11.5px] overflow-x-auto scroll-thin leading-snug">{SQL_HINT}</pre>
          <button
            onClick={() => { navigator.clipboard?.writeText(SQL_HINT); setCopiado(true); setTimeout(() => setCopiado(false), 1500); }}
            className="absolute top-2 right-2 btn bg-accent hover:bg-accent2 text-white rounded-[8px] px-3 py-[5px] text-[12px] border-0"
          >{copiado ? "copiado!" : "copiar"}</button>
        </div>
        <button onClick={carregar} className="mt-4 btn bg-accent hover:bg-accent2 text-white rounded-[8px] px-4 py-[8px] text-[13px] border-0">Já rodei — verificar</button>
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
        <tr>
          <td className="font-medium">
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={p.ativo} onChange={() => toggleAtivo(p)} title="ativo" className="cursor-pointer" />
              <div className="min-w-0">
                <div className="truncate">{p.nome}{(p.link_categoria || p.link_texto) && <span title="vínculo a lançamentos" className="ml-1 text-accent text-[11px]">🔗</span>}</div>
                <div className="text-muted text-[11px] font-normal">{resumoItem(p)}</div>
              </div>
              <CartaoToggle p={p} />
            </div>
          </td>
          <td className="text-muted">{p.categoria || "—"}</td>
          {histMeses.map((c) => <td key={c} className="num text-muted">{fmt(dados(p, c).efetivo)}</td>)}
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
              className={`w-7 h-7 rounded-[8px] border-2 flex items-center justify-center mx-auto text-[15px] font-bold cursor-pointer transition-colors ${d.pago ? "bg-green border-green text-white" : "bg-transparent border-line text-transparent hover:border-green"}`}>✓</button>
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
                  {CATEGORIAS.map((c) => <option key={c} value={c}>{c || "(qualquer)"}</option>)}
                </select>
                <span>e/ou descrição contém</span>
                <input className={`${inp} w-[200px]`} placeholder="ex.: adas imove" value={linkForm.texto} onChange={(e) => setLinkForm((f) => ({ ...f, texto: e.target.value }))} />
                <button onClick={() => salvarLink(p)} className="btn bg-accent hover:bg-accent2 text-white rounded-[8px] px-3 py-[6px] text-[12px] border-0">Salvar vínculo</button>
                <button onClick={() => setLinkEdit(null)} className="bg-transparent border-0 p-0 cursor-pointer text-muted text-[12px]">cancelar</button>
              </div>
            </td>
          </tr>
        )}
      </Fragment>
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
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-[14px] mb-[18px]">
            <Kpi title={`Gastos previstos · ${dvLabel(comp)}`} value={BRL(prevGer)} sub="recorrentes (plano)" />
            <Kpi title="Gastos realizados" value={BRL(efetGer)} sub={cartaoParcial(comp) ? "cartão ainda parcial · mês em aberto" : "recorrente + conta + cartão"} color="text-amber" />
            <Kpi title="Saldo previsto" value={BRL(prevRec - prevGer)} sub="receita − gastos (plano)" color={prevRec - prevGer < 0 ? "text-red" : "text-green"} />
            <Kpi title="Saldo realizado" value={BRL(efetRec - efetGer)} sub="receita − gastos (real)" color={efetRec - efetGer < 0 ? "text-red" : "text-green"} />
          </div>

          <div className="bg-card border border-line rounded-[18px] shadow-card overflow-hidden">
            <div className="overflow-x-auto scroll-thin">
              <table className="tbl min-w-[960px]">
                <thead>
                  <tr>
                    <th rowSpan={2} className="!text-left">Item</th>
                    <th rowSpan={2}>Categoria</th>
                    <th colSpan={3} className="!text-center !p-[6px] !text-[10px]">Realizado — meses anteriores</th>
                    <th colSpan={2} className="!text-center text-accent">{dvLabel(comp)}</th>
                    <th rowSpan={2} className="!text-center">Pago</th>
                    <th rowSpan={2}></th>
                  </tr>
                  <tr>
                    {histMeses.map((c) => <th key={c} className="num !font-normal">{dvLabel(c)}</th>)}
                    <th className="num">Previsto</th>
                    <th className="num">Real</th>
                  </tr>
                </thead>
                <tbody>
                  {/* GASTOS — recorrentes (fixos) listados primeiro, com o total logo abaixo */}
                  {!!gastosMes.length && <tr className="bg-card2"><td colSpan={9} className="!py-[6px] text-[11px] uppercase tracking-wide text-muted font-semibold">Gastos</td></tr>}
                  {gastosRecorrentes.map(LinhaMes)}
                  {!loading && !!gastosRecorrentes.length && (
                    <tr className="font-bold">
                      <td className="border-t-2 !border-t-line" colSpan={2}>🔁 Gastos recorrentes <span className="text-muted font-normal">· fixos mensais</span></td>
                      {histMeses.map((c) => <td key={c} className="num border-t-2 !border-t-line">{fmtCell(recorrEfet(c))}</td>)}
                      <td className="num border-t-2 !border-t-line">{fmtCell(recorrPrev(comp))}</td>
                      <td className="num border-t-2 !border-t-line">{fmtCell(recorrEfet(comp))}</td>
                      <td className="border-t-2 !border-t-line" colSpan={2}></td>
                    </tr>
                  )}
                  {/* itens não-recorrentes (parcelas, metas, pagamentos) */}
                  {gastosOutrosLista.map(LinhaMes)}

                  {!loading && (!!itensMes.length || !!receitaPlano || !!contaPlano || !!cartaoPlano) && (
                    <Fragment key="resumo-gastos">
                      {/* 🏦 conta — gerais (orçado) */}
                      <tr className="text-[12.5px]" title="gasto corriqueiro da conta (Pix/débito) que você orça; realizado = o que saiu da conta além dos recorrentes e dos itens avulsos">
                        <td colSpan={2}>🏦 Gastos na conta <span className="text-muted font-normal">· gerais (orçado)</span></td>
                        {histMeses.map((c) => { const v = contaGeralEfet(c); return <td key={c} className="num text-muted">{v == null ? "—" : fmtCell(v)}</td>; })}
                        <td className="num text-muted !py-1">
                          {orcEdit === "conta" ? (
                            <input autoFocus className={`${inp} w-[84px] text-right`} value={orcVal}
                              onChange={(e) => setOrcVal(e.target.value)} onBlur={salvarOrcConta}
                              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); else if (e.key === "Escape") setOrcEdit(null); }} />
                          ) : (
                            <button onClick={() => iniciarOrc("conta")} title="preencher o orçamento previsto com a média dos meses fechados (você ajusta antes de salvar)"
                              className="bg-transparent border-0 p-0 cursor-pointer transition-colors hover:text-accent">
                              {contaGeralPrev(comp) == null ? <span className="text-accent">↑ orçar</span> : fmtCell(contaGeralPrev(comp) as number)}
                            </button>
                          )}
                        </td>
                        <td className="num text-muted">{(() => { const v = contaGeralEfet(comp); return v == null ? "—" : fmtCell(v); })()}</td>
                        <td colSpan={2}></td>
                      </tr>
                      {/* 📦 conta — outros gastos (parcelas, metas, pagamentos) */}
                      <tr className="text-[12.5px]" title="parcelamentos, metas e pagamentos pagos pela conta (fora do cartão) — somados dos itens acima">
                        <td colSpan={2}>📦 Outros gastos <span className="text-muted font-normal">· parcelamento, meta…</span></td>
                        {histMeses.map((c) => { const v = contaOutrosEfet(c); return <td key={c} className="num text-muted">{v ? fmtCell(v) : "—"}</td>; })}
                        <td className="num text-muted">{contaOutrosPrev(comp) ? fmtCell(contaOutrosPrev(comp)) : "—"}</td>
                        <td className="num text-muted">{contaOutrosEfet(comp) ? fmtCell(contaOutrosEfet(comp)) : "—"}</td>
                        <td colSpan={2}></td>
                      </tr>
                      {/* 💳 cartão variável, fora os recorrentes marcados */}
                      <tr className="text-violet text-[12.5px]" title="o que caiu no cartão além dos recorrentes marcados — vem dos lançamentos importados (origem Cartao)">
                        <td colSpan={2}>💳 Gastos no cartão <span className="text-muted font-normal">· fora os recorrentes</span></td>
                        {histMeses.map((c) => <td key={c} className="num">{fmtCell(cartaoVarEfet(c))}</td>)}
                        <td className="num !py-1">
                          {orcEdit === "cartao" ? (
                            <input autoFocus className={`${inp} w-[84px] text-right`} value={orcVal}
                              onChange={(e) => setOrcVal(e.target.value)} onBlur={salvarOrcCartaoVar}
                              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); else if (e.key === "Escape") setOrcEdit(null); }} />
                          ) : (
                            <button onClick={() => iniciarOrc("cartao")} title="preencher o orçamento previsto com a média dos meses fechados (você ajusta antes de salvar)"
                              className="bg-transparent border-0 p-0 cursor-pointer transition-colors hover:text-violet">
                              {cartaoVarPrev(comp) == null ? <span className="text-violet">↑ orçar</span> : fmtCell(cartaoVarPrev(comp) as number)}
                            </button>
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
                        {histMeses.map((c) => <td key={c} className="num">{fmtCell(geraisEfet(c))}</td>)}
                        <td className="num">{fmtCell(geraisPrev(comp))}</td>
                        <td className="num" title={cartaoParcial(comp) ? TIP_PARCIAL : undefined}>{fmtCell(geraisEfet(comp))}{cartaoParcial(comp) && <span className="font-normal text-[10px] text-muted"> *</span>}</td>
                        <td colSpan={2}></td>
                      </tr>
                      {/* 💰 Receitas — Hist/Real = lançado (real); Previsto = receita prevista editável (mesma da Projeção, conectado) */}
                      <tr className="text-green text-[12.5px]" title="Hist. e Real = o que de fato entrou no mês (seus lançamentos). Previsto = a receita que você planeja por mês: clique para definir o valor-base; ajuste só um mês na aba Projeção (duplo clique). É a mesma receita prevista da Projeção — editar aqui muda lá e vice-versa.">
                        <td colSpan={2}>💰 Receitas <span className="text-muted font-normal">· real lançado · previsto editável</span></td>
                        {histMeses.map((c) => { const v = receitaReal(c); return <td key={c} className="num">{v ? fmtCell(v) : "—"}</td>; })}
                        <td className="num !py-1">
                          {orcEdit === "receita" ? (
                            <input autoFocus className={`${inp} w-[84px] text-right`} value={orcVal}
                              onChange={(e) => setOrcVal(e.target.value)} onBlur={salvarOrcReceita}
                              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); else if (e.key === "Escape") setOrcEdit(null); }} />
                          ) : (
                            <button onClick={() => iniciarOrc("receita")} title="definir a receita prevista por mês (preenche com a média do que entrou; você ajusta antes de salvar). Para mudar só um mês, use a aba Projeção."
                              className="bg-transparent border-0 p-0 cursor-pointer transition-colors hover:text-green">
                              {(() => {
                                const v = receitaPrevMes(comp);
                                const ajust = !!receitaPlano && (mensal[comp]?.[receitaPlano.id]?.valor_real ?? null) != null;
                                return v
                                  ? <span className={ajust ? "underline decoration-dotted underline-offset-2" : ""} title={ajust ? "ajustado neste mês na aba Projeção" : undefined}>{fmtCell(v)}</span>
                                  : <span className="text-green underline decoration-dotted">↑ prever</span>;
                              })()}
                            </button>
                          )}
                        </td>
                        <td className="num">{efetRec ? fmtCell(efetRec) : "—"}</td>
                        <td colSpan={2}></td>
                      </tr>
                      {/* Saldo do mês = receita − gerais */}
                      <tr className="font-bold">
                        <td className="border-t-2 !border-t-line" colSpan={2}>Saldo do mês</td>
                        {histMeses.map((c) => { const s = receitaReal(c) - geraisEfet(c); return <td key={c} className={`num border-t-2 !border-t-line ${s < 0 ? "text-red" : "text-green"}`}>{fmtCell(s)}</td>; })}
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
                      {histMeses.map((c) => <td key={c} className="num">{fmtCell(somaEfet(receitasMes, c))}</td>)}
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
          <div className="text-muted text-[12px] mt-2 leading-relaxed">
            <b>Previsto</b> vem da regra de cada item; <b>Real</b> você preenche (ou puxa do <b>lançado</b> via <b>vincular</b>). Marque um gasto com <b className="text-violet">💳</b> se ele cai no cartão. No rodapé: <b>🏦 conta</b> soma os gastos fora do cartão, <b className="text-violet">💳 cartão</b> é o total (Previsto = orçamento que você digita; <b>Real = o que realmente caiu no cartão, dos seus lançamentos importados</b> — pode sobrescrever digitando) e <b>Σ gerais</b> é tudo junto. Na linha <b className="text-green">💰 Receitas</b>, <b>Hist.</b> e <b>Real</b> são o que de fato entrou (seus lançamentos) e o <b>Previsto</b> é a receita que você planeja: clique para definir o valor-base por mês (ou <b className="text-green">↑ prever</b>, que sugere a média do que entrou). É a mesma <b>Receita prevista</b> da aba <b>Projeção</b> — editar num lado muda no outro; para mexer só num mês, ajuste lá na Projeção (duplo clique). O <b>Saldo do mês</b> usa a receita <b>real</b> (coluna Real) e a <b>prevista</b> (coluna Previsto). Os itens 💳 já estão dentro do cartão, não somam de novo. Enquanto o mês <b>não fecha</b>, o cartão aparece como <b>· parcial</b> (gasto importado até agora) e só vira valor real quando o mês termina — ou se você digitar a fatura fechada. Na coluna <b>Previsto</b> das linhas 🏦 e 💳, clique em <b className="text-accent">↑ orçar</b> para preencher o orçamento com a <b>média dos meses fechados</b> (você ajusta antes de salvar).
            {!temOrcCartao && <> <span className="text-amber">{MSG_MIGRACAO_CARTAO}</span></>}
            {!temOrcConta && <> <span className="text-amber">{MSG_MIGRACAO_CONTA}</span></>}
            {!temOrcReceita && <> <span className="text-amber">{MSG_MIGRACAO_RECEITA}</span></>}
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-[14px] mb-[18px]">
            <Kpi title="Gasto médio / mês" value={BRL(gastoMedio)} sub={`projeção de ${n} meses`} />
            <Kpi title="Maior mês" value={BRL(maior.gerais)} sub={maior.label} color="text-amber" />
            <Kpi title="Em parcelas (período)" value={BRL(comprometidoParc)} sub="parcelamentos no horizonte" color="text-violet" />
            <Kpi title="Saldo médio / mês" value={BRL(saldoMedio)} sub={saldoMedio < 0 ? "no vermelho" : "sobra prevista"} color={saldoMedio < 0 ? "text-red" : "text-green"} />
          </div>

          <div className="bg-card border border-line rounded-[18px] shadow-card overflow-hidden">
            <div className="overflow-x-auto scroll-thin">
              <table className="tbl" style={{ minWidth: minW }}>
                <thead>
                  <tr>
                    <th className="!text-left">Item</th>
                    {meses.map((m, i) => <th key={m.k} className={`num ${i === 0 ? "text-accent" : ""}`}>{m.label}</th>)}
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {TIPOS.map((t) => {
                    const itens = planos.filter((p) => p.tipo === t.v);
                    if (!itens.length) return null;
                    return (
                      <Fragment key={t.v}>
                        <tr className="bg-card2"><td colSpan={colCount} className="!py-[6px] text-[11px] uppercase tracking-wide text-muted font-semibold">{t.icon} {t.label}</td></tr>
                        {itens.map((p) => (
                          <tr key={p.id} className={p.ativo ? "" : "opacity-45"}>
                            <td className="min-w-[230px]">
                              <div className="flex items-center gap-2">
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
                                <td key={m.k} onDoubleClick={() => editarCelula(p, m.k)}
                                  title={p.ativo ? "duplo clique para ajustar só este mês" : undefined}
                                  className={`num ${ehReceitaTipo(p.tipo) ? "text-green" : ""} ${p.ativo && !editando ? "cursor-pointer" : ""}`}>
                                  {editando ? (
                                    <input autoFocus className={`${inp} w-[58px] text-right`} value={editVal}
                                      onChange={(e) => setEditVal(e.target.value)}
                                      onBlur={() => salvarOverride(p, m.k)}
                                      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); else if (e.key === "Escape") setEditCell(null); }} />
                                  ) : (
                                    <span className={ajustado ? "text-accent font-medium underline decoration-dotted underline-offset-2" : ""}
                                      title={ajustado ? "ajustado manualmente" : undefined}>
                                      {v ? fmtCell(v) : <span className="text-line">·</span>}
                                    </span>
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
                        ))}
                        {/* total dos recorrentes logo abaixo da lista de fixos */}
                        {t.v === "fixo" && (
                          <tr className="font-bold">
                            <td className="border-t-2 !border-t-line">🔁 Gastos recorrentes <span className="text-muted font-normal">· fixos mensais</span></td>
                            {proj.map((m, i) => <td key={m.k} className={`num border-t-2 !border-t-line ${i === 0 ? "text-accent" : ""}`}>{m.recorr ? fmtCell(m.recorr) : <span className="text-line">·</span>}</td>)}
                            <td className="border-t-2 !border-t-line"></td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {!loading && !planos.length && <tr><td colSpan={colCount} className="!p-4 text-muted">Nenhum item ainda. Adicione abaixo.</td></tr>}
                  {loading && <tr><td colSpan={colCount} className="!p-4 text-muted">Carregando…</td></tr>}
                </tbody>
                {(!!planos.length || cartaoPlano || contaPlano || receitaPlano) && (
                  <tfoot>
                    {/* mesma estrutura da visão "Mês": baldes disjuntos → Σ gerais → saldo.
                        (o total dos recorrentes fica no tbody, logo abaixo dos fixos) */}
                    {/* 🏦 conta — gerais (orçado) */}
                    <tr className="text-[12.5px]" title="orçamento previsto da conta (definido na visão Mês via ↑ orçar) — o gasto corriqueiro de Pix/débito">
                      <td className="border-t-2 !border-t-line">🏦 Gastos na conta <span className="text-muted font-normal">· gerais (orçado)</span></td>
                      {proj.map((m, i) => <td key={m.k} className={`num text-muted border-t-2 !border-t-line ${i === 0 ? "!text-accent" : ""}`}>{m.contaOrc ? fmtCell(m.contaOrc) : <span className="text-line">·</span>}</td>)}
                      <td className="border-t-2 !border-t-line"></td>
                    </tr>
                    {/* 📦 conta — outros gastos (parcelas, metas, pagamentos) */}
                    <tr className="text-[12.5px]" title="parcelamentos, metas e pagamentos pagos pela conta (fora do cartão)">
                      <td>📦 Outros gastos <span className="text-muted font-normal">· parcelamento, meta…</span></td>
                      {proj.map((m, i) => <td key={m.k} className={`num text-muted ${i === 0 ? "!text-accent" : ""}`}>{m.contaOutros ? fmtCell(m.contaOutros) : <span className="text-line">·</span>}</td>)}
                      <td></td>
                    </tr>
                    {/* 💳 cartão variável (total do cartão fora os recorrentes marcados) */}
                    <tr className="text-violet text-[12.5px]" title="total do cartão (orçamento, senão soma dos itens marcados 💳) além dos recorrentes já marcados">
                      <td>💳 Gastos no cartão <span className="text-muted font-normal">· fora os recorrentes</span></td>
                      {proj.map((m, i) => <td key={m.k} className={`num ${i === 0 ? "!text-accent" : ""}`}>{m.cartaoVar ? fmtCell(m.cartaoVar) : <span className="text-line">·</span>}</td>)}
                      <td></td>
                    </tr>
                    {/* Σ total geral consolidado */}
                    <tr className="font-bold">
                      <td>Σ Gastos gerais</td>
                      {proj.map((m, i) => <td key={m.k} className={`num ${i === 0 ? "text-accent" : ""}`}>{fmtCell(m.gerais)}</td>)}
                      <td></td>
                    </tr>
                    {/* 💰 Receita prevista — editável por mês (duplo clique ajusta só aquele mês); valor-base vem da visão Mês (↑ prever) */}
                    <tr className="text-green">
                      <td>💰 Receita prevista <span className="text-muted font-normal">· duplo clique p/ ajustar o mês</span></td>
                      {proj.map((m, i) => {
                        const p = receitaPlano;
                        const editando = !!p && editCell?.id === p.id && editCell?.k === m.k;
                        const ajustado = !!p && ovr[m.k]?.[p.id] != null;
                        const v = m.receita || 0; // total previsto (orçamento + itens) = o que o Saldo usa; o duplo clique ajusta o orçamento
                        return (
                          <td key={m.k} onDoubleClick={() => editarReceitaCelula(m.k)}
                            title="duplo clique para ajustar a receita prevista só deste mês"
                            className={`num ${i === 0 ? "!text-accent" : ""} ${editando ? "" : "cursor-pointer"}`}>
                            {editando ? (
                              <input autoFocus className={`${inp} w-[58px] text-right`} value={editVal}
                                onChange={(e) => setEditVal(e.target.value)}
                                onBlur={() => { if (p) salvarOverride(p, m.k); }}
                                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); else if (e.key === "Escape") setEditCell(null); }} />
                            ) : (
                              <span className={ajustado ? "text-accent font-medium underline decoration-dotted underline-offset-2" : ""}
                                title={ajustado ? "ajustado manualmente" : undefined}>
                                {v ? fmtCell(v) : <span className="text-line">·</span>}
                              </span>
                            )}
                          </td>
                        );
                      })}
                      <td></td>
                    </tr>
                    {/* Saldo do mês = receita − gerais */}
                    <tr className="font-bold">
                      <td className="border-t-2 !border-t-line">Saldo do mês</td>
                      {proj.map((m) => <td key={m.k} className={`num border-t-2 !border-t-line ${m.saldo < 0 ? "text-red" : "text-green"}`}>{fmtCell(m.saldo)}</td>)}
                      <td className="border-t-2 !border-t-line"></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
          <div className="text-muted text-[12px] mt-2 leading-relaxed">
            Valores em reais (sem centavos); a primeira coluna é o mês atual. Dê <b>duplo clique</b> em qualquer valor para ajustar só aquele mês (fica <span className="text-accent">destacado</span>; apague ou iguale à regra para voltar ao previsto). O rodapé segue a mesma estrutura da visão <b>Mês</b>: <b>🔁 recorrentes</b> (fixos), <b>🏦 conta</b> e <b className="text-violet">💳 cartão</b> fora os recorrentes, <b>Σ gerais</b> (a soma dos três, sem contar em dobro), a <b className="text-green">💰 Receita prevista</b> e o <b>Saldo do mês</b>. A <b className="text-green">💰 Receita prevista</b> é editável: <b>duplo clique</b> numa célula ajusta só aquele mês; o valor-base (que se repete) você define na visão <b>Mês</b> (linha 💰, <b className="text-green">↑ prever</b>). Defina o orçamento do cartão na visão <b>Mês</b> (linha 💳) — sem orçamento, o cartão mostra a soma dos itens marcados.
            {!temOrcCartao && <> <span className="text-amber">{MSG_MIGRACAO_CARTAO}</span></>}
            {!temOrcReceita && <> <span className="text-amber">{MSG_MIGRACAO_RECEITA}</span></>}
          </div>
        </>
      )}

      {/* ---------- formulário de adicionar / editar (compartilhado) ---------- */}
      <Panel title={editId ? "Editar item" : "Adicionar item"} className="mt-[18px]">
        <div className="flex flex-wrap gap-3 items-end">
          <Field label="Tipo">
            <Select value={form.tipo} onChange={(v) => setForm((f) => ({ ...f, tipo: v as TipoPlano }))} className="w-[180px]">
              {TIPOS.map((t) => <option key={t.v} value={t.v}>{t.icon} {t.label.replace(/s$/, "")}</option>)}
            </Select>
          </Field>
          <Field label="Nome">
            <input className={`${inp} w-[190px]`} placeholder={NOME_PH[form.tipo]} value={form.nome} onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))} />
          </Field>
          {podeCategoria && (
            <Field label="Categoria">
              <select className={`select-chev ${inp} cursor-pointer w-[150px]`} value={form.categoria} onChange={(e) => setForm((f) => ({ ...f, categoria: e.target.value }))}>
                {CATEGORIAS.map((c) => <option key={c} value={c}>{c || "—"}</option>)}
              </select>
            </Field>
          )}
          <Field label={VALOR_LABEL[form.tipo]}>
            <input className={`${inp} w-[120px] text-right`} placeholder="0,00" value={form.valor} onChange={(e) => setForm((f) => ({ ...f, valor: e.target.value }))} />
          </Field>
          {form.tipo === "parcelamento" && (
            <Field label="Parcelas">
              <input className={`${inp} w-[70px] text-right`} value={form.parcelas} onChange={(e) => setForm((f) => ({ ...f, parcelas: e.target.value }))} />
            </Field>
          )}
          <Field label={ehMesUnico ? "Mês" : "Mês início"}>
            <Select value={form.mes_inicio} onChange={(v) => setForm((f) => ({ ...f, mes_inicio: v }))} className="w-[120px]">
              {MES_OPCOES.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
            </Select>
          </Field>
          {temFim && (
            <Field label="Até (opcional)">
              <Select value={form.mes_fim} onChange={(v) => setForm((f) => ({ ...f, mes_fim: v }))} className="w-[130px]">
                <option value="">sem fim</option>
                {MES_OPCOES.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
              </Select>
            </Field>
          )}
          {ehMeta && (
            <Field label="Mês-alvo">
              <Select value={form.mes_fim} onChange={(v) => setForm((f) => ({ ...f, mes_fim: v }))} className="w-[120px]">
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
          <button onClick={salvar} className="btn bg-accent hover:bg-accent2 text-white rounded-[8px] px-4 py-[8px] text-[13px] border-0">{editId ? "Salvar" : "Adicionar"}</button>
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
    </div>
  );
}
