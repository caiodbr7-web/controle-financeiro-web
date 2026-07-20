import { useMemo, useState, useCallback, type ReactNode } from "react";
import type { Lancamento } from "../types";
import { Legenda } from "./ui";
import { kBRL, dvLabel, dvParcialLimite } from "../lib/finance";
import {
  type MatrizMensal as Matriz, type SecaoInfo, type LinhaMatriz,
  lancamentosDaCelula,
} from "../lib/matrizMensal";
import { HUE_SECAO, tintSequencial, tintDivergente } from "../lib/colorScale";

interface Props { dados: Lancamento[]; matriz: Matriz; openModal: (titulo: string, linhas: Lancamento[]) => void; }

// Ordenação: 1 sort GLOBAL (clique no cabeçalho, aplica a todas as seções) +
// 1 ordem MANUAL por seção (arraste). Sort tem precedência; arrastar zera o sort.
interface Sort { col: string | null; dir: "asc" | "desc"; }
const SORT_VAZIO: Sort = { col: null, dir: "asc" };

const LS_SORT = "cf-matriz:sort";
const lsOrdem = (secao: string) => `cf-matriz:order:${secao}`;

function carregaSort(): Sort {
  try {
    const o = JSON.parse(localStorage.getItem(LS_SORT) || "null");
    if (!o) return { ...SORT_VAZIO };
    return { col: typeof o.col === "string" ? o.col : null, dir: o.dir === "desc" ? "desc" : "asc" };
  } catch { return { ...SORT_VAZIO }; }
}
function carregaOrdem(secao: string): string[] {
  try {
    const o = JSON.parse(localStorage.getItem(lsOrdem(secao)) || "null");
    return Array.isArray(o) ? o : [];
  } catch { return []; }
}
function salva(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ls indisponível */ }
}

// valor de uma linha na coluna ordenável (label = string; resto = número)
function valorCol(ln: LinhaMatriz, col: string): number | string {
  if (col === "label") return ln.label;
  if (col === "delta") return ln.delta;
  if (col === "deltaPct") return ln.deltaPct ?? -Infinity; // null vai pro fim no asc
  return ln.valores[col] || 0; // col = mesKey
}

// ordena as linhas de categoria: sort global, senão ordem manual, senão padrão.
function aplicaOrdem(linhas: LinhaMatriz[], sort: Sort, manual: string[]): LinhaMatriz[] {
  if (sort.col) {
    const col = sort.col, dir = sort.dir === "asc" ? 1 : -1;
    return [...linhas].sort((a, b) => {
      const va = valorCol(a, col), vb = valorCol(b, col);
      if (typeof va === "string" || typeof vb === "string") return String(va).localeCompare(String(vb), "pt-BR") * dir;
      return (va - vb) * dir;
    });
  }
  if (manual.length) {
    const pos = new Map(manual.map((k, i) => [k, i] as const));
    return [...linhas].sort((a, b) => (pos.get(a.key) ?? Infinity) - (pos.get(b.key) ?? Infinity));
  }
  return linhas;
}

