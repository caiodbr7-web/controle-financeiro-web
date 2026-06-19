import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

/* ---------- sistema de toasts (feedback unificado do app) ----------
   Substitui as mensagens soltas e os alert() nativos. Suporta uma ação
   opcional (ex.: "Desfazer"), que mantém o toast vivo até o usuário decidir. */

type Variant = "success" | "error" | "info";

interface ToastOpts {
  message: string;
  variant?: Variant;
  duration?: number; // ms; 0 = não some sozinho
  action?: { label: string; onClick: () => void };
}
interface ToastItem extends ToastOpts {
  id: number;
  saindo?: boolean;
}

const ToastCtx = createContext<{ toast: (o: ToastOpts) => number; dismiss: (id: number) => void }>({
  toast: () => 0,
  dismiss: () => {},
});

const ICONS: Record<Variant, ReactNode> = {
  success: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
  ),
  error: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
  ),
  info: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.5v.5" /></svg>
  ),
};
const TONE: Record<Variant, string> = {
  success: "text-green",
  error: "text-red",
  info: "text-accent",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [itens, setItens] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  const dismiss = useCallback((id: number) => {
    setItens((xs) => xs.map((x) => (x.id === id ? { ...x, saindo: true } : x)));
    window.setTimeout(() => setItens((xs) => xs.filter((x) => x.id !== id)), 200);
    if (timers.current[id]) { clearTimeout(timers.current[id]); delete timers.current[id]; }
  }, []);

  const toast = useCallback((o: ToastOpts) => {
    const id = ++seq.current;
    setItens((xs) => [...xs.slice(-3), { id, variant: "info", ...o }]);
    const dur = o.duration ?? (o.action ? 6000 : o.variant === "error" ? 5000 : 3000);
    if (dur > 0) timers.current[id] = setTimeout(() => dismiss(id), dur);
    return id;
  }, [dismiss]);

  return (
    <ToastCtx.Provider value={{ toast, dismiss }}>
      {children}
      <div className="fixed z-[100] left-1/2 -translate-x-1/2 bottom-[18px] flex flex-col items-center gap-[10px] w-[calc(100vw-32px)] max-w-[420px] pointer-events-none">
        {itens.map((t) => {
          const v = t.variant || "info";
          return (
            <div
              key={t.id}
              role="status"
              className={`pointer-events-auto w-full flex items-center gap-[11px] bg-card border border-line rounded-[14px] px-[14px] py-[11px] shadow-pop ${
                t.saindo ? "toast-out" : "toast-in"
              }`}
            >
              <span className={`shrink-0 ${TONE[v]}`}>{ICONS[v]}</span>
              <span className="flex-1 text-[13.5px] leading-snug min-w-0">{t.message}</span>
              {t.action && (
                <button
                  onClick={() => { t.action!.onClick(); dismiss(t.id); }}
                  className="shrink-0 text-accent text-[13px] font-semibold bg-transparent border-0 cursor-pointer hover:underline px-1"
                >
                  {t.action.label}
                </button>
              )}
              <button
                onClick={() => dismiss(t.id)}
                aria-label="Fechar"
                className="shrink-0 w-[22px] h-[22px] rounded-full bg-transparent text-muted hover:text-txt border-0 cursor-pointer flex items-center justify-center text-[12px]"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
