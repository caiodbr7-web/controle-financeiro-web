import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { corCategoria } from "../lib/finance";
import { useCategorias } from "../lib/categorias";
import { semAcento } from "../lib/texto";

/* ---------- seletor de categoria com busca + teclado + cores ----------
   Substitui o <select> nativo no Classificar e em Lançamentos. Abre num portal
   (fixed) para não ser cortado pelo overflow das tabelas. Totalmente navegável
   por teclado: digite p/ filtrar, ↑/↓ move, Enter escolhe, Esc fecha.

   SUBCATEGORIAS: cada categoria pode ter subs (opcionais). Elas aparecem
   indentadas logo abaixo da categoria-mãe e também são escolhíveis — escolher
   uma sub define categoria + sub de uma vez; escolher a categoria "seca"
   limpa a sub. A busca também encontra subs (pelo nome da sub ou da mãe). */

interface Opcao { cat: string; sub: string | null }

interface Props {
  value: string;                       // categoria atual ("" = sem categoria)
  subValue?: string | null;            // subcategoria atual (opcional)
  onSelect: (c: string, sub?: string | null) => void; // escolhida ("" limpa)
  placeholder?: string;
  size?: "sm" | "md";
  className?: string;
  autoOpen?: boolean;                  // abre já aberto (uso no triage por teclado)
  onClose?: () => void;                // avisa quando fecha (devolve foco à lista)
}

export function CategoryPicker({
  value, subValue = null, onSelect, placeholder = "— escolher —", size = "sm", className = "", autoOpen = false, onClose,
}: Props) {
  const [aberto, setAberto] = useState(autoOpen);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const [rect, setRect] = useState<{ left: number; top: number; width: number; up: boolean } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { categorias } = useCategorias();

  const lista = useMemo<Opcao[]>(() => {
    const t = semAcento(q).toLowerCase().trim();
    const base: Opcao[] = [{ cat: "", sub: null }]; // "" = sem categoria (limpar)
    for (const c of categorias) {
      base.push({ cat: c.nome, sub: null });
      for (const s of c.subs) base.push({ cat: c.nome, sub: s.nome });
    }
    if (!t) return base;
    return base.filter((o) => {
      const alvo = o.cat === ""
        ? "sem categoria"
        : semAcento(o.sub ? `${o.cat} ${o.sub}` : o.cat).toLowerCase();
      return alvo.includes(t);
    });
  }, [q, categorias]);

  function posicionar() {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const w = Math.max(r.width, 220);
    const espacoAbaixo = window.innerHeight - r.bottom;
    const up = espacoAbaixo < 280 && r.top > espacoAbaixo;
    let left = r.left;
    if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
    setRect({ left: Math.max(8, left), top: up ? r.top : r.bottom, width: w, up });
  }

  useLayoutEffect(() => { if (aberto) posicionar(); }, [aberto]);
  useEffect(() => {
    if (!aberto) return;
    inputRef.current?.focus();
    const onScroll = () => posicionar();
    const onResize = () => posicionar();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("scroll", onScroll, true); window.removeEventListener("resize", onResize); };
  }, [aberto]);

  useEffect(() => { setHi((h) => Math.min(h, Math.max(0, lista.length - 1))); }, [lista.length]);

  function fechar() { setAberto(false); setQ(""); setHi(0); onClose?.(); }
  function escolher(o: Opcao) { onSelect(o.cat, o.sub); fechar(); }

  function abrir() {
    const idx = lista.findIndex((o) => o.cat === value && (o.sub || null) === (subValue || null));
    setHi(idx > 0 ? idx : 0);
    setAberto(true);
  }

  function onKey(e: ReactKeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, lista.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (lista[hi] !== undefined) escolher(lista[hi]); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); fechar(); }
  }

  const pad = size === "sm" ? "py-[6px] pl-[8px] pr-[26px] text-[13px] min-w-[140px]" : "py-[8px] pl-3 pr-[28px] text-[13.5px] min-w-[150px]";
  const rotulo = value ? (subValue ? `${value} › ${subValue}` : value) : placeholder;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => (aberto ? fechar() : abrir())}
        className={`select-chev relative inline-flex items-center gap-[7px] bg-card text-txt border border-line rounded-[8px] cursor-pointer outline-none focus-visible:border-muted hover:border-muted/70 transition-colors ${pad} ${className}`}
      >
        {value && <span className="w-[9px] h-[9px] rounded-full shrink-0" style={{ background: corCategoria(value) }} />}
        <span className={`truncate ${value ? "" : "text-muted"}`}>{rotulo}</span>
      </button>

      {aberto && rect && createPortal(
        <>
          <div className="fixed inset-0 z-[70]" onMouseDown={fechar} />
          <div
            className="fixed z-[71] bg-card border border-line rounded-[12px] shadow-pop p-[6px] fade-in"
            style={{
              left: rect.left,
              width: rect.width,
              ...(rect.up ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.top + 4 }),
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => { setQ(e.target.value); setHi(0); }}
              onKeyDown={onKey}
              placeholder="Buscar categoria…"
              className="input w-full !py-[7px] !text-[13px] mb-[6px]"
            />
            <div className="max-h-[260px] overflow-auto scroll-thin">
              {lista.length === 0 && <div className="text-muted text-[12.5px] px-2 py-2">Nada encontrado</div>}
              {lista.map((o, i) => {
                const selecionada = o.cat === value && (o.sub || null) === (subValue || null);
                return (
                  <button
                    key={o.cat ? `${o.cat}//${o.sub || ""}` : "__none__"}
                    type="button"
                    onMouseEnter={() => setHi(i)}
                    onClick={() => escolher(o)}
                    className={`w-full flex items-center gap-[9px] px-2 py-[7px] rounded-[8px] text-left text-[13px] border-0 cursor-pointer transition-colors ${
                      i === hi ? "bg-fill" : "bg-transparent"
                    } ${o.sub ? "pl-[26px]" : ""}`}
                  >
                    {o.cat
                      ? <span className={`rounded-full shrink-0 ${o.sub ? "w-[7px] h-[7px] opacity-70" : "w-[10px] h-[10px]"}`} style={{ background: corCategoria(o.cat) }} />
                      : <span className="w-[10px] h-[10px] rounded-full shrink-0 border border-line" />}
                    <span className={o.cat ? "" : "text-muted"}>{o.sub || o.cat || "Sem categoria"}</span>
                    {selecionada && <span className="ml-auto text-accent text-[12px]">✓</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </>,
        document.body
      )}
    </>
  );
}
