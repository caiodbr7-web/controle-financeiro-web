import { useRef, useState, type CSSProperties, type PointerEvent as RPE, type ReactNode } from "react";

/* ---------- lista reordenável por arraste (toque + mouse) ----------
   Substitui as setinhas ↑/↓: a pessoa segura a ALÇA de um item e arrasta
   para a nova posição; a lista reflui ao vivo e a ordem é confirmada ao
   soltar. Usa Pointer Events com captura, então funciona igual no dedo
   (mobile) e no mouse. Só a alça inicia o arraste — tocar no resto da
   linha continua rolando a página normalmente.

   O componente é "burro": não conhece categorias. Recebe os itens, sabe
   ler o id de cada um (getId) e devolve a nova ordem de ids em onReorder. */

export interface AlcaProps {
  onPointerDown: (e: RPE) => void;
  onPointerMove: (e: RPE) => void;
  onPointerUp: (e: RPE) => void;
  onPointerCancel: (e: RPE) => void;
  style: CSSProperties;
  title: string;
  "aria-label": string;
}

export function ListaOrdenavel<T>({
  items, getId, onReorder, render, className, disabled,
}: {
  items: T[];
  getId: (t: T) => number;
  onReorder: (ids: number[]) => void;
  render: (item: T, alca: AlcaProps, arrastando: boolean) => ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  // enquanto arrasta, `ordem` guarda os ids na sequência atual (preview ao vivo)
  const [ordem, setOrdem] = useState<number[] | null>(null);
  const arrastandoId = useRef<number | null>(null);
  const linhas = useRef<Map<number, HTMLElement>>(new Map());

  const idsBase = items.map(getId);
  const ids = ordem ?? idsBase;
  const byId = new Map(items.map((it) => [getId(it), it] as const));
  const lista = ids.map((id) => byId.get(id)).filter((x): x is T => x != null);

  const setLinhaRef = (id: number) => (el: HTMLElement | null) => {
    if (el) linhas.current.set(id, el); else linhas.current.delete(id);
  };

  function iniciar(e: RPE, id: number) {
    if (disabled) return;
    arrastandoId.current = id;
    setOrdem(idsBase);
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* noop */ }
  }

  function mover(e: RPE) {
    if (arrastandoId.current == null) return;
    e.preventDefault();
    const y = e.clientY;
    const atual = ordem ?? idsBase;
    const semArrastado = atual.filter((x) => x !== arrastandoId.current);
    // índice de inserção = quantas linhas (fora a arrastada) têm o meio acima do dedo
    let alvo = 0;
    for (const id of semArrastado) {
      const el = linhas.current.get(id);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (y > r.top + r.height / 2) alvo++;
    }
    const novo = [...semArrastado.slice(0, alvo), arrastandoId.current, ...semArrastado.slice(alvo)];
    if (novo.join(",") !== atual.join(",")) setOrdem(novo);
  }

  function soltar() {
    const final = ordem;
    const id = arrastandoId.current;
    arrastandoId.current = null;
    setOrdem(null);
    if (id != null && final && final.join(",") !== idsBase.join(",")) onReorder(final);
  }

  return (
    <div className={className} style={arrastandoId.current != null ? { userSelect: "none" } : undefined}>
      {lista.map((item) => {
        const id = getId(item);
        const arrastando = arrastandoId.current === id;
        const alca: AlcaProps = {
          onPointerDown: (e) => iniciar(e, id),
          onPointerMove: mover,
          onPointerUp: soltar,
          onPointerCancel: soltar,
          style: { touchAction: "none", cursor: arrastando ? "grabbing" : "grab" },
          title: "Arraste para reordenar",
          "aria-label": "Arraste para reordenar",
        };
        return (
          <div key={id} ref={setLinhaRef(id)} style={arrastando ? { position: "relative", zIndex: 20 } : undefined}>
            {render(item, alca, arrastando)}
          </div>
        );
      })}
    </div>
  );
}

/* alça padrão (ícone de "grip" com 6 pontinhos) */
export function AlcaArrastar({ alca, className = "" }: { alca: AlcaProps; className?: string }) {
  return (
    <button
      type="button"
      {...alca}
      className={`shrink-0 flex items-center justify-center text-muted hover:text-txt bg-transparent border-0 p-0 touch-none ${className}`}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" />
        <circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" />
        <circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" />
      </svg>
    </button>
  );
}
