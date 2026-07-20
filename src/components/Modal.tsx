import { useEffect, useState, type ReactNode } from "react";
import type { Lancamento, Mutate } from "../types";
import { BRL, kBRL, catKey, corCategoria, dataCompleta } from "../lib/finance";
import { ehInterna, ehReceita, ehReceitaInvest, CLASSES } from "../lib/lancClasses";
import { CategoryPicker } from "./CategoryPicker";
import { TransacaoDetalhe } from "./TransacaoDetalhe";
import { Select } from "./ui";
import { sb } from "../lib/supabase";
import { useToast } from "./Toast";

export interface ModalData { title: string; rows: Lancamento[]; }

// rótulos amigáveis para as classes (valores canônicos ficam no banco)
const CLASSE_LABEL: Record<string, string> = {
  Gasto: "Gasto",
  "Estorno/Credito": "Estorno / crédito",
  Receita: "Receita",
  Aporte: "Aporte (investido)",
  "Receita Investimento": "Renda de investimento",
  "Transferencia/Pagamento": "Transferência / pagamento",
};

export function Modal({ data, onClose, mutate }: { data: ModalData | null; onClose: () => void; mutate?: Mutate }) {
  const { toast } = useToast();
  const [salvos, setSalvos] = useState<Record<number, string>>({});
  const [rev, setRev] = useState(0); // força recomputar a agregação após editar
  const [detalhe, setDetalhe] = useState<Lancamento | null>(null); // transação aberta no pop-up de detalhe
  const [filtroCat, setFiltroCat] = useState<string | null>(null); // linha clicada em "Por categoria" filtra a lista
  useEffect(() => { setDetalhe(null); setFiltroCat(null); }, [data]); // reabertura com outros dados zera o estado

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  // editor OTIMISTA genérico: aplica na hora (objeto local + dashboards via patch),
  // enfileira a escrita e, se falhar, reverte e avisa. `d` aqui é a MESMA referência
  // que está nos dashboards, então mexer nele reflete em todo lugar.
  function editar(
    d: Lancamento,
    patch: Record<string, unknown>,
    aplicar: () => void,
    reverter: () => void,
    rotuloErro: string,
  ) {
    aplicar();
    setRev((r) => r + 1);
    setSalvos((s) => ({ ...s, [d.id]: "salvando…" }));
    const persist = async () => {
      const { error } = await sb.from("lancamentos").update(patch).eq("id", d.id);
      if (error) throw error;
    };
    const p = mutate ? mutate({ ids: [d.id], patch, persist }) : persist();
    p.then(() => {
      setSalvos((s) => ({ ...s, [d.id]: "✓" }));
      setTimeout(() => setSalvos((s) => { const n = { ...s }; delete n[d.id]; return n; }), 1200);
    }).catch((e: unknown) => {
      reverter();
      setRev((r) => r + 1);
      setSalvos((s) => { const n = { ...s }; delete n[d.id]; return n; });
      toast({ message: rotuloErro + ((e as { message?: string })?.message || e), variant: "error" });
    });
  }

  // categoria/subcategoria → grava em `categoria_manual` (override)
  function salvarCat(d: Lancamento, valor: string, sub?: string | null) {
    const novo = valor || null, novoSub = (novo && sub) || null;
    const prev = d.categoria_manual, prevSub = d.subcategoria_manual ?? null;
    editar(d, { categoria_manual: novo, subcategoria_manual: novoSub },
      () => { d.categoria_manual = novo; d.subcategoria_manual = novoSub; },
      () => { d.categoria_manual = prev; d.subcategoria_manual = prevSub; },
      "Erro ao salvar categoria: ");
  }

  // classe (Gasto/Receita/Renda de investimento/…) → grava em `classe_manual` (override)
  // e espelha o efetivo `classe` p/ a UI refletir na hora.
  function salvarClasse(d: Lancamento, valor: string) {
    const manual = valor || null;
    const prevManual = d.classe_manual, prevClasse = d.classe;
    const patch = manual ? { classe_manual: manual, classe: manual } : { classe_manual: null };
    editar(d, patch,
      () => { d.classe_manual = manual; if (manual) d.classe = manual; },
      () => { d.classe_manual = prevManual; d.classe = prevClasse; },
      "Erro ao salvar classe: ");
  }

  // "entre contas próprias" → grava em `interna_manual` (boolean override)
  function salvarInterna(d: Lancamento, valor: boolean) {
    const prevManual = d.interna_manual, prevInterna = d.interna;
    editar(d, { interna_manual: valor, interna: valor },
      () => { d.interna_manual = valor; d.interna = valor; },
      () => { d.interna_manual = prevManual; d.interna = prevInterna; },
      "Erro ao salvar: ");
  }

  if (!data) return null;
  void rev; // dependência implícita do recálculo abaixo
  const grupos: Record<string, number> = {};
  data.rows.forEach((d) => { const k = catKey(d); grupos[k] = (grupos[k] || 0) + Math.abs(d.valor); });
  const cats = Object.keys(grupos).sort((a, b) => grupos[b] - grupos[a]);
  const tot = cats.reduce((s, k) => s + grupos[k], 0);
  // clicar numa linha de "Por categoria" filtra a lista de transações abaixo
  const visiveis = filtroCat ? data.rows.filter((d) => catKey(d) === filtroCat) : data.rows;
  const ord = [...visiveis].sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor));

  // seletor de classe (compartilhado mobile/desktop)
  const classeSelect = (d: Lancamento): ReactNode => (
    <Select
      value={d.classe || ""}
      onChange={(v) => salvarClasse(d, v)}
      className={`!pl-2 !py-[5px] !text-[12px] ${d.classe_manual ? "border-accent" : ""}`}
    >
      <option value="">— classe —</option>
      {CLASSES.map((c) => <option key={c} value={c}>{CLASSE_LABEL[c] || c}</option>)}
    </Select>
  );

  // toggle "entre contas próprias" (compartilhado)
  const internaToggle = (d: Lancamento): ReactNode => (
    <label className="inline-flex items-center gap-[5px] text-[11.5px] text-muted cursor-pointer select-none whitespace-nowrap" title="Movimento entre contas próprias (não entra em gasto/receita)">
      <input
        type="checkbox"
        checked={ehInterna(d)}
        onChange={(e) => salvarInterna(d, e.target.checked)}
        className="accent-accent w-[14px] h-[14px]"
      />
      entre contas
    </label>
  );

  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-[6px] flex items-center justify-center z-50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-card border border-line rounded-[20px] max-w-[860px] w-full max-h-[88vh] flex flex-col shadow-modal fade-in">
        <div className="flex justify-between items-start gap-3 p-5 border-b border-line">
          <div className="min-w-0">
            <h3 className="text-[16px] font-semibold tracking-tight truncate">{data.title}</h3>
            <div className="text-muted text-[12px] mt-[2px]">{data.rows.length} transações · total {BRL(tot)}</div>
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="tap w-[30px] h-[30px] rounded-full bg-fill text-muted hover:text-txt border-0 cursor-pointer flex items-center justify-center text-[13px] shrink-0 transition-colors"
          >
            ✕
          </button>
        </div>
        <div className="p-5 overflow-auto scroll-thin">
          <h4 className="text-[11px] text-muted uppercase tracking-[.05em] mb-2 font-semibold">Por categoria / tipo</h4>
          <table className="tbl">
            <thead><tr>
              <th>Categoria / tipo</th>
              <th className="num">Valor</th>
              <th className="num">%</th>
            </tr></thead>
            <tbody>
              {cats.map((k) => (
                <tr
                  key={k}
                  onClick={() => setFiltroCat((f) => (f === k ? null : k))}
                  title={filtroCat === k ? "Mostrar todas as transações" : `Ver só as transações de ${k}`}
                  className={`cursor-pointer transition-colors ${filtroCat === k ? "bg-accent/10" : "hover:bg-fill/60"}`}
                >
                  <td>
                    <span className="inline-flex items-center gap-[7px]">
                      <span className="w-[8px] h-[8px] rounded-full shrink-0" style={{ background: corCategoria(k) }} />
                      {k}
                      {filtroCat === k && <span className="text-accent text-[11px]">· filtrando</span>}
                    </span>
                  </td>
                  <td className="num">{kBRL(grupos[k])}</td>
                  <td className="num">{tot ? ((grupos[k] / tot) * 100).toFixed(1) : 0}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h4 className="text-[11px] text-muted uppercase tracking-[.05em] mt-[18px] mb-2 font-semibold">
            Transações ({ord.length}{filtroCat ? ` de ${data.rows.length}` : ""})
            {filtroCat && (
              <button onClick={() => setFiltroCat(null)} className="ml-2 text-accent normal-case tracking-normal font-medium bg-transparent border-0 p-0 cursor-pointer hover:underline text-[11.5px]">
                limpar filtro ✕
              </button>
            )}
          </h4>
          {/* mobile: cartões (sem rolagem horizontal) */}
          <div className="md:hidden max-h-[440px] overflow-auto scroll-thin divide-y divide-line -mx-2">
            {ord.map((d) => (
              <div key={d.id} className="px-2 py-[12px]">
                <button
                  onClick={() => setDetalhe(d)}
                  title="Ver detalhes da transação"
                  className="w-full flex items-start justify-between gap-3 bg-transparent border-0 p-0 text-left cursor-pointer group"
                >
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium truncate group-hover:text-accent transition-colors" title={d.descricao}>{d.descricao}</div>
                    <div className="text-muted text-[11.5px] truncate">
                      {dataCompleta(d)} · {d.origem}
                      {d.subtipo && <span className="ml-1">· {d.subtipo}</span>}
                    </div>
                  </div>
                  <div className={`tabular-nums text-[13px] font-medium shrink-0 ${d.valor < 0 ? "text-red" : ehReceita(d.classe) || ehReceitaInvest(d.classe) ? "text-green" : ""}`}>{BRL(d.valor)}</div>
                </button>
                {/* controles: classe · categoria · entre contas */}
                <div className="mt-[9px] flex flex-wrap items-center gap-x-2 gap-y-[8px]">
                  {classeSelect(d)}
                  <CategoryPicker
                    value={d.categoria_manual || d.categoria_auto || ""}
                    subValue={d.categoria_manual ? d.subcategoria_manual || null : null}
                    onSelect={(v, s) => salvarCat(d, v, s)}
                  />
                  {internaToggle(d)}
                  {salvos[d.id] && <span className="text-[11px] text-green">{salvos[d.id]}</span>}
                </div>
              </div>
            ))}
          </div>

          <div className="hidden md:block max-h-[440px] overflow-auto scroll-thin">
            <table className="tbl min-w-[720px]">
              <thead><tr>
                <th>Data</th>
                <th>Descrição</th>
                <th>Origem</th>
                <th>Classe / tipo</th>
                <th>Categoria</th>
                <th className="num">Valor</th>
              </tr></thead>
              <tbody>
                {ord.map((d) => (
                  <tr key={d.id}>
                    <td className="whitespace-nowrap">{dataCompleta(d)}</td>
                    <td className="max-w-[220px]">
                      <button
                        onClick={() => setDetalhe(d)}
                        title="Ver detalhes da transação"
                        className="max-w-full truncate block bg-transparent border-0 p-0 text-left cursor-pointer text-[inherit] hover:text-accent transition-colors"
                      >
                        {d.descricao}
                      </button>
                    </td>
                    <td>{d.origem}</td>
                    <td>
                      <div className="flex items-center gap-[6px]">
                        {classeSelect(d)}
                        {d.classe_manual && <span className="text-[10px] text-accent" title="Classe corrigida na mão (override)">✎</span>}
                        {d.subtipo && <span className="text-muted text-[11px] whitespace-nowrap">· {d.subtipo}</span>}
                      </div>
                      <div className="mt-[5px]">{internaToggle(d)}</div>
                    </td>
                    <td>
                      <span className="inline-flex items-center gap-[6px]">
                        <CategoryPicker
                          value={d.categoria_manual || d.categoria_auto || ""}
                          subValue={d.categoria_manual ? d.subcategoria_manual || null : null}
                          onSelect={(v, s) => salvarCat(d, v, s)}
                        />
                        {salvos[d.id] && <span className="text-[11px] text-green whitespace-nowrap">{salvos[d.id]}</span>}
                      </span>
                    </td>
                    <td className={`num ${d.valor < 0 ? "text-red" : ehReceita(d.classe) || ehReceitaInvest(d.classe) ? "text-green" : ""}`}>{BRL(d.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* detalhe unificado de UMA transação — abre por cima deste modal */}
      <TransacaoDetalhe
        transacao={detalhe}
        onClose={() => setDetalhe(null)}
        onCategoria={(d, c, s) => salvarCat(d, c, s)}
        salvando={detalhe ? salvos[detalhe.id] : undefined}
      />
    </div>
  );
}
