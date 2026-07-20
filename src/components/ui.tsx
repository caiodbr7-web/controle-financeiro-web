import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/* ---------- Legenda: linha discreta que abre um pop-up com a explicação ----------
   Substitui os parágrafos longos de ajuda espalhados pelas abas. Fica abaixo do
   objeto que explica; no celular abre como "folha" no rodapé, no desktop centrada. */
export function Legenda({ children, className = "" }: { children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open]);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-[5px] text-[11.5px] text-muted hover:text-txt bg-transparent border-0 p-0 cursor-pointer transition-colors ${className}`}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.5v.5" />
        </svg>
        Legenda
      </button>
      {open && createPortal(
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-[6px] z-[90] flex items-end sm:items-center justify-center sm:p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div className="bg-card border border-line rounded-t-[18px] sm:rounded-[18px] w-full sm:max-w-[560px] max-h-[80vh] flex flex-col shadow-modal fade-in">
            <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3 border-b border-line">
              <h3 className="text-[14px] font-semibold tracking-tight">Legenda</h3>
              <button
                onClick={() => setOpen(false)}
                aria-label="Fechar"
                className="tap w-[28px] h-[28px] rounded-full bg-fill text-muted hover:text-txt border-0 cursor-pointer flex items-center justify-center text-[12px] shrink-0"
              >✕</button>
            </div>
            <div className="px-5 py-4 pb-6 sm:pb-4 overflow-auto scroll-thin text-[13px] text-muted leading-relaxed">
              {children}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

export function Panel({
  title, sub, right, children, className = "",
}: { title?: ReactNode; sub?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`bg-card border border-line rounded-[18px] p-4 sm:p-5 shadow-card mb-[18px] min-w-0 ${className}`}>
      {(title || right) && (
        <div className="flex flex-wrap gap-x-3 gap-y-2 items-center justify-between mb-2">
          <h2 className="font-display text-[16px] font-bold tracking-tight">
            {title} {sub && <span className="text-muted text-[12px] font-normal font-sans">{sub}</span>}
          </h2>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

export function Kpi({
  title, value, sub, color = "", onClick,
}: { title: ReactNode; value: ReactNode; sub?: ReactNode; color?: string; onClick?: () => void }) {
  const Tag: any = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={`bg-card border border-line rounded-[16px] p-4 sm:p-[18px] shadow-card min-w-0 text-left transition-all duration-[280ms] hover:-translate-y-[3px] hover:shadow-card-hover ${
        onClick ? "cursor-pointer hover:border-accent/50" : ""
      }`}
    >
      <div className="text-muted text-[12.5px] font-semibold">{title}</div>
      <div className={`font-display text-[22px] sm:text-[26px] font-bold mt-[6px] tracking-tight tabular-nums ${color}`}>{value}</div>
      {sub !== undefined && <div className="text-[11.5px] mt-[4px] text-muted leading-snug">{sub}</div>}
    </Tag>
  );
}

export function Seg<T extends string>({
  value, onChange, options, size = "md",
}: { value: T; onChange: (v: T) => void; options: { v: T; label: string }[]; size?: "sm" | "md" }) {
  const pad = size === "sm" ? "px-[10px] py-[5px] text-[12.5px]" : "px-[13px] py-[7px] text-[13px]";
  return (
    <div className="inline-flex gap-[2px] bg-soft p-[3px] rounded-[10px] flex-wrap">
      {options.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={`whitespace-nowrap border-0 ${pad} cursor-pointer rounded-[8px] transition-all ${
            value === o.v
              ? "bg-card text-accent font-bold shadow-card"
              : "bg-transparent text-muted hover:text-txt font-medium"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Select({
  value, onChange, children, className = "",
}: { value: string; onChange: (v: string) => void; children: ReactNode; className?: string }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`select-chev bg-card text-txt border border-line rounded-[10px] pl-3 py-[8px] text-[13.5px] font-medium cursor-pointer outline-none hover:border-accent focus:border-accent transition-colors ${className}`}
    >
      {children}
    </select>
  );
}

/* linha padrão de controles no topo de cada aba */
export function Toolbar({ children, right }: { children?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-2 items-center justify-between mb-4">
      <div className="flex flex-wrap gap-x-[10px] gap-y-2 items-center min-w-0">{children}</div>
      {right && <div className="flex flex-wrap gap-2 items-center">{right}</div>}
    </div>
  );
}

/* barra horizontal fina (ranking de categorias etc.) — leve, sem chart lib */
export function BarRow({
  label, value, max, color, right, onClick,
}: { label: ReactNode; value: number; max: number; color: string; right: ReactNode; onClick?: () => void }) {
  const Tag: any = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} className={`w-full bg-transparent border-0 p-0 text-left block ${onClick ? "cursor-pointer group" : ""}`}>
      <div className="flex items-baseline justify-between gap-3 text-[13px] mb-[4px]">
        <span className={`font-medium truncate ${onClick ? "group-hover:text-accent transition-colors" : ""}`}>{label}</span>
        <span className="text-muted tabular-nums shrink-0 text-[12.5px]">{right}</span>
      </div>
      <div className="h-[5px] rounded-full bg-fill overflow-hidden">
        <div
          className="h-full rounded-full transition-[width] duration-300"
          style={{ width: `${max > 0 ? Math.max(2, (value / max) * 100) : 0}%`, background: color }}
        />
      </div>
    </Tag>
  );
}
