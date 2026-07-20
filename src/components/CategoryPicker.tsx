import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { corCategoria } from "../lib/finance";
import { useCategorias } from "../lib/categorias";
import { semAcento } from "../lib/texto";

/* ---------- seletor de categoria com busca + teclado + cores ----------
   Substitui o <select> nativo no Classificar e em Lançamentos. Abre num portal
   (fixed) para não ser cortado pelo overflow das tabelas. Totalmente navegável
   por teclado: digite p/ filtrar, ↑/↓ move, Enter escolhe, Esc fecha.

   SUBCATEGORIAS: a classificação aponta sempre para a FOLHA da hierarquia.
   Uma categoria SEM subcategorias é escolhível diretamente. Uma categoria
   COM subcategorias NÃO é escolhível sozinha — ela vira só um cabeçalho, e
   as escolhíveis são as suas subcategorias (indentadas abaixo). Assim nenhuma
   categoria com sub recebe valores dedicados. A busca encontra folhas pelo
   nome da sub ou da mãe. */

// header=true → linha de título da categoria-mãe (não selecionável)
interface Opcao { cat: string; sub: string | null; header?: boolean }

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
      if (c.subs.length === 0) {
        base.push({ cat: c.nome, sub: null }); // folha: categoria sem sub (escolhível)
      } else {
        base.push({ cat: c.nome, sub: null, header: true }); // cabeçalho (não escolhível)
        for (const s of c.subs) base.push({ cat: c.nome, sub: s.nome }); // folhas escolhíveis
      }
    }
    if (!t) return base;
    // filtra pelas FOLHAS que casam; mantém o cabeçalho só se sobrar alguma folha sua
    const folhaCasa = (o: Opcao) =>
      o.cat === ""
        ? "sem categoria".includes(t)
        : semAcento(o.sub ? `${o.cat} ${o.sub}` : o.cat).toLowerCase().includes(t);
    const comFilhoVisivel = new Set<string>();
    for (const o of base) if (!o.header && o.sub && folhaCasa(o)) comFilhoVisivel.add(o.cat);
    return base.filter((o) => {
      if (o.header) return comFilhoVisivel.has(o.cat);
      return folhaCasa(o);
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
  function escolher(o: Opcao) { if (o.header) return; onSelect(o.cat, o.sub); fechar(); }

  // próximo índice escolhível (pula cabeçalhos) a partir de `de`, na direção `dir`
  function proximoSelec(de: number, dir: 1 | -1): number {
    let i = de;
    while (i >= 0 && i < lista.length) {
      if (!lista[i]?.header) return i;
      i += dir;
    }
    return de;
  }

  function abrir() {
    const idx = lista.findIndex((o) => !o.header && o.cat === value && (o.sub || null) === (subValue || null));
    setHi(idx > 0 ? idx : proximoSelec(0, 1));
    setAberto(true);
  }

  function onKey(e: ReactKeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => proximoSelec(Math.min(h + 1, lista.length - 1), 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => proximoSelec(Math.max(h - 1, 0), -1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (lista[hi] && !lista[hi].header) escolher(lista[hi]); }
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
        className={`tap select-chev relative inline-flex items-center gap-[7px] bg-card text-txt border border-line rounded-[8px] cursor-pointer outline-none focus-visible:border-muted hover:border-muted/70 transition-colors ${pad} ${className}`}
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
                // cabeçalho da categoria-mãe (que tem subs): rótulo, não escolhível
                if (o.header) {
                  return (
                    <div
                      key={`h//${o.cat}`}
                      className="flex items-center gap-[9px] px-2 pt-[8px] pb-[3px] text-[11px] text-muted uppercase tracking-[.04em] font-semibold"
                    >
                      <span className="w-[8px] h-[8px] rounded-full shrink-0" style={{ background: corCategoria(o.cat) }} />
                      <span className="truncate">{o.cat}</span>
                    </div>
                  );
                }
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