export function MatrizMensal({ dados, matriz, openModal }: Props) {
  const { meses, secoes, saldo } = matriz;

  const [sort, setSort] = useState<Sort>(carregaSort);
  const [ordens, setOrdens] = useState<Record<string, string[]>>(() => {
    const o: Record<string, string[]> = {};
    for (const s of secoes) o[s.secao] = carregaOrdem(s.secao);
    return o;
  });
  const [arrastando, setArrastando] = useState<{ secao: string; key: string } | null>(null);

  const limParcial = useMemo(() => dvParcialLimite(), []);
  const ultimoMes = meses[meses.length - 1];

  // clique no cabeçalho: ativa a coluna (num=desc, nome=asc) ou inverte a direção.
  const clicaCol = useCallback((col: string) => {
    setSort((s) => {
      const next: Sort = s.col === col
        ? { col, dir: s.dir === "asc" ? "desc" : "asc" }
        : { col, dir: col === "label" ? "asc" : "desc" };
      salva(LS_SORT, next);
      return next;
    });
  }, []);

  // drop: reordena dentro da seção e zera o sort global (mostra a ordem manual).
  const solta = useCallback((secao: string, linhasExibidas: LinhaMatriz[], destinoKey: string) => {
    setArrastando((arr) => {
      if (!arr || arr.secao !== secao || arr.key === destinoKey) return null;
      const keys = linhasExibidas.map((l) => l.key);
      const from = keys.indexOf(arr.key), to = keys.indexOf(destinoKey);
      if (from < 0 || to < 0) return null;
      keys.splice(to, 0, keys.splice(from, 1)[0]);
      setOrdens((prev) => { salva(lsOrdem(secao), keys); return { ...prev, [secao]: keys }; });
      setSort((s) => { if (!s.col) return s; const n = { ...SORT_VAZIO }; salva(LS_SORT, n); return n; });
      return null;
    });
  }, []);

  // volta tudo à ordem padrão (limpa sort + todas as ordens manuais).
  const resetar = useCallback(() => {
    setSort(() => { salva(LS_SORT, SORT_VAZIO); return { ...SORT_VAZIO }; });
    setOrdens((prev) => {
      const o: Record<string, string[]> = {};
      for (const s of Object.keys(prev)) { salva(lsOrdem(s), []); o[s] = []; }
      return o;
    });
  }, []);

  const customizado = !!sort.col || Object.values(ordens).some((a) => a.length > 0);

  if (!meses.length) return <div className="text-muted">Sem dados.</div>;

  const nCols = 1 + meses.length + 2; // categoria + meses + Δ + %Δ
  const ind = (col: string) => (sort.col === col ? (sort.dir === "asc" ? " ▲" : " ▼") : "");
  // <th> clicável de ordenação
  const Th = ({ col, label, title }: { col: string; label: string; title: string }) => (
    <th
      className={`num cursor-pointer select-none whitespace-nowrap hover:text-txt transition-colors sticky top-0 z-20 bg-card ${sort.col === col ? "text-txt" : ""}`}
      title={title}
      onClick={() => clicaCol(col)}
    >
      {label}{ind(col)}
    </th>
  );

  return (
    <div className="overflow-auto scroll-thin max-h-[calc(100vh-180px)]">
      {/* min-w garante rolagem horizontal limpa (células não “esmagam”) no mobile;
          a 1ª coluna (categoria) fica fixa à esquerda ao rolar. */}
      <table className="tbl min-w-[680px]">
        <thead>
          <tr>
            <th
              className={`cursor-pointer select-none hover:text-txt transition-colors sticky top-0 left-0 z-30 bg-card ${sort.col === "label" ? "text-txt" : ""}`}
              title="ordenar por nome"
              onClick={() => clicaCol("label")}
            >
              Categoria{ind("label")}
            </th>
            {meses.map((mk) => (
              <Th key={mk} col={mk} label={`${dvLabel(mk)}${mk >= limParcial ? " *" : ""}`} title={`ordenar por ${dvLabel(mk)}`} />
            ))}
            <Th col="delta" label="Δ" title="variação do último mês vs. o anterior" />
            <Th col="deltaPct" label="%Δ" title="variação % do último mês vs. o anterior" />
          </tr>
        </thead>
        <tbody>
          {secoes.map((sec) => {
            const linhas = aplicaOrdem(sec.linhas, sort, ordens[sec.secao] || []);
            return (
              <BlocoSecao
                key={sec.secao}
                sec={sec}
                linhas={linhas}
                meses={meses}
                nCols={nCols}
                dados={dados}
                openModal={openModal}
                onDragStart={(key) => setArrastando({ secao: sec.secao, key })}
                onDrop={(destinoKey) => solta(sec.secao, linhas, destinoKey)}
                // Saldo entra logo após a seção de Gastos (como na planilha).
                rodape={sec.secao === "gasto"
                  ? <LinhaSaldo saldo={saldo} meses={meses} ultimoMes={ultimoMes} dados={dados} openModal={openModal} />
                  : null}
              />
            );
          })}
        </tbody>
      </table>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted text-[12px] mt-2">
        <Legenda>
          Clique no cabeçalho para <b>ordenar</b>; arraste pelo punho <b>⠿</b> para reordenar à mão. Células com valor abrem o <b>detalhamento</b> dos lançamentos daquele mês.
        </Legenda>
        {customizado && (
          <button className="text-accent hover:underline cursor-pointer" onClick={resetar} title="voltar à ordem padrão">
            ↺ ordem padrão
          </button>
        )}
      </div>
    </div>
  );
}

// ---- bloco de uma seção: faixa de título + linhas de categoria + total ----
interface BlocoProps {
  sec: SecaoInfo;
  linhas: LinhaMatriz[];
  meses: string[];
  nCols: number;
  dados: Lancamento[];
  openModal: (t: string, r: Lancamento[]) => void;
  onDragStart: (key: string) => void;
  onDrop: (destinoKey: string) => void;
  rodape?: ReactNode;
}

