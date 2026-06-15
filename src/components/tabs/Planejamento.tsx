import { useState, useEffect, useMemo, useCallback, Fragment, type ReactNode } from "react";
import { Kpi, Select, Seg, Toolbar, Panel } from "../ui";
import { sb } from "../../lib/supabase";
import { BRL, CATEGORIAS, dvAddMes, dvLabel } from "../../lib/finance";
import {
  type Plano, type TipoPlano, TIPOS, mesAtual, horizonte, projetar,
  contribNoMes, fimEfetivo, ehReceitaTipo, mesesEntre,
} from "../../lib/projecao";

const inp = "bg-card text-txt border border-line rounded-[8px] px-2 py-[6px] text-[13px] outline-none focus:border-muted transition-colors placeholder:text-muted/70";

// opções de mês: de 6 meses atrás até ~3 anos à frente
const MES_OPCOES = (() => {
  const start = dvAddMes(mesAtual(), -6);
  return Array.from({ length: 42 }, (_, i) => { const k = dvAddMes(start, i); return { v: k, label: dvLabel(k) }; });
})();

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
// célula compacta: reais inteiros, "·" quando vazio
const fmtCell = (v: number) => (v < 0 ? "-" : "") + Math.abs(Math.round(v)).toLocaleString("pt-BR");

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

const VAZIO = { tipo: "fixo" as TipoPlano, nome: "", categoria: "", valor: "", mes_inicio: mesAtual(), mes_fim: "", parcelas: "12" };

const SQL_PLANOS = `create table if not exists public.planos (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) default auth.uid(),
  tipo text not null check (tipo in ('fixo','parcelamento','pagamento','meta','receita')),
  nome text not null, categoria text, valor numeric not null default 0,
  mes_inicio text not null, mes_fim text, parcelas integer,
  ativo boolean not null default true, ordem integer not null default 0,
  criado_em timestamptz not null default now()
);
alter table public.planos enable row level security;
drop policy if exists "proprios dados" on public.planos;
create policy "proprios dados" on public.planos for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());`;

function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[11.5px] text-muted">
      {label}
      <div className="text-txt">{children}</div>
    </label>
  );
}

