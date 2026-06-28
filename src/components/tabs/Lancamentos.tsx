import { useState, useMemo, useEffect } from "react";
import type { Lancamento } from "../../types";
import { Kpi, Select, Seg } from "../ui";
import { CategoryPicker } from "../CategoryPicker";
import { sb } from "../../lib/supabase";
import { BRL, fmtMoeda, dicaMoedaOrigem, mesCurto, catKey, dataCompleta, dataOrdKey, ehGasto, ehReceita } from "../../lib/finance";
import {
  CLASSES,
  ehInterna,
  ehAporte,
  ehReceitaInvest,
} from "../../lib/lancClasses";
import { baixarCsv } from "../../lib/csv";
import { useToast } from "../Toast";

interface Props { dados: Lancamento[]; months: string[]; reload: () => void; }

const PERIODOS = [
  { v: "all", label: "Tudo" }, { v: "12", label: "12m" }, { v: "6", label: "6m" }, { v: "3", label: "3m" },
];
// visões de verificação (auditoria do dono) — filtram sobre as classes/flags efetivas
const VISOES = [
  { v: "all", label: "Todos" },
  { v: "aporte", label: "Aportes" },
  { v: "rinvest", label: "Renda invest." },
  { v: "interna_sem_par", label: "Interna s/ par" },
] as const;
type VisaoLanc = (typeof VISOES)[number]["v"];
const PAGINA = 200;

