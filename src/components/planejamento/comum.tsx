import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { STATUS_INFO, diasAte, type Ocorrencia } from "../../lib/agenda";

export const inp = "bg-input text-txt border border-line rounded-[8px] px-[10px] py-[7px] text-[13px] outline-none focus:border-accent transition-colors placeholder:text-muted/70 w-full";
export const lbl = "flex flex-col gap-1 text-[11.5px] text-muted font-medium";

/** reais inteiros, com sinal (células compactas de planilha) */
export const fmtN = (v: number) => (v < 0 ? "-" : "") + Math.abs(Math.round(v)).toLocaleString("pt-BR");
/** "1.234,56" → 1234.56 (aceita também "117.02") */
export function parseValorBR(s: string): number | null {
  if (s == null || !String(s).trim()) return null;
  let t = String(s).trim().replace(/[R$\s]/g, "");
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (!/^-?\d+\.\d{1,2}$/.test(t)) t = t.replace(/\./g, "");
  const n = parseFloat(t);
  return isNaN(n) ? null : n;
}
export const valorStr = (v: number | null | undefined) => (v == null ? "" : String(v).replace(".", ","));

/** pílula de status: ícone + rótulo (nunca só cor) */
export function StatusBadge({ o }: { o: Ocorrencia }) {
  const info = STATUS_INFO[o.status];
  let txt = info.label;
  if (o.venc && o.status === "atrasado") txt = `Atrasado ${-diasAte(o.venc)}d`;
  if (o.venc && o.status === "proximo") { const d = diasAte(o.venc); txt = d === 1 ? "Amanhã" : `Em ${d} dias`; }
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-[6px] px-[7px] py-[2px] text-[11px] font-semibold ${info.cls}`}>
      <span aria-hidden>{info.icon}</span>{txt}
    </span>
  );
}

/** diálogo modal (folha no rodapé no celular, centralizado no desktop) */
export function Dialog({ title, sub, onClose, children, footer, width = 560 }: {
  title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 bg-black/40 backdrop-blur-[6px] z-[90] flex items-end sm:items-start justify-center sm:p-4 sm:pt-[6vh] overflow-auto"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-card border border-line rounded-t-[18px] sm:rounded-[18px] w-full max-h-[92vh] flex flex-col shadow-modal fade-in" style={{ maxWidth: width }}>
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-line">
          <div className="min-w-0">
            <h3 className="text-[16px] font-semibold tracking-tight">{title}</h3>
            {sub && <div className="text-muted text-[12.5px] mt-[2px]">{sub}</div>}
          </div>
          <button onClick={onClose} aria-label="Fechar"
            className="tap w-[28px] h-[28px] rounded-full bg-fill text-muted hover:text-txt border-0 cursor-pointer flex items-center justify-center text-[12px] shrink-0">✕</button>
        </div>
        <div className="px-5 py-4 overflow-auto scroll-thin">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-line flex flex-wrap gap-2 justify-end">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** botão "copiar" para dados de pagamento */
export function Copiar({ texto, onCopiado }: { texto: string; onCopiado?: () => void }) {
  return (
    <button type="button"
      onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(texto).catch(() => {}); onCopiado?.(); }}
      className="bg-transparent border border-line rounded-[6px] px-[7px] py-[1px] text-[11px] text-muted hover:text-accent hover:border-accent cursor-pointer">
      Copiar
    </button>
  );
}