export function Planejamento() {
  const [planos, setPlanos] = useState<Plano[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");
  const [semTabela, setSemTabela] = useState(false);
  const [n, setN] = useState(12);
  const [form, setForm] = useState(VAZIO);
  const [editId, setEditId] = useState<number | null>(null);
  const [copiado, setCopiado] = useState(false);

  const carregar = useCallback(async () => {
    setLoading(true); setErro(""); setSemTabela(false);
    const { data, error } = await sb.from("planos").select("*").order("tipo").order("ordem").order("id");
    if (error) {
      if (/does not exist|schema cache|relation|could not find/i.test(error.message)) setSemTabela(true);
      else setErro(error.message);
      setLoading(false); return;
    }
    setPlanos((data || []) as Plano[]);
    setLoading(false);
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const meses = useMemo(() => horizonte(n), [n]);
  const proj = useMemo(() => projetar(planos, meses), [planos, meses]);

  const gastoMedio = proj.length ? proj.reduce((s, m) => s + m.gastos, 0) / proj.length : 0;
  const saldoMedio = proj.length ? proj.reduce((s, m) => s + m.saldo, 0) / proj.length : 0;
  const maior = proj.reduce((a, m) => (m.gastos > a.gastos ? m : a), proj[0] || { gastos: 0, label: "—" });
  const comprometidoParc = planos
    .filter((p) => p.ativo && p.tipo === "parcelamento")
    .reduce((s, p) => s + meses.reduce((ss, m) => ss + contribNoMes(p, m.k), 0), 0);

  function resetForm() { setForm(VAZIO); setEditId(null); setErro(""); }

  async function salvar() {
    const nome = form.nome.trim();
    if (!nome) { setErro("Dê um nome ao item."); return; }
    if (form.tipo === "meta" && !form.mes_fim) { setErro("Uma meta precisa de um mês-alvo."); return; }
    const payload = {
      tipo: form.tipo,
      nome,
      categoria: form.tipo === "receita" ? null : (form.categoria || null),
      valor: parseValor(form.valor),
      mes_inicio: form.mes_inicio,
      mes_fim: form.tipo === "fixo" || form.tipo === "receita" || form.tipo === "meta" ? (form.mes_fim || null) : null,
      parcelas: form.tipo === "parcelamento" ? Math.max(1, parseInt(form.parcelas) || 1) : null,
      ativo: true,
    };
    const { error } = editId
      ? await sb.from("planos").update(payload).eq("id", editId)
      : await sb.from("planos").insert(payload);
    if (error) { setErro(error.message); return; }
    resetForm(); carregar();
  }

  function editar(p: Plano) {
    setEditId(p.id);
    setForm({
      tipo: p.tipo, nome: p.nome, categoria: p.categoria || "",
      valor: p.valor ? String(p.valor).replace(".", ",") : "",
      mes_inicio: p.mes_inicio, mes_fim: p.mes_fim || "",
      parcelas: p.parcelas ? String(p.parcelas) : "12",
    });
    setErro("");
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  }
  async function remover(p: Plano) {
    if (!confirm(`Remover "${p.nome}" do planejamento?`)) return;
    const { error } = await sb.from("planos").delete().eq("id", p.id);
    if (!error) { if (editId === p.id) resetForm(); carregar(); }
  }
  async function toggleAtivo(p: Plano) {
    const { error } = await sb.from("planos").update({ ativo: !p.ativo }).eq("id", p.id);
    if (!error) setPlanos((arr) => arr.map((x) => (x.id === p.id ? { ...x, ativo: !x.ativo } : x)));
  }

  // ---------- tabela ainda não existe ----------
  if (semTabela) {
    return (
      <Panel title="Quase lá — falta criar a tabela" sub="passo único de configuração">
        <p className="text-[13.5px] leading-relaxed mb-3">
          O Planejamento guarda seus itens no Supabase (igual ao Orçamento). Rode o SQL abaixo
          uma vez em <b>Supabase → SQL Editor → New query → Run</b>. Também está salvo em{" "}
          <code className="text-[12px] bg-fill px-1 py-[1px] rounded">db/migrations/2026-06-15-planejamento.sql</code>.
        </p>
        <div className="relative">
          <pre className="bg-fill border border-line rounded-[10px] p-3 text-[11.5px] overflow-x-auto scroll-thin leading-snug">{SQL_PLANOS}</pre>
          <button
            onClick={() => { navigator.clipboard?.writeText(SQL_PLANOS); setCopiado(true); setTimeout(() => setCopiado(false), 1500); }}
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

  return (
    <div>
      <Toolbar
        right={<span className="text-muted text-[12px]">{planos.filter((p) => p.ativo).length} itens ativos</span>}
      >
        <Seg
          value={String(n)}
          onChange={(v) => setN(+v)}
          options={[{ v: "6", label: "6 meses" }, { v: "12", label: "12 meses" }, { v: "18", label: "18 meses" }]}
        />
      </Toolbar>

      {erro && <div className="bg-card border border-line rounded-[14px] p-3 shadow-card text-red mb-[18px] text-[13px]">{erro}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-[14px] mb-[18px]">
        <Kpi title="Gasto médio / mês" value={BRL(gastoMedio)} sub={`projeção de ${n} meses`} />
        <Kpi title={`Maior mês`} value={BRL(maior.gastos)} sub={maior.label} color="text-amber" />
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
                    <tr className="bg-card2">
                      <td colSpan={colCount} className="!py-[6px] text-[11px] uppercase tracking-wide text-muted font-semibold">
                        {t.icon} {t.label}
                      </td>
                    </tr>
                    {itens.map((p) => (
                      <tr key={p.id} className={p.ativo ? "" : "opacity-45"}>
                        <td className="min-w-[230px]">
                          <div className="flex items-center gap-2">
                            <input type="checkbox" checked={p.ativo} onChange={() => toggleAtivo(p)} title={p.ativo ? "ativo na projeção" : "ignorado"} className="cursor-pointer" />
                            <div className="min-w-0">
                              <div className="font-medium truncate">{p.nome}{p.categoria && <span className="text-muted text-[11px] font-normal"> · {p.categoria}</span>}</div>
                              <div className="text-muted text-[11px]">{resumoItem(p)}</div>
                            </div>
                          </div>
                        </td>
                        {meses.map((m) => {
                          const v = p.ativo ? contribNoMes(p, m.k) : 0;
                          return <td key={m.k} className={`num ${ehReceitaTipo(p.tipo) ? "text-green" : ""}`}>{v ? fmtCell(v) : <span className="text-line">·</span>}</td>;
                        })}
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
              {!loading && !planos.length && (
                <tr><td colSpan={colCount} className="!p-4 text-muted">Nenhum item ainda. Adicione gastos fixos, parcelamentos, pagamentos, metas e receitas no formulário abaixo.</td></tr>
              )}
              {loading && <tr><td colSpan={colCount} className="!p-4 text-muted">Carregando…</td></tr>}
            </tbody>
            {!!planos.length && (
              <tfoot>
                <tr className="font-semibold">
                  <td className="border-t-2 !border-t-line">Gastos planejados</td>
                  {proj.map((m, i) => <td key={m.k} className={`num border-t-2 !border-t-line ${i === 0 ? "text-accent" : ""}`}>{fmtCell(m.gastos)}</td>)}
                  <td className="border-t-2 !border-t-line"></td>
                </tr>
                <tr className="text-green">
                  <td>Receita prevista</td>
                  {proj.map((m) => <td key={m.k} className="num">{m.receita ? fmtCell(m.receita) : <span className="text-line">·</span>}</td>)}
                  <td></td>
                </tr>
                <tr className="font-bold">
                  <td>Saldo previsto</td>
                  {proj.map((m) => <td key={m.k} className={`num ${m.saldo < 0 ? "text-red" : "text-green"}`}>{fmtCell(m.saldo)}</td>)}
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
      <div className="text-muted text-[12px] mt-2">Valores na tabela em reais (sem centavos) para caber; KPIs e resumos mostram o valor cheio. A primeira coluna é o mês atual.</div>

      {/* ---------- formulário de adicionar / editar ---------- */}
      <Panel title={editId ? "Editar item" : "Adicionar ao planejamento"} className="mt-[18px]">
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
