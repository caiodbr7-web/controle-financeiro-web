import { useEffect, useState } from "react";
import type { Lancamento, Mutate } from "../types";
import { BRL, catKey, corCategoria, dataCompleta } from "../lib/finance";
import { ehInterna } from "../lib/lancClasses";
import { CategoryPicker } from "./CategoryPicker";
import { sb } from "../lib/supabase";
import { useToast } from "./Toast";

export interface ModalData { title: string; rows: Lancamento[]; }

export function Modal({ data, onClose, mutate }: { data: ModalData | null; onClose: () => void; mutate?: Mutate }) {
  const { toast } = useToast();
  const [salvos, setSalvos] = useState<Record<number, string>>({});
  const [rev, setRev] = useState(0); // força recomputar a agregação após editar uma categoria

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  // edição de categoria direto do pop-up → grava em `categoria_manual` (override).
  // OTIMISTA: reflete na hora (objeto local + dashboards via patch) e a escrita
  // vai para a fila em background — sem `reload` bloqueante.
  function salvarCat(d: Lancamento, valor: string, sub?: string | null) {
    const novo = valor || null;
    const novoSub = (novo && sub) || null;
    d.categoria_manual = novo; // espelha na tabela do próprio pop-up
    d.subcategoria_manual = novoSub;
    setRev((r) => r + 1);
    setSalvos((s) => ({ ...s, [d.id]: "salvando…" }));
    const persist = async () => {
      const { error } = await sb.from("lancamentos").update({ categoria_manual: novo, subcategoria_manual: novoSub }).eq("id", d.id);
      if (error) throw error;
    };
    const finalizar = () => {
      setSalvos((s) => ({ ...s, [d.id]: "✓" }));
      setTimeout(() => setSalvos((s) => { const n = { ...s }; delete n[d.id]; return n; }), 1200);
    };
    const p = mutate
      ? mutate({ ids: [d.id], patch: { categoria_manual: novo, subcategoria_manual: novoSub }, persist })
      : persist();
    p.then(finalizar).catch((e: unknown) => {
      setSalvos((s) => ({ ...s, [d.id]: "" }));
      toast({ message: "Erro ao salvar categoria: " + ((e as { message?: string })?.message || e), variant: "error" });
    });
  }

  if (!data) return null;
  void rev; // dependência implícita do recálculo abaixo
  const grupos: Record<string, number> = {};
  data.rows.forEach((d) => { const k = catKey(d); grupos[k] = (grupos[k] || 0) + Math.abs(d.valor); });
  const cats = Object.keys(grupos).sort((a, b) => grupos[b] - grupos[a]);
  const tot = cats.reduce((s, k) => s + grupos[k], 0);
  const ord = [...data.rows].sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor));

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
            className="w-[30px] h-[30px] rounded-full bg-fill text-muted hover:text-txt border-0 cursor-pointer flex items-center justify-center text-[13px] shrink-0 transition-colors"
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
                <tr key={k}>
                  <td>
                    <span className="inline-flex items-center gap-[7px]">
                      <span className="w-[8px] h-[8px] rounded-full shrink-0" style={{ background: corCategoria(k) }} />
                      {k}
                    </span>
                  </td>
                  <td className="num">{BRL(grupos[k])}</td>
                  <td className="num">{tot ? ((grupos[k] / tot) * 100).toFixed(1) : 0}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h4 className="text-[11px] text-muted uppercase tracking-[.05em] mt-[18px] mb-2 font-semibold">Transações ({data.rows.length})</h4>
          <div className="max-h-[420px] overflow-auto scroll-thin">
            <table className="tbl min-w-[620px]">
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
                    <td className="max-w-[230px] truncate" title={d.descricao}>{d.descricao}</td>
                    <td>{d.origem}</td>
                    <td className="whitespace-nowrap">
                      <span className="inline-flex items-center gap-[5px]">
                        {d.classe || "—"}
                        {ehInterna(d) && <span className="text-violet text-[11px]" title="Entre contas próprias">⇄</span>}
                        {d.subtipo && <span className="text-muted text-[11px]">· {d.subtipo}</span>}
                      </span>
                    </td>
                    <td>
                      <span className="inline-flex items-center gap-[6px]">
                        <CategoryPicker
                          value={d.categoria_manual || d.categoria_auto || ""}
                          subValue={d.categoria_manual ? d.subcategoria_manual || null : null}
                          onSelect={(v, s) => salvarCat(d, v, s)}
                        />
                        {salvos[d.id] && <span className="text-muted text-[11px] whitespace-nowrap">{salvos[d.id]}</span>}
                      </span>
                    </td>
                    <td className={`num ${d.valor < 0 ? "text-red" : "text-green"}`}>{BRL(d.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
