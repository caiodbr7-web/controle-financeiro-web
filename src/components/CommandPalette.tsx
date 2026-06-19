import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { semAcento } from "../lib/texto";

/* ---------- paleta de comandos (Cmd/Ctrl+K) ----------
   Pula pra qualquer aba e executa ações rápidas. Totalmente por teclado. */

export interface Cmd {
  id: string;
  label: string;
  grupo: string;
  hint?: string;
  keywords?: string;
  dot?: boolean;        // marcador de pendência
  run: () => void;
}

export function CommandPalette({ open, onClose, commands }: { open: boolean; onClose: () => void; commands: Cmd[] }) {
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (open) { setQ(""); setHi(0); setTimeout(() => inputRef.current?.focus(), 10); } }, [open]);

  const filtrados = useMemo(() => {
    const t = semAcento(q).toLowerCase().trim();
    if (!t) return commands;
    return commands.filter((c) => semAcento(c.label + " " + c.grupo + " " + (c.keywords || "")).toLowerCase().includes(t));
  }, [q, commands]);

  useEffect(() => { setHi((h) => Math.min(h, Math.max(0, filtrados.length - 1))); }, [filtrados.length]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${hi}"]`)?.scrollIntoView({ block: "nearest" });
  }, [hi]);

  if (!open) return null;

  function escolher(c?: Cmd) { if (!c) return; onClose(); c.run(); }
  function onKey(e: ReactKeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, filtrados.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); escolher(filtrados[hi]); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  }

  // agrupa preservando a ordem de aparição
  const ordemGrupos: string[] = [];
  filtrados.forEach((c) => { if (!ordemGrupos.includes(c.grupo)) ordemGrupos.push(c.grupo); });
  let idx = -1;

  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-[6px] flex items-start justify-center z-[80] p-4 pt-[12vh]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-card border border-line rounded-[16px] w-full max-w-[520px] shadow-[0_20px_60px_rgba(0,0,0,.3)] fade-in overflow-hidden">
        <div className="flex items-center gap-2 px-4 border-b border-line">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted shrink-0"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" strokeLinecap="round" /></svg>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setHi(0); }}
            onKeyDown={onKey}
            placeholder="Ir para… ou buscar uma ação"
            className="flex-1 bg-transparent border-0 outline-none py-[14px] text-[15px] text-txt placeholder:text-muted/70"
          />
          <kbd className="kbd hidden sm:inline-flex">Esc</kbd>
        </div>
        <div ref={listRef} className="max-h-[52vh] overflow-auto scroll-thin py-2">
          {filtrados.length === 0 && <div className="text-muted text-[13px] px-4 py-6 text-center">Nada encontrado</div>}
          {ordemGrupos.map((grupo) => (
            <div key={grupo}>
              <div className="text-[10.5px] uppercase tracking-[.06em] text-muted font-semibold px-4 pt-2 pb-1">{grupo}</div>
              {filtrados.filter((c) => c.grupo === grupo).map((c) => {
                idx++; const i = idx;
                return (
                  <button
                    key={c.id}
                    data-i={i}
                    onMouseEnter={() => setHi(i)}
                    onClick={() => escolher(c)}
                    className={`w-full flex items-center gap-3 px-4 py-[9px] text-left border-0 cursor-pointer transition-colors ${i === hi ? "bg-fill" : "bg-transparent"}`}
                  >
                    <span className="text-[13.5px] flex-1 truncate">{c.label}</span>
                    {c.dot && <span className="w-[6px] h-[6px] rounded-full bg-amber shrink-0" />}
                    {c.hint && <span className="text-muted text-[11.5px] shrink-0">{c.hint}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
