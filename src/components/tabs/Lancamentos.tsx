import { useState, useMemo, useEffect, type Dispatch, type SetStateAction } from "react";
import type { Lancamento, Enqueue } from "../../types";
import { Kpi, Select, Seg } from "../ui";
import { CategoryPicker } from "../CategoryPicker";
import { TransacaoDetalhe } from "../TransacaoDetalhe";
import { sb } from "../../lib/supabase";
import { BRL0, kBRL, fmtMoeda, dicaMoedaOrigem, mesCurto, catKey, dataCompleta, dataOrdKey, ehGasto, ehReceita } from "../../lib/finance";
import {
  CLASSES,
  ehInterna,
  ehAporte,
  ehReceitaInvest,
} from "../../lib/lancClasses";
import { baixarCsv } from "../../lib/csv";
import { useToast } from "../Toast";

interface Props { dados: Lancamento[]; months: string[]; reload: () => void; enqueue: Enqueue; }

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

export function Lancamentos({ dados, months, enqueue }: Props) {
  const { toast } = useToast();
  const erroMsg = (e: unknown) => (e as { message?: string })?.message || String(e);
  const [busca, setBusca] = useState("");
  const [detalhe, setDetalhe] = useState<Lancamento | null>(null); // pop-up unificado de detalhe
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

  // helper: aplica na hora (in-place + rev), enfileira a escrita e, se falhar,
  // reverte o objeto e avisa. `set` é o mapa de feedback ("salvando…/✓").
  function editar(
    d: Lancamento,
    aplicar: () => void,
    reverter: () => void,
    persist: () => Promise<void>,
    set: Dispatch<SetStateAction<Record<number, string>>>,
    rotuloErro: string,
  ) {
    aplicar();
    setRev((r) => r + 1);
    set((s) => ({ ...s, [d.id]: "salvando…" }));
    enqueue(persist)
      .then(() => {
        set((s) => ({ ...s, [d.id]: "✓" }));
        setTimeout(() => set((s) => { const n = { ...s }; delete n[d.id]; return n; }), 1200);
      })
      .catch((e: unknown) => {
        reverter();
        setRev((r) => r + 1);
        set((s) => { const n = { ...s }; delete n[d.id]; return n; });
        toast({ message: rotuloErro + erroMsg(e), variant: "error" });
      });
  }

  function salvarCat(d: Lancamento, valor: string, sub?: string | null) {
    const novo = valor || null, novoSub = (novo && sub) || null;
    const prev = d.categoria_manual, prevSub = d.subcategoria_manual ?? null;
    editar(d,
      () => { d.categoria_manual = novo; d.subcategoria_manual = novoSub; },
      () => { d.categoria_manual = prev; d.subcategoria_manual = prevSub; },
      async () => { const { error } = await sb.from("lancamentos").update({ categoria_manual: novo, subcategoria_manual: novoSub }).eq("id", d.id); if (error) throw error; },
      setSalvos, "Erro ao salvar categoria: ");
  }

  // correção manual da CLASSE → grava em `classe_manual` (override). A re-tradução respeita.
  // Espelha o efetivo `d.classe` na hora só p/ a UI refletir; o efetivo real é recomputado no banco.
  function salvarClasse(d: Lancamento, valor: string) {
    const manual = valor || null;
    const prevManual = d.classe_manual, prevClasse = d.classe;
    const patch = manual ? { classe_manual: manual, classe: manual } : { classe_manual: null };
    editar(d,
      () => { d.classe_manual = manual; if (manual) d.classe = manual; },
      () => { d.classe_manual = prevManual; d.classe = prevClasse; },
      async () => { const { error } = await sb.from("lancamentos").update(patch).eq("id", d.id); if (error) throw error; },
      setSalvosClasse, "Erro ao salvar classe: ");
  }

  // correção manual de "entre contas próprias" → grava em `interna_manual` (boolean override).
  function salvarInterna(d: Lancamento, valor: boolean) {
    const prevManual = d.interna_manual, prevInterna = d.interna;
    editar(d,
      () => { d.interna_manual = valor; d.interna = valor; },
      () => { d.interna_manual = prevManual; d.interna = prevInterna; },
      async () => { const { error } = await sb.from("lancamentos").update({ interna_manual: valor, interna: valor }).eq("id", d.id); if (error) throw error; },
      setSalvosClasse, "Erro ao salvar: ");
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
  // edição em massa OTIMISTA: aplica na hora aos selecionados, limpa a seleção e
  // enfileira a escrita (em lotes de 500). Se falhar, reverte os objetos.
  function bulkUpdate(patch: Record<string, unknown>, apply: (d: Lancamento) => void, label: string) {
    const ids = [...sel];
    if (!ids.length) return;
    const keys = Object.keys(patch) as (keyof Lancamento)[];
    const afetados = dados.filter((d) => sel.has(d.id));
    // snapshot só das chaves que vão mudar, p/ rollback em caso de erro
    const snap = afetados.map((d) => {
      const antes: Partial<Lancamento> = {};
      keys.forEach((k) => { (antes as Record<string, unknown>)[k as string] = d[k]; });
      return { d, antes };
    });
    afetados.forEach(apply);
    setRev((r) => r + 1);
    setSel(new Set());
    const persist = async () => {
      for (let i = 0; i < ids.length; i += 500) {
        const { error } = await sb.from("lancamentos").update(patch).in("id", ids.slice(i, i + 500));
        if (error) throw error;
      }
    };
    enqueue(persist)
      .then(() => toast({ message: `${ids.length.toLocaleString("pt-BR")} ${label}`, variant: "success" }))
      .catch((e: unknown) => {
        snap.forEach(({ d, antes }) => Object.assign(d, antes));
        setRev((r) => r + 1);
        toast({ message: "Erro na edição em massa: " + erroMsg(e), variant: "error" });
      });
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
      <CategoryPicker value={d.categoria_manual || ""} subValue={d.subcategoria_manual || null} onSelect={(v, s) => salvarCat(d, v, s)} />
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
        <Kpi title="Gastos" value={kBRL(totals.gasto)} color="text-red" sub={fClasse === "Gasto" ? "filtrando ✕" : "ver na tabela ›"}
          onClick={() => setFClasse((f) => (f === "Gasto" ? "" : "Gasto"))} />
        <Kpi title="Receitas" value={kBRL(totals.receita)} color="text-green" sub={fClasse === "Receita" ? "filtrando ✕" : "ver na tabela ›"}
          onClick={() => setFClasse((f) => (f === "Receita" ? "" : "Receita"))} />
        <Kpi title="Saldo" value={kBRL(totals.saldo)} color={totals.saldo < 0 ? "text-red" : "text-green"} />
        <Kpi title="Lançamentos" value={rows.length.toLocaleString("pt-BR")} />
      </div>

      {/* visões de verificação (auditoria) — clique pra filtrar */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-[14px] mb-[18px]">
        <Kpi
          title="Aportes (investido)"
          value={BRL0(auditoria.aporte)}
          sub={visao === "aporte" ? "filtrando ✓" : "ver Aportes"}
          color="text-violet"
          onClick={() => setVisao((v) => (v === "aporte" ? "all" : "aporte"))}
        />
        <Kpi
          title="Renda de investimentos"
          value={BRL0(auditoria.rinvest)}
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
          <button className="btn-ghost" onClick={() => bulkInterna(true)}>Marcar “entre contas”</button>
          <button className="btn-ghost" onClick={() => bulkInterna(false)}>Desmarcar “entre contas”</button>
          <span className="text-[11.5px] text-muted">Receita/Gasto só contam se “entre contas” estiver desmarcado.</span>
          <button className="btn-ghost ml-auto" onClick={() => setSel(new Set())}>Limpar seleção</button>
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
                  <td className="max-w-[230px]">
                    <button
                      onClick={() => setDetalhe(d)}
                      title="Ver detalhes da transação"
                      className="max-w-full truncate block bg-transparent border-0 p-0 text-left cursor-pointer text-[inherit] hover:text-accent transition-colors"
                    >
                      {d.descricao}
                    </button>
                  </td>
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
                <button
                  onClick={() => setDetalhe(d)}
                  title="Ver detalhes da transação"
                  className="min-w-0 bg-transparent border-0 p-0 text-left cursor-pointer group"
                >
                  <div className="text-[13.5px] font-medium truncate group-hover:text-accent transition-colors" title={d.descricao}>{d.descricao}</div>
                  <div className="text-[11.5px] text-muted truncate">{mesCurto(d.competencia)} · {d.origem} · {dataCompleta(d)}</div>
                </button>
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

      {/* detalhe unificado de UMA transação */}
      <TransacaoDetalhe
        transacao={detalhe}
        onClose={() => setDetalhe(null)}
        onCategoria={(d, c, s) => salvarCat(d, c, s)}
        salvando={detalhe ? salvos[detalhe.id] : undefined}
      />
    </div>
  );
}
