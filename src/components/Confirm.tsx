import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

/* ---------- diálogo de confirmação estilizado (promise-based) ----------
   Substitui o window.confirm() nativo. Uso:
     const confirm = useConfirm();
     if (!(await confirm({ title: "Remover?", danger: true }))) return;       */

interface ConfirmOpts {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOpts | null>(null);
  const resolver = useRef<(v: boolean) => void>();

  const confirm = useCallback((o: ConfirmOpts) => {
    setOpts(o);
    return new Promise<boolean>((res) => { resolver.current = res; });
  }, []);

  const fechar = useCallback((v: boolean) => {
    resolver.current?.(v);
    resolver.current = undefined;
    setOpts(null);
  }, []);

  useEffect(() => {
    if (!opts) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") fechar(false);
      if (e.key === "Enter") fechar(true);
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [opts, fechar]);

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {opts && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-[6px] flex items-center justify-center z-[90] p-4"
          onClick={(e) => { if (e.target === e.currentTarget) fechar(false); }}
        >
          <div className="bg-card border border-line rounded-[20px] max-w-[400px] w-full p-5 shadow-modal fade-in">
            <h3 className="text-[16px] font-semibold tracking-tight">{opts.title}</h3>
            {opts.message && <div className="text-muted text-[13.5px] leading-relaxed mt-[6px]">{opts.message}</div>}
            <div className="flex gap-2 justify-end mt-5">
              <button onClick={() => fechar(false)} className="btn-ghost !py-[9px] !px-4">
                {opts.cancelLabel || "Cancelar"}
              </button>
              <button
                onClick={() => fechar(true)}
                autoFocus
                className={`btn !py-[9px] !px-4 text-onaccent border-0 ${opts.danger ? "bg-red hover:opacity-90" : "bg-accent hover:bg-accent2"}`}
              >
                {opts.confirmLabel || "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmCtx.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmCtx);
