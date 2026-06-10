import type { ReactNode } from "react";

export function Panel({
  title, sub, right, children, className = "",
}: { title?: ReactNode; sub?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`bg-card border border-line rounded-[18px] p-4 sm:p-5 shadow-card mb-5 min-w-0 ${className}`}>
      {(title || right) && (
        <div className="flex flex-wrap gap-3 items-center justify-between mb-1">
          <h2 className="text-[16px] font-semibold tracking-tight">
            {title} {sub && <span className="text-muted text-xs font-normal">{sub}</span>}
          </h2>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

export function Kpi({
  title, value, sub, color = "",
}: { title: ReactNode; value: ReactNode; sub?: ReactNode; color?: string }) {
  return (
    <div className="bg-card border border-line rounded-[18px] p-[18px] shadow-card">
      <div className="text-muted text-[11.5px] uppercase tracking-[.06em] font-semibold">{title}</div>
      <div className={`text-[20px] sm:text-[25px] font-semibold mt-[7px] tracking-tight ${color}`}>{value}</div>
      {sub !== undefined && <div className="text-xs mt-[5px] text-muted">{sub}</div>}
    </div>
  );
}

export function Seg<T extends string>({
  value, onChange, options,
}: { value: T; onChange: (v: T) => void; options: { v: T; label: string }[] }) {
  return (
    <div className="inline-flex gap-[2px] bg-[#ececf0] p-1 rounded-[11px] flex-wrap">
      {options.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={`whitespace-nowrap border-0 px-[13px] py-[7px] text-[13.5px] cursor-pointer rounded-[8px] font-medium transition ${
            value === o.v ? "bg-card text-txt shadow-[0_1px_3px_rgba(0,0,0,.12)]" : "bg-transparent text-muted hover:text-txt"
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
      className={`bg-card text-txt border border-line rounded-[10px] px-3 py-[9px] text-[15px] ${className}`}
    >
      {children}
    </select>
  );
}
