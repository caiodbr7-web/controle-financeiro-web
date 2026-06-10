import { useEffect } from "react";
import type { Lancamento } from "../types";
import { BRL, catKey } from "../lib/finance";

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
      className="fixed inset-0 bg-black/30 backdrop-blur-[6px] flex items-center justify-center z-50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-card border border-line rounded-[20px] max-w-[860px] w-full max-h-[88vh] flex flex-col shadow-[0_20px_60px_rgba(0,0,0,.2)]">
        <div className="flex justify-between items-start gap-3 p-5 border-b border-line">
          <div>
            <h3 className="text-[17px] font-semibold">{data.title}</h3>
            <div className="text-muted text-xs">{data.rows.length} transações · total {BRL(tot)}</div>
          </div>
          <button onClick={onClose} className="bg-transparent border border-line text-muted rounded-[10px] px-4 py-2 cursor-pointer hover:text-txt">Fechar</button>
        </div>
        <div className="p-5 overflow-auto">
          <h4 className="text-xs text-muted uppercase tracking-[.05em] mb-2 font-semibold">Por categoria / tipo</h4>
          <table className="w-full border-collapse text-[13.5px]">
            <thead><tr className="text-muted text-[11px] uppercase">
              <th className="text-left p-2 border-b border-line">Categoria / tipo</th>
              <th className="text-right p-2 border-b border-line">Valor</th>
              <th className="text-right p-2 border-b border-line">%</th>
            </tr></thead>
            <tbody>
              {cats.map((k) => (
                <tr key={k}>
                  <td className="text-left p-2 border-b border-line">{k}</td>
                  <td className="text-right p-2 border-b border-line">{BRL(grupos[k])}</td>
                  <td className="text-right p-2 border-b border-line">{tot ? ((grupos[k] / tot) * 100).toFixed(1) : 0}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h4 className="text-xs text-muted uppercase tracking-[.05em] mt-[18px] mb-2 font-semibold">Transações ({data.rows.length})</h4>
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full border-collapse text-[13.5px]">
              <thead><tr className="text-muted text-[11px] uppercase">
                <th className="text-left p-2 border-b border-line">Data</th>
                <th className="text-left p-2 border-b border-line">Descrição</th>
                <th className="text-left p-2 border-b border-line">Origem</th>
                <th className="text-left p-2 border-b border-line">Categoria</th>
                <th className="text-right p-2 border-b border-line">Valor</th>
              </tr></thead>
              <tbody>
                {ord.map((d) => (
                  <tr key={d.id}>
                    <td className="text-left p-2 border-b border-line">{d.data_mov}</td>
                    <td className="text-left p-2 border-b border-line max-w-[230px] truncate" title={d.descricao}>{d.descricao}</td>
                    <td className="text-left p-2 border-b border-line">{d.origem}</td>
                    <td className="text-left p-2 border-b border-line">{catKey(d)}</td>
                    <td className={`text-right p-2 border-b border-line ${d.valor < 0 ? "text-red" : "text-green"}`}>{BRL(d.valor)}</td>
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
