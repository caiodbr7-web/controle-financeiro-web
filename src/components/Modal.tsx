import { useEffect } from "react";
import type { Lancamento } from "../types";
import { BRL, catKey, corCategoria } from "../lib/finance";

export interface ModalData { title: string; rows: Lancamento[]; }

export function Modal({ data, onClose }: { data: ModalData | null; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  if (!data) return null;
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
      <div className="bg-card border border-line rounded-[20px] max-w-[860px] w-full max-h-[88vh] flex flex-col shadow-[0_20px_60px_rgba(0,0,0,.25)] fade-in">
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
            <table className="tbl min-w-[520px]">
              <thead><tr>
                <th>Data</th>
                <th>Descrição</th>
                <th>Origem</th>
                <th>Categoria</th>
                <th className="num">Valor</th>
              </tr></thead>
              <tbody>
                {ord.map((d) => (
                  <tr key={d.id}>
                    <td>{d.data_mov}</td>
                    <td className="max-w-[230px] truncate" title={d.descricao}>{d.descricao}</td>
                    <td>{d.origem}</td>
                    <td>{catKey(d)}</td>
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
