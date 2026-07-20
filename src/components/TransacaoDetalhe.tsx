import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Lancamento } from "../types";
import { BRL, corCategoria, dataCompleta, fmtMoeda } from "../lib/finance";
import { ehInterna } from "../lib/lancClasses";
import { CategoryPicker } from "./CategoryPicker";

/* ---------- detalhe de UMA transação (pop-up unificado) ----------
   Visão única usada em TODO o app: qualquer lugar que liste transações
   (Modal de drill-down, Lançamentos, tabelas) abre este pop-up ao clicar
   numa transação. Mostra todos os campos e permite corrigir a categoria
   na hora (via callback de quem abriu — cada tela persiste do seu jeito).
   Abre POR CIMA do Modal de drill-down (z maior), então dá pra navegar
   número → lista → transação sem perder o contexto. */

interface Props {
  transacao: Lancamento | null;
  onClose: () => void;
  // corrigir categoria a partir do detalhe (opcional — sem ele, é só leitura)
  onCategoria?: (d: Lancamento, categoria: string, sub?: string | null) => void;
  salvando?: string; // feedback "salvando…" / "✓" vindo de quem persiste
}

function Linha({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-[7px] border-b border-line/60 last:border-0">
      <div className="text-[12px] text-muted shrink-0 pt-[2px]">{rotulo}</div>
      <div className="text-[13px] text-right min-w-0">{children}</div>
    </div>
  );
}

export function TransacaoDetalhe({ transacao: d, onClose, onCategoria, salvando }: Props) {
  useEffect(() => {
    if (!d) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", h, true); // capture: fecha este antes do Modal de trás
    return () => document.removeEventListener("keydown", h, true);
  }, [d, onClose]);

  if (!d) return null;

  const catEfetiva = d.categoria_manual || d.categoria_auto || "";
  const internacional = d.moeda_origem && d.valor_origem != null && d.moeda_origem !== (d.moeda || "BRL");

  return createPortal(
    <div
      className="fixed inset-0 bg-black/45 backdrop-blur-[6px] z-[85] flex items-end sm:items-center justify-center sm:p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-card border border-line rounded-t-[18px] sm:rounded-[18px] w-full sm:max-w-[480px] max-h-[86vh] flex flex-col shadow-modal fade-in">
        {/* cabeçalho: valor em destaque + descrição */}
        <div className="px-5 pt-4 pb-3 border-b border-line">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className={`font-display text-[22px] font-bold tabular-nums tracking-tight ${d.valor < 0 ? "text-red" : "text-green"}`}>
                {BRL(d.valor)}
              </div>
              {internacional && (
                <div className="text-[11.5px] text-muted mt-[1px]">
                  {fmtMoeda(d.valor_origem as number, d.moeda_origem as string)} na moeda original
                </div>
              )}
            </div>
            <button
              onClick={onClose}
              aria-label="Fechar"
              className="tap w-[28px] h-[28px] rounded-full bg-fill text-muted hover:text-txt border-0 cursor-pointer flex items-center justify-center text-[12px] shrink-0"
            >✕</button>
          </div>
          <div className="text-[13.5px] font-medium mt-[6px] break-words">{d.descricao}</div>
          {d.detalhe && d.detalhe !== d.descricao && (
            <div className="text-[12px] text-muted mt-[2px] break-words">{d.detalhe}</div>
          )}
        </div>

        <div className="px-5 py-3 overflow-auto scroll-thin">
          <Linha rotulo="Data">{dataCompleta(d)}</Linha>
          <Linha rotulo="Competência">{d.competencia}</Linha>
          <Linha rotulo="Origem">{d.origem}{d.banco && d.banco !== d.origem ? ` · ${d.banco}` : ""}</Linha>
          <Linha rotulo="Classe">
            <span className="inline-flex items-center gap-[6px] flex-wrap justify-end">
              {d.classe || "—"}
              {d.subtipo && <span className="text-muted text-[11.5px]">· {d.subtipo}</span>}
              {ehInterna(d) && (
                <span className="inline-flex items-center rounded-full bg-violet/15 text-violet px-[7px] py-[1px] text-[10.5px] font-semibold">⇄ entre contas próprias</span>
              )}
            </span>
          </Linha>
          <Linha rotulo="Categoria">
            {onCategoria ? (
              <span className="inline-flex items-center gap-[6px]">
                {salvando && <span className="text-muted text-[11px]">{salvando}</span>}
                <CategoryPicker
                  value={catEfetiva}
                  subValue={d.categoria_manual ? d.subcategoria_manual || null : null}
                  onSelect={(c, s) => onCategoria(d, c, s)}
                />
              </span>
            ) : catEfetiva ? (
              <span className="inline-flex items-center gap-[7px]">
                <span className="w-[8px] h-[8px] rounded-full shrink-0" style={{ background: corCategoria(catEfetiva) }} />
                {catEfetiva}{d.subcategoria_manual ? ` › ${d.subcategoria_manual}` : ""}
              </span>
            ) : <span className="text-muted">Sem categoria</span>}
          </Linha>
          {d.natureza && <Linha rotulo="Natureza">{d.natureza}</Linha>}
          <Linha rotulo="Fonte">
            {d.fonte_dados === "pluggy" || d.pluggy_tx_id ? "Open Finance (automático)" : "Fatura/extrato importado"}
          </Linha>
        </div>
      </div>
    </div>,
    document.body
  );
}
