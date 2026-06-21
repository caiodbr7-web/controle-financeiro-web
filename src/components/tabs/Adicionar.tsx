import type { ReactNode } from "react";
import { Importar } from "./Importar";
import { Conectar } from "./Conectar";

export type MetodoAdd = "arquivo" | "banco";

const METODOS: { id: MetodoAdd; titulo: string; desc: string; icon: ReactNode }[] = [
  {
    id: "arquivo",
    titulo: "Importar arquivo",
    desc: "CSV, Excel (.xlsx) ou OFX exportado do banco",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 3v4a1 1 0 0 0 1 1h4" />
        <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" />
        <path d="M12 17v-6M9.5 13.5 12 11l2.5 2.5" />
      </svg>
    ),
  },
  {
    id: "banco",
    titulo: "Conectar banco",
    desc: "Open Finance via Pluggy — sincroniza automaticamente",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 10 12 4l9 6" />
        <path d="M4 10v9M20 10v9M9 10v9M15 10v9M3 19h18" />
      </svg>
    ),
  },
];

/* Aba "Adicionar": ponto de entrada único para trazer lançamentos.
   Um seletor escolhe o método (arquivo manual ou banco via Open Finance) e
   abaixo renderiza o fluxo completo correspondente. */
export function Adicionar({
  reload, metodo, onMetodo,
}: { reload: () => void; metodo: MetodoAdd; onMetodo: (m: MetodoAdd) => void }) {
  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-[18px] max-w-[760px]">
        {METODOS.map((m) => {
          const on = metodo === m.id;
          return (
            <button
              key={m.id}
              onClick={() => onMetodo(m.id)}
              aria-pressed={on}
              className={`text-left rounded-[16px] border p-4 cursor-pointer transition-colors flex items-start gap-3 ${
                on ? "border-accent bg-accent/5" : "border-line bg-card hover:border-muted/60"
              }`}
            >
              <span className={`shrink-0 w-[38px] h-[38px] rounded-[11px] flex items-center justify-center transition-colors ${
                on ? "bg-accent text-white" : "bg-fill text-muted"
              }`}>
                {m.icon}
              </span>
              <span className="min-w-0">
                <span className="block text-[14px] font-semibold">{m.titulo}</span>
                <span className="block text-[12.5px] text-muted leading-snug mt-[2px]">{m.desc}</span>
              </span>
            </button>
          );
        })}
      </div>

      {metodo === "arquivo" ? <Importar reload={reload} /> : <Conectar reload={reload} />}
    </div>
  );
}
