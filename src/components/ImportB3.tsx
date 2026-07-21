import { useEffect, useMemo, useState } from "react";
import type { ArquivoB3, PontoB3 } from "../lib/b3Hist";
import { parseB3Xlsx, salvarPontosB3 } from "../lib/b3Hist";
import { BRL0 } from "../lib/finance";

/* Modal "Importar histórico (B3)": recebe os relatórios consolidados (mensais/
   anuais, .xlsx) da Área do Investidor da B3, mostra o que foi entendido de
   cada arquivo (competência + total por categoria) e grava um ponto por mês no
   histórico de investimentos. Também aceita um ponto digitado à mão (p/ anos em
   que a B3 só deu PDF). */

// rótulos das categorias usadas no import (mesmas chaves do app)
const CATS_B3: { v: string; label: string }[] = [
  { v: "FIXED_INCOME", label: "Renda Fixa" },
  { v: "EQUITY", label: "Ações" },
  { v: "ETF", label: "ETF" },
  { v: "REAL_ESTATE", label: "Imobiliário" },
  { v: "OUTROS", label: "Outros" },
];
const catLabel = (v: string) => CATS_B3.find((c) => c.v === v)?.label ?? v;

interface Arq extends ArquivoB3 { id: number }

export function ImportB3({ onClose, onDone }: { onClose: () => void; onDone: () => void | Promise<void> }) {
  const [arquivos, setArquivos] = useState<Arq[]>([]);
  const [lendo, setLendo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  // ponto manual (p/ relatórios só em PDF): mês + valor por categoria
  const [manualMes, setManualMes] = useState("");
  const [manualVals, setManualVals] = useState<Record<string, string>>({});

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  const mesAtualK = new Date().toISOString().slice(0, 7);

  async function addFiles(list: FileList | null) {
    if (!list?.length) return;
    setErr(""); setOk(""); setLendo(true);
    try {
      const novos: Arq[] = [];
      for (const f of Array.from(list)) {
        try {
          novos.push({ ...(await parseB3Xlsx(f)), id: Date.now() + Math.random() });
        } catch (e) {
          novos.push({ id: Date.now() + Math.random(), nome: f.name, mk: null, categorias: {}, total: 0, posicoes: 0, avisos: ["Falha ao ler: " + (e as Error).message] });
        }
      }
      setArquivos((cur) => [...cur, ...novos]);
    } finally {
      setLendo(false);
    }
  }

  const setMk = (id: number, mk: string) =>
    setArquivos((cur) => cur.map((a) => (a.id === id ? { ...a, mk: mk || null } : a)));
  const remover = (id: number) => setArquivos((cur) => cur.filter((a) => a.id !== id));

  // "5.472,16" e "5472.16" valem o mesmo: com vírgula, pontos são milhar
  const num = (s: string) => {
    let t = (s || "").trim();
    if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
    const n = parseFloat(t);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const manualTotal = CATS_B3.reduce((s, c) => s + num(manualVals[c.v] || ""), 0);
  const manualPronto = !!manualMes && manualMes < mesAtualK && manualTotal > 0;

  // pontos prontos p/ gravar: arquivos válidos (mês fechado + valor) + o manual.
  // Dois arquivos do MESMO mês: o último da lista vence (aviso na linha).
  const pontos = useMemo<PontoB3[]>(() => {
    const porMes = new Map<string, PontoB3>();
    for (const a of arquivos) {
      if (!a.mk || a.mk >= mesAtualK || a.total <= 0) continue;
      porMes.set(a.mk, { mk: a.mk, categorias: a.categorias });
    }
    if (manualPronto) {
      const categorias: PontoB3["categorias"] = {};
      for (const c of CATS_B3) { const v = num(manualVals[c.v] || ""); if (v > 0) categorias[c.v] = { valor: v, posicoes: 0 }; }
      porMes.set(manualMes, { mk: manualMes, categorias });
    }
    return [...porMes.values()].sort((a, b) => a.mk.localeCompare(b.mk));
  }, [arquivos, manualPronto, manualMes, manualVals, mesAtualK]);

  const duplicados = useMemo(() => {
    const vistos = new Map<string, number>();
    for (const a of arquivos) if (a.mk) vistos.set(a.mk, (vistos.get(a.mk) || 0) + 1);
    return new Set([...vistos.entries()].filter(([, n]) => n > 1).map(([mk]) => mk));
  }, [arquivos]);

  async function importar() {
    setErr(""); setOk(""); setSalvando(true);
    try {
      await salvarPontosB3(pontos);
      setOk(`✓ ${pontos.length} ${pontos.length === 1 ? "mês importado" : "meses importados"}.`);
      await onDone();
      setArquivos([]); setManualMes(""); setManualVals({});
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  const statusDe = (a: Arq): { txt: string; ruim?: boolean } => {
    if (!a.mk) return { txt: "informe o mês →", ruim: true };
    if (a.mk >= mesAtualK) return { txt: "mês em andamento — ignorado", ruim: true };
    if (a.total <= 0) return { txt: "sem posições — ignorado", ruim: true };
    if (duplicados.has(a.mk)) return { txt: "mês repetido — o último vence" };
    return { txt: "pronto" };
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-[6px] flex items-center justify-center z-50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-card border border-line rounded-[20px] max-w-[760px] w-full max-h-[90vh] flex flex-col shadow-modal fade-in">
        <div className="flex justify-between items-start gap-3 p-5 border-b border-line">
          <div>
            <h3 className="text-[16px] font-semibold tracking-tight">Importar histórico (B3)</h3>
            <div className="text-muted text-[12px] mt-[2px]">
              Relatórios consolidados (mensais/anuais, <b>.xlsx</b>) da <b>Área do Investidor</b> — vira um ponto por mês na evolução.
            </div>
          </div>
          <button onClick={onClose} aria-label="Fechar" className="w-[30px] h-[30px] rounded-full bg-fill text-muted hover:text-txt border-0 cursor-pointer flex items-center justify-center text-[13px] shrink-0 transition-colors">✕</button>
        </div>

        <div className="p-5 overflow-auto scroll-thin flex flex-col gap-4">
          <label className="border border-dashed border-line rounded-[14px] px-4 py-6 text-center cursor-pointer hover:border-accent transition-colors block">
            <input type="file" multiple accept=".xlsx" className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
            <div className="text-[13.5px] font-medium">{lendo ? "Lendo arquivos…" : "Clique para escolher os relatórios (.xlsx)"}</div>
            <div className="text-muted text-[12px] mt-1">
              investidor.b3.com.br → Relatórios → Consolidado mensal/anual → baixar em Excel. Pode selecionar vários de uma vez.
            </div>
          </label>

          {arquivos.length > 0 && (
            <div className="flex flex-col divide-y divide-line border border-line rounded-[12px] px-3">
              {arquivos.map((a) => {
                const st = statusDe(a);
                return (
                  <div key={a.id} className="py-[10px] flex flex-wrap items-center gap-x-3 gap-y-1">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium truncate" title={a.nome}>{a.nome}</div>
                      <div className="text-muted text-[11.5px] truncate">
                        {a.total > 0
                          ? <>{BRL0(a.total)} · {Object.entries(a.categorias).map(([c, v]) => `${catLabel(c)} ${BRL0(v.valor)}`).join(" · ")}</>
                          : "nada extraído"}
                        {a.avisos.map((w, i) => <span key={i} className="text-amber"> · {w}</span>)}
                      </div>
                    </div>
                    <input
                      type="month"
                      value={a.mk ?? ""}
                      onChange={(e) => setMk(a.id, e.target.value)}
                      className="input !py-[5px] !px-2 !text-[12.5px] w-[130px]"
                      title="Mês da posição (fim do mês)"
                    />
                    <span className={`text-[11.5px] whitespace-nowrap ${st.ruim ? "text-amber" : "text-green"}`}>{st.txt}</span>
                    <button onClick={() => remover(a.id)} title="Remover" className="tap w-[24px] h-[24px] rounded-[7px] bg-fill text-muted hover:text-red border-0 cursor-pointer text-[11px] transition-colors">✕</button>
                  </div>
                );
              })}
            </div>
          )}

          {/* ponto manual: p/ anos em que o relatório só veio em PDF */}
          <details className="border border-line rounded-[12px] px-4 py-3">
            <summary className="text-[13px] font-medium cursor-pointer select-none">Adicionar um mês digitado à mão <span className="text-muted font-normal">(relatório só em PDF? digite os totais)</span></summary>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[11.5px] text-muted font-medium">Mês</span>
                <input type="month" value={manualMes} onChange={(e) => setManualMes(e.target.value)} className="input !py-[6px] w-[140px]" />
              </label>
              {CATS_B3.map((c) => (
                <label key={c.v} className="flex flex-col gap-1">
                  <span className="text-[11.5px] text-muted font-medium">{c.label} (R$)</span>
                  <input
                    inputMode="decimal"
                    value={manualVals[c.v] || ""}
                    onChange={(e) => setManualVals((m) => ({ ...m, [c.v]: e.target.value }))}
                    placeholder="0"
                    className="input !py-[6px] w-[110px]"
                  />
                </label>
              ))}
              {manualTotal > 0 && <span className="text-[12px] text-muted pb-[8px]">= {BRL0(manualTotal)}</span>}
            </div>
          </details>

          <div className="text-[11.5px] text-muted leading-relaxed">
            Cobre o que estava <b>custodiado na B3</b> (ações, FIIs, ETFs, Tesouro, CDB/CRA…) — fundos não listados, previdência e
            exterior não aparecem nos relatórios. Meses já existentes no histórico são <b>substituídos</b>; o mês em andamento é
            ignorado (o app já o registra a cada sincronização).
          </div>

          {err && <div className="text-[13px] text-red bg-fill rounded-[10px] px-3 py-2">{err}</div>}
          {ok && <div className="text-[13px] text-txt bg-fill rounded-[10px] px-3 py-2">{ok}</div>}
        </div>

        <div className="flex justify-between items-center gap-2 p-5 border-t border-line">
          <span className="text-[12.5px] text-muted">
            {pontos.length > 0
              ? <>{pontos.length} {pontos.length === 1 ? "mês pronto" : "meses prontos"} · {pontos[0].mk.replace("-", "/")} — {pontos[pontos.length - 1].mk.replace("-", "/")}</>
              : "nenhum mês pronto ainda"}
          </span>
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={onClose} disabled={salvando}>Fechar</button>
            <button
              onClick={importar}
              disabled={salvando || !pontos.length}
              className="bg-accent text-onaccent border-0 rounded-[10px] px-4 py-[9px] text-[13.5px] font-semibold cursor-pointer disabled:opacity-50 hover:opacity-90 transition-opacity"
            >
              {salvando ? "Importando…" : `Importar ${pontos.length || ""} ${pontos.length === 1 ? "mês" : "meses"}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
