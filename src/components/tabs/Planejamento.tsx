import { useState, useEffect, useMemo, useCallback, Fragment, type ReactNode } from "react";
import { Kpi, Select, Seg, Toolbar, Panel } from "../ui";
import { sb } from "../../lib/supabase";
import type { Lancamento } from "../../types";
import { BRL, CATEGORIAS, dvAddMes, dvLabel, ehGasto } from "../../lib/finance";
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
  const n = parseFloat(s.replace(/\./g, "").replace(",", "."));
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

export function Planejamento({ allDados }: { allDados: Lancamento[] }) {
  const [planos, setPlanos] = useState<Plano[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");
  const [semTabela, setSemTabela] = useState(false);
  const [temCartaoCol, setTemCartaoCol] = useState(true); // coluna no_cartao existe?
  const [temOrcCartao, setTemOrcCartao] = useState(true); // coluna eh_cartao_total existe?
  const [cartaoPlano, setCartaoPlano] = useState<Plano | null>(null); // linha especial do TOTAL do cartão
  const [cartaoOrc, setCartaoOrc] = useState(""); // orçamento mensal do cartão (texto do input)
  const [cartaoReal, setCartaoReal] = useState(""); // total real do cartão no mês selecionado (texto)
  const [copiado, setCopiado] = useState(false);
  const [view, setView] = useState<"mes" | "proj">("mes");

  // projeção
  const [n, setN] = useState(12);
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
    // separa a linha especial do TOTAL do cartão dos itens comuns
    const card = todos.find((p) => (p as any).eh_cartao_total) || null;
    setCartaoPlano(card);
    setPlanos(card ? todos.filter((p) => p.id !== card.id) : todos);
    // detecta se as colunas do cartão já existem (migração rodada)
    if (todos.length) {
      setTemCartaoCol("no_cartao" in (todos[0] as object));
      setTemOrcCartao("eh_cartao_total" in (todos[0] as object));
    } else {
      const p1 = await sb.from("planos").select("no_cartao").limit(1);
      const p2 = await sb.from("planos").select("eh_cartao_total").limit(1);
      setTemCartaoCol(!p1.error); setTemOrcCartao(!p2.error);
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
    Object.entries(byComp[atual] || {}).forEach(([id, m]) => { if (m.valor_real != null) r[+id] = String(m.valor_real); });
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
    if (!ehGasto(d.classe)) return false;
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
        allDados.forEach((d) => { if (String(d.competencia).slice(0, 7) === c && matchLink(d, p)) { sum += Math.abs(d.valor); cnt++; } });
        out[p.id][c] = cnt > 0 ? Math.round(sum * 100) / 100 : null;
      });
    });
    return out;
  }, [planos, allDados, comp, histMeses]);

  // previsto/realizado efetivo de um item num mês
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
  async function usarLancado(p: Plano, v: number) { await upsert(p.id, comp, v, true); setReais((r) => ({ ...r, [p.id]: String(v) })); }
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
    if (!confirm(`Remover "${p.nome}"?`)) return;
    const { error } = await sb.from("planos").delete().eq("id", p.id);
    if (!error) { if (editId === p.id) resetForm(); carregar(); }
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
  async function salvarOrcamentoCartao(valorStr: string) {
    const v = parseValor(valorStr);
    if (!v && !cartaoPlano) return; // nada digitado e nada salvo: não cria à toa
    const p = await garantirCartaoPlano(); if (!p) return;
    const { error } = await sb.from("planos").update({ valor: v }).eq("id", p.id);
    if (!error) setCartaoPlano({ ...p, valor: v });
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

  function abrirLink(p: Plano) { setLinkEdit(linkEdit === p.id ? null : p.id); setLinkForm({ categoria: p.link_categoria || "", texto: p.link_texto || "" }); }
  async function salvarLink(p: Plano) {
    const { error } = await sb.from("planos").update({ link_categoria: linkForm.categoria || null, link_texto: linkForm.texto.trim() || null }).eq("id", p.id);
    if (!error) { setLinkEdit(null); carregar(); }
  }

  // ---------- projeção ----------
  const meses = useMemo(() => horizonte(n), [n]);
  const proj = useMemo(() => projetar(planos, meses, cartaoPlano), [planos, meses, cartaoPlano]);
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

  // ---------- consolidação: conta + cartão = gerais (sem contar em dobro) ----------
  const gastosCartaoFlag = gastosMes.filter((p) => p.no_cartao); // itens marcados (detalhe do cartão)
  const gastosConta = gastosMes.filter((p) => !p.no_cartao);     // gastos fora do cartão
  const orcCartao = (c: string) => (cartaoPlano && cartaoPlano.ativo ? contribNoMes(cartaoPlano, c) : 0);
  const realCartao = (c: string) => (cartaoPlano ? (mensal[c]?.[cartaoPlano.id]?.valor_real ?? null) : null);
  // total do cartão no mês:
  //  Previsto = orçamento digitado; sem orçamento, soma dos itens marcados.
  //  Real     = total digitado da fatura; sem isso, soma realizada dos itens marcados
  //             (não assume o orçamento como gasto, e mantém o histórico igual ao de antes).
  const cartaoPrev = (c: string) => { const o = orcCartao(c); return o > 0 ? o : somaPrev(gastosCartaoFlag, c); };
  const cartaoEfet = (c: string) => { const r = realCartao(c); return r != null ? r : somaEfet(gastosCartaoFlag, c); };
  const contaPrev = (c: string) => somaPrev(gastosConta, c);
  const contaEfet = (c: string) => somaEfet(gastosConta, c);
  const geraisPrev = (c: string) => contaPrev(c) + cartaoPrev(c);
  const geraisEfet = (c: string) => contaEfet(c) + cartaoEfet(c);
  const pagoCartao = cartaoPlano ? (mensal[comp]?.[cartaoPlano.id]?.pago ?? false) : false;

  const prevRec = somaPrev(receitasMes, comp), efetRec = somaEfet(receitasMes, comp);
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
            <Kpi title={`Gastos previstos · ${dvLabel(comp)}`} value={BRL(prevGer)} sub="conta + cartão" />
            <Kpi title="Gastos realizados" value={BRL(efetGer)} sub={`${preenchidos} preenchidos`} color="text-amber" />
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
                  {!!gastosMes.length && <tr className="bg-card2"><td colSpan={9} className="!py-[6px] text-[11px] uppercase tracking-wide text-muted font-semibold">Gastos</td></tr>}
                  {gastosMes.map(LinhaMes)}
                  {!!receitasMes.length && <tr className="bg-card2"><td colSpan={9} className="!py-[6px] text-[11px] uppercase tracking-wide text-muted font-semibold">Receitas</td></tr>}
                  {receitasMes.map(LinhaMes)}
                  {!loading && !itensMes.length && <tr><td colSpan={9} className="!p-4 text-muted">Nenhum item ativo neste mês. Adicione abaixo.</td></tr>}
                  {loading && <tr><td colSpan={9} className="!p-4 text-muted">Carregando…</td></tr>}
                </tbody>
                <tfoot>
                  {/* 🏦 gastos fora do cartão */}
                  <tr className="text-[12.5px]">
                    <td className="border-t-2 !border-t-line" colSpan={2}>🏦 Gastos na conta</td>
                    {histMeses.map((c) => <td key={c} className="num border-t-2 !border-t-line text-muted">{fmtCell(contaEfet(c))}</td>)}
                    <td className="num border-t-2 !border-t-line text-muted">{fmtCell(contaPrev(comp))}</td>
                    <td className="num border-t-2 !border-t-line">{fmtCell(contaEfet(comp))}</td>
                    <td className="border-t-2 !border-t-line" colSpan={2}></td>
                  </tr>
                  {/* 💳 total no cartão — você digita o orçamento (Previsto) e o real do mês */}
                  <tr className="text-violet text-[12.5px]" title="total do cartão — os itens marcados 💳 já estão aqui dentro, não somam de novo">
                    <td colSpan={2}>
                      💳 Cartão de crédito
                      {!!gastosCartaoFlag.length && <span className="text-muted font-normal ml-1">· {gastosCartaoFlag.length} marcado(s): {fmtCell(somaPrev(gastosCartaoFlag, comp))}</span>}
                    </td>
                    {histMeses.map((c) => <td key={c} className="num">{fmtCell(cartaoEfet(c))}</td>)}
                    <td className="num">
                      {temOrcCartao
                        ? <input className={`${inp} w-[90px] text-right text-violet`} value={cartaoOrc} placeholder="orçar"
                            title="orçamento do cartão — vale todo mês" onChange={(e) => setCartaoOrc(e.target.value)} onBlur={(e) => salvarOrcamentoCartao(e.target.value)} />
                        : fmtCell(cartaoPrev(comp))}
                    </td>
                    <td className="num">
                      {temOrcCartao
                        ? <input className={`${inp} w-[90px] text-right text-violet`} value={cartaoReal} placeholder={fmt(cartaoPrev(comp))}
                            title="total que veio no cartão neste mês" onChange={(e) => setCartaoReal(e.target.value)} onBlur={(e) => salvarRealCartao(e.target.value)} />
                        : fmtCell(cartaoEfet(comp))}
                    </td>
                    <td className="!text-center">
                      {temOrcCartao && (
                        <button onClick={togglePagoCartao} title={pagoCartao ? "Pago" : "Marcar pago"}
                          className={`w-7 h-7 rounded-[8px] border-2 flex items-center justify-center mx-auto text-[15px] font-bold cursor-pointer transition-colors ${pagoCartao ? "bg-green border-green text-white" : "bg-transparent border-line text-transparent hover:border-green"}`}>✓</button>
                      )}
                    </td>
                    <td></td>
                  </tr>
                  {/* Σ total geral consolidado (conta + cartão) */}
                  <tr className="font-bold">
                    <td colSpan={2}>Σ Gastos gerais</td>
                    {histMeses.map((c) => <td key={c} className="num">{fmtCell(geraisEfet(c))}</td>)}
                    <td className="num">{fmtCell(geraisPrev(comp))}</td>
                    <td className="num">{fmtCell(geraisEfet(comp))}</td>
                    <td colSpan={2}></td>
                  </tr>
                  {/* saldo do mês = receita − gerais */}
                  <tr className="font-semibold">
                    <td colSpan={2}>Saldo do mês</td>
                    {histMeses.map((c) => { const s = somaEfet(receitasMes, c) - geraisEfet(c); return <td key={c} className={`num ${s < 0 ? "text-red" : "text-green"}`}>{fmtCell(s)}</td>; })}
                    <td className={`num ${prevRec - prevGer < 0 ? "text-red" : "text-green"}`}>{fmtCell(prevRec - prevGer)}</td>
                    <td className={`num ${efetRec - efetGer < 0 ? "text-red" : "text-green"}`}>{fmtCell(efetRec - efetGer)}</td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
          <div className="text-muted text-[12px] mt-2 leading-relaxed">
            <b>Previsto</b> vem da regra de cada item; <b>Real</b> você preenche (ou puxa do <b>lançado</b> via <b>vincular</b>). Marque um gasto com <b className="text-violet">💳</b> se ele cai no cartão. No rodapé: <b>🏦 conta</b> soma os gastos fora do cartão, <b className="text-violet">💳 cartão</b> é o total que você digita (Previsto = orçamento, Real = a fatura — os itens 💳 já estão dentro dele, não somam de novo) e <b>Σ gerais</b> é tudo junto.
            {!temOrcCartao && <> <span className="text-amber">{MSG_MIGRACAO_CARTAO}</span></>}
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
                            {meses.map((m) => { const v = p.ativo ? contribNoMes(p, m.k) : 0; return <td key={m.k} className={`num ${ehReceitaTipo(p.tipo) ? "text-green" : ""}`}>{v ? fmtCell(v) : <span className="text-line">·</span>}</td>; })}
                            <td className="whitespace-nowrap text-[12px] text-right">
                              <button onClick={() => editar(p)} className="bg-transparent border-0 p-0 cursor-pointer text-muted hover:text-accent transition-colors">editar</button>
                              <span className="text-line mx-1">·</span>
                              <button onClick={() => remover(p)} className="bg-transparent border-0 p-0 cursor-pointer text-muted hover:text-red transition-colors">remover</button>
                            </td>
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                  {!loading && !planos.length && <tr><td colSpan={colCount} className="!p-4 text-muted">Nenhum item ainda. Adicione abaixo.</td></tr>}
                  {loading && <tr><td colSpan={colCount} className="!p-4 text-muted">Carregando…</td></tr>}
                </tbody>
                {(!!planos.length || cartaoPlano) && (
                  <tfoot>
                    {/* 🏦 gastos fora do cartão */}
                    <tr className="text-[12.5px]">
                      <td className="border-t-2 !border-t-line">🏦 Gastos na conta</td>
                      {proj.map((m, i) => <td key={m.k} className={`num border-t-2 !border-t-line text-muted ${i === 0 ? "!text-accent" : ""}`}>{m.conta ? fmtCell(m.conta) : <span className="text-line">·</span>}</td>)}
                      <td className="border-t-2 !border-t-line"></td>
                    </tr>
                    {/* 💳 total no cartão (orçamento, senão soma dos itens marcados) */}
                    <tr className="text-violet text-[12.5px]" title="total do cartão: orçamento definido, senão soma dos itens marcados 💳">
                      <td>💳 Cartão de crédito</td>
                      {proj.map((m) => <td key={m.k} className="num">{m.cartao ? fmtCell(m.cartao) : <span className="text-line">·</span>}</td>)}
                      <td></td>
                    </tr>
                    {/* Σ total geral consolidado */}
                    <tr className="font-bold">
                      <td>Σ Gastos gerais</td>
                      {proj.map((m, i) => <td key={m.k} className={`num ${i === 0 ? "text-accent" : ""}`}>{fmtCell(m.gerais)}</td>)}
                      <td></td>
                    </tr>
                    <tr className="text-green"><td>Receita prevista</td>{proj.map((m) => <td key={m.k} className="num">{m.receita ? fmtCell(m.receita) : <span className="text-line">·</span>}</td>)}<td></td></tr>
                    <tr className="font-bold"><td>Saldo previsto</td>{proj.map((m) => <td key={m.k} className={`num ${m.saldo < 0 ? "text-red" : "text-green"}`}>{fmtCell(m.saldo)}</td>)}<td></td></tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
          <div className="text-muted text-[12px] mt-2 leading-relaxed">
            Valores em reais (sem centavos); a primeira coluna é o mês atual. O rodapé separa <b>🏦 conta</b>, <b className="text-violet">💳 cartão</b> e <b>Σ gerais</b>. Defina o orçamento do cartão na visão <b>Mês</b> (linha 💳) — sem orçamento, o cartão mostra a soma dos itens marcados.
            {!temOrcCartao && <> <span className="text-amber">{MSG_MIGRACAO_CARTAO}</span></>}
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