export function Lancamentos({ dados, months }: Props) {
  const { toast } = useToast();
  const [busca, setBusca] = useState("");
  const [periodo, setPeriodo] = useState("all");
  const [fComp, setFComp] = useState("");
  const [fBanco, setFBanco] = useState("");
  const [fOrigem, setFOrigem] = useState("");
  const [fClasse, setFClasse] = useState("");
  const [visao, setVisao] = useState<VisaoLanc>("all");
  const [sortCol, setSortCol] = useState<keyof Lancamento>("competencia");
  const [sortDir, setSortDir] = useState(-1);
  const [salvos, setSalvos] = useState<Record<number, string>>({});
  // feedback "salvando…/✓" da correção de classe/interna (separado da categoria)
  const [salvosClasse, setSalvosClasse] = useState<Record<number, string>>({});
  const [visiveis, setVisiveis] = useState(PAGINA);
  const [sel, setSel] = useState<Set<number>>(new Set()); // ids selecionados p/ edição em massa
  const [bulkBusy, setBulkBusy] = useState(false);
  const [rev, setRev] = useState(0); // bump força recompute dos memos após editar em memória

  const bancos = useMemo(() => [...new Set(dados.map((d) => d.banco))].sort(), [dados]);
  const origens = useMemo(() => [...new Set(dados.filter((d) => !fBanco || d.banco === fBanco).map((d) => d.origem))].sort(), [dados, fBanco]);
  const classes = useMemo(() => [...new Set(dados.map((d) => d.classe).filter(Boolean))].sort() as string[], [dados]);

  // janela de meses do filtro de período (sobre a competência)
  const periodoSet = useMemo(() => {
    if (periodo === "all") return null;
    const ms = [...new Set(dados.map((d) => d.competencia))].sort();
    return new Set(ms.slice(-(parseInt(periodo, 10) || 12)));
  }, [dados, periodo]);

  // visão de verificação: filtra sobre as classes/flags EFETIVAS já gravadas em `lancamentos`
  const passaVisao = (d: Lancamento): boolean => {
    if (visao === "aporte") return ehAporte(d.classe);
    if (visao === "rinvest") return ehReceitaInvest(d.classe);
    // interna marcada (entre contas próprias) mas sem perna casada — auditar
    if (visao === "interna_sem_par") return ehInterna(d) && !d.par_hash;
    return true;
  };

  const rows = useMemo(() => {
    const q = busca.toLowerCase();
    const r = dados.filter((d) =>
      (!periodoSet || periodoSet.has(d.competencia)) &&
      (!fComp || d.competencia === fComp) && (!fBanco || d.banco === fBanco) &&
      (!fOrigem || d.origem === fOrigem) && (!fClasse || d.classe === fClasse) &&
      passaVisao(d) &&
      (!q || String(d.descricao || "").toLowerCase().includes(q) || String(d.detalhe || "").toLowerCase().includes(q)));
    return r.sort((a, b) => {
      if (sortCol === "valor") return (a.valor - b.valor) * sortDir;
      if (sortCol === "data_mov") return dataOrdKey(a).localeCompare(dataOrdKey(b)) * sortDir;
      return String(a[sortCol] || "").localeCompare(String(b[sortCol] || "")) * sortDir;
    });
  }, [dados, busca, periodoSet, fComp, fBanco, fOrigem, fClasse, visao, sortCol, sortDir, rev]);

  // volta pro topo da paginação quando o filtro muda
  useEffect(() => { setVisiveis(PAGINA); setSel(new Set()); }, [busca, periodoSet, fComp, fBanco, fOrigem, fClasse, visao]);

  const totals = useMemo(() => {
    let gasto = 0, receita = 0;
    rows.forEach((d) => { if (ehGasto(d.classe)) gasto += Math.abs(d.valor); else if (ehReceita(d.classe)) receita += Math.abs(d.valor); });
    return { gasto, receita, saldo: receita - gasto };
  }, [rows, rev]);

  // contadores das visões de verificação (sobre o conjunto `dados` da visão atual de natureza/modo)
  const auditoria = useMemo(() => {
    let aporte = 0, rinvest = 0, internaSemPar = 0;
    dados.forEach((d) => {
      if (ehAporte(d.classe)) aporte += Math.abs(d.valor);
      if (ehReceitaInvest(d.classe)) rinvest += Math.abs(d.valor);
      if (ehInterna(d) && !d.par_hash) internaSemPar++;
    });
    return { aporte, rinvest, internaSemPar };
  }, [dados, rev]);

  async function salvarCat(d: Lancamento, valor: string) {
    setSalvos((s) => ({ ...s, [d.id]: "salvando…" }));
    const { error } = await sb.from("lancamentos").update({ categoria_manual: valor || null }).eq("id", d.id);
    if (error) { setSalvos((s) => ({ ...s, [d.id]: "" })); toast({ message: "Erro ao salvar categoria: " + error.message, variant: "error" }); return; }
    d.categoria_manual = valor || null;
    setSalvos((s) => ({ ...s, [d.id]: "✓" }));
    setTimeout(() => setSalvos((s) => { const n = { ...s }; delete n[d.id]; return n; }), 1200);
  }

  // correção manual da CLASSE → grava em `classe_manual` (override). A re-tradução respeita.
  // Espelha o efetivo `d.classe` na hora só p/ a UI refletir; o efetivo real é recomputado no banco.
  async function salvarClasse(d: Lancamento, valor: string) {
    const manual = valor || null;
    setSalvosClasse((s) => ({ ...s, [d.id]: "salvando…" }));
    // grava override + (quando definido) o efetivo `classe`, p/ refletir já nos dashboards
    const patch = manual ? { classe_manual: manual, classe: manual } : { classe_manual: null };
    const { error } = await sb.from("lancamentos").update(patch).eq("id", d.id);
    if (error) { setSalvosClasse((s) => ({ ...s, [d.id]: "" })); toast({ message: "Erro ao salvar classe: " + error.message, variant: "error" }); return; }
    d.classe_manual = manual;
    if (manual) d.classe = manual; // override aplicado: reflete já no efetivo p/ a UI
    setRev((r) => r + 1);
    setSalvosClasse((s) => ({ ...s, [d.id]: "✓" }));
    setTimeout(() => setSalvosClasse((s) => { const n = { ...s }; delete n[d.id]; return n; }), 1200);
  }

  // correção manual de "entre contas próprias" → grava em `interna_manual` (boolean override).
  async function salvarInterna(d: Lancamento, valor: boolean) {
    setSalvosClasse((s) => ({ ...s, [d.id]: "salvando…" }));
    const { error } = await sb.from("lancamentos").update({ interna_manual: valor, interna: valor }).eq("id", d.id);
    if (error) { setSalvosClasse((s) => ({ ...s, [d.id]: "" })); toast({ message: "Erro ao salvar: " + error.message, variant: "error" }); return; }
    d.interna_manual = valor;
    d.interna = valor; // reflete já no efetivo p/ a UI
    setRev((r) => r + 1);
    setSalvosClasse((s) => ({ ...s, [d.id]: "✓" }));
    setTimeout(() => setSalvosClasse((s) => { const n = { ...s }; delete n[d.id]; return n; }), 1200);
  }

  // ---------- seleção + edição em massa ----------
  const toggleOne = (id: number) =>
    setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () =>
    setSel((cur) => {
      const all = rows.length > 0 && rows.every((d) => cur.has(d.id));
      return all ? new Set<number>() : new Set(rows.map((d) => d.id));
    });

  // aplica um patch (override + efetivo) a TODOS os selecionados, em lotes de 500.
  async function bulkUpdate(patch: Record<string, unknown>, apply: (d: Lancamento) => void, label: string) {
    const ids = [...sel];
    if (!ids.length) return;
    setBulkBusy(true);
    for (let i = 0; i < ids.length; i += 500) {
      const { error } = await sb.from("lancamentos").update(patch).in("id", ids.slice(i, i + 500));
      if (error) { setBulkBusy(false); toast({ message: "Erro na edição em massa: " + error.message, variant: "error" }); return; }
    }
    dados.forEach((d) => { if (sel.has(d.id)) apply(d); });
    setBulkBusy(false); setRev((r) => r + 1); setSel(new Set());
    toast({ message: `${ids.length.toLocaleString("pt-BR")} ${label}`, variant: "success" });
  }
  // classe_manual + classe efetivo (reflete já nos dashboards; o sync mantém via coalesce).
  const bulkClasse = (v: string) => {
    if (!v) return;
    bulkUpdate({ classe_manual: v, classe: v }, (d) => { d.classe_manual = v; d.classe = v; }, "lançamentos reclassificados");
  };
  // interna_manual + interna efetivo.
  const bulkInterna = (v: boolean) =>
    bulkUpdate({ interna_manual: v, interna: v }, (d) => { d.interna_manual = v; d.interna = v; },
      v ? "marcados como entre contas próprias" : "desmarcados de entre contas próprias");

  function exportar() {
    baixarCsv("lancamentos", rows, [
      { label: "Competência", value: (d) => mesCurto(d.competencia) },
      { label: "Banco", value: (d) => d.banco },
      { label: "Origem", value: (d) => d.origem },
      { label: "Data", value: (d) => dataCompleta(d) },
      { label: "Descrição", value: (d) => d.descricao },
      { label: "Classe", value: (d) => d.classe },
      { label: "Subtipo", value: (d) => d.subtipo || "" },
      { label: "Interna", value: (d) => (ehInterna(d) ? "sim" : "nao") },
      { label: "Par casado", value: (d) => (d.par_hash ? "sim" : "nao") },
      { label: "Categoria", value: (d) => catKey(d) },
      { label: "Valor", value: (d) => Number(d.valor).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
      { label: "Moeda", value: (d) => d.moeda || "BRL" },
    ]);
    toast({ message: `${rows.length.toLocaleString("pt-BR")} lançamentos exportados.`, variant: "success" });
  }

  function th(col: keyof Lancamento, label: string) {
    return (
      <th
        className="cursor-pointer select-none sticky top-0 bg-card z-[1]"
        onClick={() => { if (sortCol === col) setSortDir((x) => x * -1); else { setSortCol(col); setSortDir(col === "valor" ? -1 : 1); } }}
      >
        {label}{sortCol === col ? (sortDir > 0 ? " ▲" : " ▼") : ""}
      </th>
    );
  }

  const temFiltro = busca || periodo !== "all" || fComp || fBanco || fOrigem || fClasse || visao !== "all";
  const limpar = () => { setBusca(""); setPeriodo("all"); setFComp(""); setFBanco(""); setFOrigem(""); setFClasse(""); setVisao("all"); };
  const mostrados = rows.slice(0, visiveis);
  const allSel = rows.length > 0 && rows.every((d) => sel.has(d.id));

  // célula de categoria (compartilhada entre tabela e cartões)
  const catCell = (d: Lancamento) => (
    <span className="inline-flex items-center gap-2">
      <CategoryPicker value={d.categoria_manual || ""} onSelect={(v) => salvarCat(d, v)} />
      {salvos[d.id] && <span className="text-[12px] text-green">{salvos[d.id]}</span>}
    </span>
  );

  // seletor de CLASSE: grava em `classe_manual` (override). Valor exibido = classe efetiva.
  const classeCell = (d: Lancamento) => (
    <span className="inline-flex items-center gap-2 min-w-0">
      <Select
        value={d.classe || ""}
        onChange={(v) => salvarClasse(d, v)}
        className={`!pl-2 !py-[5px] !text-[12.5px] ${d.classe_manual ? "border-accent" : ""}`}
      >
        <option value="">— sem classe —</option>
        {CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
      </Select>
      {d.classe_manual && <span className="text-[10px] text-accent" title="Classe corrigida na mão (override)">✎</span>}
      {salvosClasse[d.id] && <span className="text-[12px] text-green">{salvosClasse[d.id]}</span>}
    </span>
  );

  // selos: entre contas próprias (interna), subtipo, e par casado
  const selos = (d: Lancamento) => (
    <span className="inline-flex flex-wrap items-center gap-[5px]">
      {ehInterna(d) && (
        <span className="inline-flex items-center rounded-full bg-violet/15 text-violet px-[7px] py-[1px] text-[10.5px] font-semibold" title="Movimento entre contas próprias (não entra em gasto/receita)">
          ⇄ interna{d.interna_manual != null ? " ✎" : ""}
        </span>
      )}
      {d.subtipo && (
        <span className="inline-flex items-center rounded-full bg-fill text-muted px-[7px] py-[1px] text-[10.5px] font-medium" title="Subtipo">
          {d.subtipo}
        </span>
      )}
      {d.par_hash && (
        <span className="inline-flex items-center rounded-full bg-green/10 text-green px-[7px] py-[1px] text-[10.5px] font-semibold" title="Tem par casado (as duas pernas da transferência foram ligadas)">
          🔗 par
        </span>
      )}
    </span>
  );

  // checkbox "entre contas próprias" → grava em `interna_manual`
  const internaToggle = (d: Lancamento) => (
    <label className="inline-flex items-center gap-[5px] text-[11.5px] text-muted cursor-pointer select-none whitespace-nowrap" title="Marcar/desmarcar movimento entre contas próprias (grava em interna_manual)">
      <input
        type="checkbox"
        checked={ehInterna(d)}
        onChange={(e) => salvarInterna(d, e.target.checked)}
        className="accent-accent w-[14px] h-[14px]"
      />
      entre contas próprias
    </label>
  );

  const valCell = (d: Lancamento) => (
    <>
      {fmtMoeda(d.valor, d.moeda)}
      {dicaMoedaOrigem(d) && <span className="text-muted text-[11px] ml-1">({dicaMoedaOrigem(d)})</span>}
    </>
  );

  return (
    <div>
      <div className="flex flex-wrap gap-2 items-center mb-4">
        <input className="input min-w-[180px] flex-1" placeholder="Buscar descrição…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <Seg size="sm" value={periodo} onChange={setPeriodo} options={PERIODOS} />
        <Select value={fComp} onChange={setFComp}>
          <option value="">Todos os meses</option>
          {months.map((m) => <option key={m} value={m}>{mesCurto(m)}</option>)}
        </Select>
        <Select value={fBanco} onChange={(v) => { setFBanco(v); setFOrigem(""); }}>
          <option value="">Todos os bancos</option>
          {bancos.map((b) => <option key={b}>{b}</option>)}
        </Select>
        <Select value={fOrigem} onChange={setFOrigem}>
          <option value="">Todas as origens</option>
          {origens.map((o) => <option key={o}>{o}</option>)}
        </Select>
        <Select value={fClasse} onChange={setFClasse}>
          <option value="">Todas as classes</option>
          {classes.map((c) => <option key={c}>{c}</option>)}
        </Select>
        <Seg size="sm" value={visao} onChange={(v) => setVisao(v as VisaoLanc)} options={VISOES as unknown as { v: string; label: string }[]} />
        {temFiltro && <button className="btn-ghost" onClick={limpar}>Limpar</button>}
        <button className="btn-ghost ml-auto" onClick={exportar} disabled={!rows.length}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
          Exportar CSV
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-[14px] mb-[18px]">
        <Kpi title="Gastos" value={BRL(totals.gasto)} color="text-red" />
        <Kpi title="Receitas" value={BRL(totals.receita)} color="text-green" />
        <Kpi title="Saldo" value={BRL(totals.saldo)} color={totals.saldo < 0 ? "text-red" : "text-green"} />
        <Kpi title="Lançamentos" value={rows.length.toLocaleString("pt-BR")} />
      </div>

      {/* visões de verificação (auditoria) — clique pra filtrar */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-[14px] mb-[18px]">
        <Kpi
          title="Aportes (investido)"
          value={BRL(auditoria.aporte)}
          sub={visao === "aporte" ? "filtrando ✓" : "ver Aportes"}
          color="text-violet"
          onClick={() => setVisao((v) => (v === "aporte" ? "all" : "aporte"))}
        />
        <Kpi
          title="Renda de investimentos"
          value={BRL(auditoria.rinvest)}
          sub={visao === "rinvest" ? "filtrando ✓" : "ver Renda invest."}
          color="text-accent"
          onClick={() => setVisao((v) => (v === "rinvest" ? "all" : "rinvest"))}
        />
        <Kpi
          title="Interna sem par casado"
          value={auditoria.internaSemPar.toLocaleString("pt-BR")}
          sub={visao === "interna_sem_par" ? "filtrando ✓" : "auditar par_hash nulo"}
          color={auditoria.internaSemPar ? "text-amber" : "text-muted"}
          onClick={() => setVisao((v) => (v === "interna_sem_par" ? "all" : "interna_sem_par"))}
        />
      </div>

      {/* ----- edição em massa: barra de ação (aparece com ≥1 selecionado) ----- */}
      {sel.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3 px-3 py-[10px] bg-accent/10 border border-accent/30 rounded-[12px]">
          <span className="text-[13px] font-semibold whitespace-nowrap">{sel.size.toLocaleString("pt-BR")} selecionado(s)</span>
          <Select value="" onChange={bulkClasse} className="!py-[5px] !text-[12.5px]">
            <option value="">Definir classe…</option>
            {CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
          <button className="btn-ghost" disabled={bulkBusy} onClick={() => bulkInterna(true)}>Marcar “entre contas”</button>
          <button className="btn-ghost" disabled={bulkBusy} onClick={() => bulkInterna(false)}>Desmarcar “entre contas”</button>
          <span className="text-[11.5px] text-muted">Receita/Gasto só contam se “entre contas” estiver desmarcado.</span>
          <button className="btn-ghost ml-auto" disabled={bulkBusy} onClick={() => setSel(new Set())}>Limpar seleção</button>
        </div>
      )}

      {/* mobile: selecionar todos do filtro atual */}
      <div className="md:hidden mb-2">
        <button className="btn-ghost" onClick={toggleAll}>{allSel ? "Limpar seleção" : `Selecionar todos (${rows.length.toLocaleString("pt-BR")})`}</button>
      </div>

      {/* ----- desktop: tabela ----- */}
      <div className="hidden md:block bg-card border border-line rounded-[18px] shadow-card overflow-hidden">
        <div className="max-h-[560px] overflow-auto scroll-thin">
          <table className="tbl min-w-[1040px]">
            <thead><tr>
              <th className="sticky top-0 bg-card z-[1] w-[34px] text-center">
                <input type="checkbox" className="accent-accent w-[14px] h-[14px] align-middle"
                  ref={(el) => { if (el) el.indeterminate = sel.size > 0 && !allSel; }}
                  checked={allSel} onChange={toggleAll} title="Selecionar todos (filtro atual)" />
              </th>
              {th("competencia", "Mês")}{th("banco", "Banco")}{th("origem", "Origem")}{th("data_mov", "Data")}
              {th("descricao", "Descrição")}{th("classe", "Classe")}
              <th className="sticky top-0 bg-card z-[1]">Tipo / par</th>
              <th className="sticky top-0 bg-card z-[1]">Categoria</th>
              {th("valor", "Valor")}
            </tr></thead>
            <tbody>
              {mostrados.map((d) => (
                <tr key={d.id} className={sel.has(d.id) ? "bg-accent/5" : ""}>
                  <td className="text-center">
                    <input type="checkbox" className="accent-accent w-[14px] h-[14px] align-middle"
                      checked={sel.has(d.id)} onChange={() => toggleOne(d.id)} />
                  </td>
                  <td>{mesCurto(d.competencia)}</td>
                  <td>{d.banco}</td>
                  <td>{d.origem}</td>
                  <td className="whitespace-nowrap">{dataCompleta(d)}</td>
                  <td className="max-w-[230px] truncate" title={d.descricao}>{d.descricao}</td>
                  <td>
                    {classeCell(d)}
                    <div className="mt-[5px]">{internaToggle(d)}</div>
                  </td>
                  <td>{selos(d)}</td>
                  <td>{catCell(d)}</td>
                  <td className={`num ${d.valor < 0 ? "text-red" : ehReceita(d.classe) ? "text-green" : ""}`}>{valCell(d)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ----- mobile: cartões ----- */}
      <div className="md:hidden bg-card border border-line rounded-[18px] shadow-card divide-y divide-line overflow-hidden">
        {mostrados.map((d) => (
          <div key={d.id} className={`p-[13px] ${sel.has(d.id) ? "bg-accent/5" : ""}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex items-start gap-2">
                <input type="checkbox" className="accent-accent w-[15px] h-[15px] mt-[2px] shrink-0"
                  checked={sel.has(d.id)} onChange={() => toggleOne(d.id)} />
                <div className="min-w-0">
                  <div className="text-[13.5px] font-medium truncate" title={d.descricao}>{d.descricao}</div>
                  <div className="text-[11.5px] text-muted truncate">{mesCurto(d.competencia)} · {d.origem} · {dataCompleta(d)}</div>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className={`tabular-nums text-[13.5px] font-medium ${d.valor < 0 ? "text-red" : ehReceita(d.classe) ? "text-green" : ""}`}>{valCell(d)}</div>
                <div className="text-[11px] text-muted">{d.classe}</div>
              </div>
            </div>
            {(ehInterna(d) || d.subtipo || d.par_hash) && <div className="mt-[8px]">{selos(d)}</div>}
            <div className="mt-[10px] flex flex-wrap items-center gap-2">
              {classeCell(d)}
              {internaToggle(d)}
            </div>
            <div className="mt-[10px] flex items-center gap-2">
              {ehGasto(d.classe) && !d.categoria_manual && <span className="w-[7px] h-[7px] rounded-full bg-amber shrink-0" />}
              {catCell(d)}
            </div>
          </div>
        ))}
        {!mostrados.length && <div className="p-4 text-muted text-[13px]">Nenhum lançamento com esses filtros.</div>}
      </div>

      {rows.length > visiveis && (
        <div className="flex items-center gap-3 mt-3">
          <button onClick={() => setVisiveis((v) => v + PAGINA * 2)} className="btn-ghost">Carregar mais</button>
          <span className="text-muted text-[12.5px]">Mostrando {mostrados.length.toLocaleString("pt-BR")} de {rows.length.toLocaleString("pt-BR")}</span>
        </div>
      )}
    </div>
  );
}