function BlocoSecao({ sec, linhas, meses, nCols, dados, openModal, onDragStart, onDrop, rodape }: BlocoProps) {
  const hue = HUE_SECAO[sec.secao];
  return (
    <>
      {/* faixa de cabeçalho da seção */}
      <tr className="bg-fill">
        <td colSpan={nCols} className="font-semibold uppercase tracking-[0.04em] text-[12px] text-muted">
          <span className="sticky left-0 inline-block">{sec.titulo}</span>
        </td>
      </tr>

      {/* linhas de categoria (arrastáveis) */}
      {linhas.map((ln) => (
        <tr
          key={ln.key}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); onDrop(ln.key); }}
        >
          <td className="sticky left-0 z-10 bg-card">
            <span className="inline-flex items-center gap-2 min-w-0">
              <span
                draggable
                onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; onDragStart(ln.key); }}
                className="text-muted/70 cursor-grab active:cursor-grabbing select-none"
                title="arraste para reordenar"
              >⠿</span>
              {ln.cor && <span className="w-[10px] h-[10px] rounded-full shrink-0" style={{ background: ln.cor }} />}
              <span className="truncate">{ln.label}</span>
            </span>
          </td>
          {meses.map((mk) => {
            const v = ln.valores[mk] || 0;
            return (
              <td
                key={mk}
                className={`num cursor-pointer ${v === 0 ? "text-muted" : ""}`}
                style={{ background: tintSequencial(v, sec.maxAbs, hue) }}
                onClick={() => openModal(`${ln.label} · ${dvLabel(mk)}`, lancamentosDaCelula(dados, ln.secao, ln.catRaw, mk))}
              >
                {v === 0 ? "—" : kBRL(v)}
              </td>
            );
          })}
          <CelulaDelta delta={ln.delta} maxDeltaAbs={sec.maxDeltaAbs} bomQuandoSobe={sec.bomQuandoSobe} />
          <CelulaPct deltaPct={ln.deltaPct} bomQuandoSobe={sec.bomQuandoSobe} />
        </tr>
      ))}

      {/* total da seção */}
      <tr className="font-semibold">
        <td className="sticky left-0 z-10 bg-card">{sec.totalLinha.label}</td>
        {meses.map((mk) => {
          const v = sec.totalLinha.valores[mk] || 0;
          return (
            <td
              key={mk}
              className={`num cursor-pointer ${v === 0 ? "text-muted" : ""}`}
              onClick={() => openModal(`${sec.totalLinha.label} · ${dvLabel(mk)}`, lancamentosDaCelula(dados, sec.secao, null, mk))}
            >
              {v === 0 ? "—" : kBRL(v)}
            </td>
          );
        })}
        <CelulaDelta delta={sec.totalLinha.delta} maxDeltaAbs={sec.maxDeltaAbs} bomQuandoSobe={sec.bomQuandoSobe} />
        <CelulaPct deltaPct={sec.totalLinha.deltaPct} bomQuandoSobe={sec.bomQuandoSobe} />
      </tr>

      {rodape}
    </>
  );
}

// ---- linha de Saldo (Receita − Gastos por mês) ----
function LinhaSaldo({
  saldo, meses, ultimoMes, dados, openModal,
}: { saldo: LinhaMatriz; meses: string[]; ultimoMes: string; dados: Lancamento[]; openModal: (t: string, r: Lancamento[]) => void }) {
  const maxAbs = meses.reduce((m, k) => Math.max(m, Math.abs(saldo.valores[k] || 0)), 0);
  const vUltimo = saldo.valores[ultimoMes] || 0;
  return (
    <tr className="font-semibold border-t-2 border-line">
      <td className={`sticky left-0 z-10 bg-card ${vUltimo >= 0 ? "text-green" : "text-red"}`}>{saldo.label}</td>
      {meses.map((mk) => {
        const v = saldo.valores[mk] || 0;
        return (
          <td
            key={mk}
            className={`num cursor-pointer ${v === 0 ? "text-muted" : v > 0 ? "text-green" : "text-red"}`}
            style={{ background: tintSequencial(v, maxAbs, HUE_SECAO.saldo) }}
            onClick={() => openModal(`${saldo.label} · ${dvLabel(mk)}`, lancamentosDaCelula(dados, "saldo", null, mk))}
          >
            {v === 0 ? "—" : kBRL(v)}
          </td>
        );
      })}
      <CelulaDelta delta={saldo.delta} maxDeltaAbs={Math.abs(saldo.delta)} bomQuandoSobe />
      <CelulaPct deltaPct={saldo.deltaPct} bomQuandoSobe />
    </tr>
  );
}

// ---- célula Δ: valor com sinal + tint divergente ----
function CelulaDelta({ delta, maxDeltaAbs, bomQuandoSobe }: { delta: number; maxDeltaAbs: number; bomQuandoSobe: boolean }) {
  return (
    <td className="num text-muted" style={{ background: tintDivergente(delta, maxDeltaAbs, { bomQuandoSobe }) }}>
      {delta === 0 ? "—" : (delta > 0 ? "+" : "") + kBRL(delta)}
    </td>
  );
}

// ---- célula %Δ: cor do texto conforme bom/ruim, sem fundo ----
function CelulaPct({ deltaPct, bomQuandoSobe }: { deltaPct: number | null; bomQuandoSobe: boolean }) {
  if (deltaPct == null) return <td className="num text-muted">—</td>;
  if (deltaPct === 0) return <td className="num text-muted">0%</td>;
  const ehBom = deltaPct > 0 === bomQuandoSobe;
  return (
    <td className={`num ${ehBom ? "text-green" : "text-red"}`}>
      {(deltaPct > 0 ? "+" : "-") + Math.abs(deltaPct).toFixed(0) + "%"}
    </td>
  );
}
