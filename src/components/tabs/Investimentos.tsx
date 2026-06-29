import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, PieChart, Pie, Cell,
} from "recharts";
import type { Investimento, InvestimentoHist, InvestimentoHistTipo } from "../../types";
import { Kpi, Panel, Select, BarRow } from "../ui";
import { useChart, ChartTip } from "../../lib/theme";
import {
  listInvestments, listInvestmentHistory, listInvestmentHistoryByTipo, syncInvestments,
  setTipoManual, setLiquidezD1Manual,
  addManualInvestment, updateManualInvestment, deleteManualInvestment, setInvestmentCotacao, fetchCotacoes,
  listSaldoCaixa,
  getIbkrCredencial, saveIbkrCredencial, deleteIbkrCredencial, importIbkr,
} from "../../lib/pluggy";
import type { ManualInvestmentInput, SaldoConta, IbkrCredencial } from "../../lib/pluggy";
import { BRL, BRL0, brlShort, fmtMoeda } from "../../lib/finance";
import { bancoCanonico } from "../../lib/bancos";

/* ============================================================================
   Aba "Investimentos" — patrimônio investido via Open Finance (Pluggy).

   Lê public.pluggy_investments (posição atual por ativo) e
   public.pluggy_investments_hist (retrato diário, p/ a evolução), populadas
   pela Edge Function `pluggy-investments`. O botão "Sincronizar" chama a função.

   Permite ao usuário CLASSIFICAR o tipo de cada ativo (coluna tipo_manual), que
   sobrepõe o tipo vindo da Pluggy para a sua visualização (KPIs/gráficos/tabela).
   ============================================================================ */

// rótulos amigáveis para os tipos (Pluggy + classes manuais extras)
const TIPO_LABEL: Record<string, string> = {
  FIXED_INCOME: "Renda Fixa",
  MUTUAL_FUND: "Fundos",
  SECURITY: "Títulos",
  EQUITY: "Ações",
  STOCK: "Ações",
  ETF: "ETF",
  ETF_US: "ETF - US",
  DEBENTURE: "Debêntures",
  COE: "COE",
  PENSION: "Previdência",
  REAL_ESTATE: "Imobiliário",
  CRYPTO: "Cripto",
  OUTROS: "Outros",
};
const labelTipo = (t?: string | null) => (t ? TIPO_LABEL[t] ?? t : "Outros");

// tipo "efetivo": a classificação manual vence a da Pluggy
const tipoEf = (i: Investimento) => i.tipo_manual ?? i.tipo ?? "";

// Heurística de liquidez D+1 (resgate com o dinheiro disponível em ~1 dia útil),
// usada quando o usuário não fez override manual. Conservadora: só marca "Sim"
// quando há sinal claro de liquidez imediata; o resto fica "Não" (o usuário ajusta
// na coluna "Liquidez D+1"). Tesouro Selic, CDB liquidez diária, fundos DI e
// cripto -> Sim; renda fixa com vencimento, ações/ETF (D+2), previdência,
// debêntures e COE -> Não.
function liquidezD1Auto(i: Investimento): boolean {
  const t = tipoEf(i);
  const blob = `${i.nome ?? ""} ${i.subtipo ?? ""} ${i.taxa ?? ""}`.toLowerCase();
  if (/liquidez\s*di[aá]ria|resgate\s*di[aá]rio|d\s*\+\s*[01]\b/.test(blob)) return true; // sinal explícito
  if (/tesouro\s*selic|\blft\b|\bselic\b/.test(blob)) return true;                        // pós-fixado do Tesouro
  if (/caixinha|cofrinho|conta\s*remunerada|carteira/.test(blob)) return true;            // caixinha/conta remunerada
  if (t === "CRYPTO") return true;                                                        // cripto: liquidez imediata
  if (t === "MUTUAL_FUND" && /\bdi\b|referenciado|renda\s*fixa\s*simples/.test(blob)) return true; // fundo DI
  return false;
}
// liquidez D+1 "efetiva": o override manual vence a heurística
const liquidezD1Ef = (i: Investimento) => i.liquidez_d1_manual ?? liquidezD1Auto(i);

// posição em moeda estrangeira (manual com ticker ou IBKR, ex.: VT em US$): a
// tabela mostra o valor NATIVO (quantidade × preço); `saldo` segue em BRL.
const temCotacaoNativa = (i: Investimento) =>
  !!(i.moeda_cotacao && i.moeda_cotacao !== "BRL" && i.preco_unitario != null && i.quantidade != null);
const valorNativo = (i: Investimento) => (i.quantidade ?? 0) * (i.preco_unitario ?? 0);
const ehIbkr = (i: Investimento) => i.fonte === "ibkr";

// instituição "limpa": "NU FINANCEIRA S.A. - ..." -> "Nubank"; "BANCO AGIBANK S.A" -> "Banco Agibank".
function limpaInstituicao(s: string): string {
  if (/pluggy/i.test(s)) return s;               // conexão genérica: deixa como está
  const canon = bancoCanonico(s);
  if (canon) return canon;
  let t = s.split(/\s+-\s+|,/)[0];               // corta o que vem após " - " ou ","
  t = t.replace(/\bS[./]?A\.?\b.*$/i, "").replace(/\bLTDA\.?\b.*$/i, "").trim();
  return t ? t.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : s;
}
// instituição efetiva do ativo: o emissor (banco real) ou, sem ele, a conexão
const instDe = (i: Investimento) => {
  const base = i.emissor || i.banco || "";
  return base ? limpaInstituicao(base) : "—";
};

// opções do seletor de classificação manual (value = chave canônica)
const CLASSE_OPTS = [
  { v: "FIXED_INCOME", label: "Renda Fixa" },
  { v: "MUTUAL_FUND", label: "Fundos" },
  { v: "EQUITY", label: "Ações" },
  { v: "ETF", label: "ETF" },
  { v: "ETF_US", label: "ETF - US" },
  { v: "DEBENTURE", label: "Debêntures" },
  { v: "COE", label: "COE" },
  { v: "PENSION", label: "Previdência" },
  { v: "REAL_ESTATE", label: "Imobiliário" },
  { v: "CRYPTO", label: "Cripto" },
  { v: "OUTROS", label: "Outros" },
];

// paleta categórica (uma cor por tipo) — legível nos dois temas
const PALETA = ["#820ad1", "#34c98a", "#f2b84b", "#f06a6a", "#3b82f6", "#ec4899", "#14b8a6", "#a855f7"];
// cor fixa do "Caixa" (saldo líquido em conta) — cinza-azulado, destaca-se da paleta
const CAIXA_COR = "#64748b";

const cell = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
const fmtVenc = (s?: string | null) => {
  if (!s) return "—";
  const [y, m, d] = s.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : s;
};
// "YYYY-MM-DD" -> "dd/mm/aa"
const fmtDiaBR = (d: string) => {
  const [y, m, dd] = d.split("-");
  return `${dd}/${m}/${y.slice(2)}`;
};
const moedaDe = (i: Investimento) => i.moeda || "BRL";

// tooltip da área stackada: categorias (maior primeiro) + total do dia
function StackTip({ active, payload, label }: { active?: boolean; payload?: any[]; label?: any }) {
  if (!active || !payload || !payload.length) return null;
  const rows = payload
    .filter((p) => p && Number(p.value) > 0)
    .sort((a, b) => Number(b.value) - Number(a.value));
  if (!rows.length) return null;
  const total = rows.reduce((s, p) => s + Number(p.value), 0);
  return (
    <div className="rounded-[12px] border border-line bg-card/95 backdrop-blur-[8px] px-3 py-2 shadow-pop text-[12px] min-w-[180px]">
      <div className="text-muted mb-[3px]">{label != null ? fmtDiaBR(String(label)) : ""}</div>
      {rows.map((p, i) => (
        <div key={i} className="flex items-center gap-2 py-[1.5px]">
          <span className="w-[8px] h-[8px] rounded-full shrink-0" style={{ background: p.color || p.fill || "#9ca3af" }} />
          <span className="text-muted truncate max-w-[150px]">{p.name}</span>
          <span className="ml-auto font-medium tabular-nums pl-3">{BRL0(Number(p.value))}</span>
        </div>
      ))}
      <div className="flex items-center gap-2 py-[1.5px] mt-[3px] pt-[5px] border-t border-line">
        <span className="text-txt font-medium">Total</span>
        <span className="ml-auto font-semibold tabular-nums pl-3">{BRL0(total)}</span>
      </div>
    </div>
  );
}

// rótulo de uma conta de caixa: "Nubank · Conta Corrente" (sem repetir o banco)
const contaLabelCaixa = (c: SaldoConta) => {
  const banco = c.banco ? limpaInstituicao(c.banco) : "";
  const nome = c.conta_nome ?? "";
  if (banco && nome && nome.toLowerCase() !== banco.toLowerCase()) return `${banco} · ${nome}`;
  return banco || nome || "Conta";
};

// Card "Saldo conta": valor do caixa + pop-up no hover com o saldo de cada conta
// puxada do Open Finance. Mesma moldura do <Kpi>, com a tabela em camada flutuante.
function SaldoContaCard({ caixa, total }: { caixa: SaldoConta[]; total: number }) {
  const contas = [...caixa].sort((a, b) => (b.saldo ?? 0) - (a.saldo ?? 0));
  return (
    <div
      tabIndex={0}
      className="group relative bg-card border border-line rounded-[18px] p-4 sm:p-[18px] shadow-card min-w-0 text-left outline-none cursor-default hover:border-muted/60 transition-colors"
    >
      <div className="text-muted text-[12px] font-medium">Saldo conta</div>
      <div className={`text-[20px] sm:text-[24px] font-semibold mt-[6px] tracking-tight tabular-nums ${total < 0 ? "text-red" : "text-violet"}`}>
        {BRL0(total)}
      </div>
      <div className="text-[11.5px] mt-[4px] text-muted leading-snug">
        {contas.length} {contas.length === 1 ? "conta" : "contas"} · Open Finance
      </div>
      {contas.length > 0 && (
        <div className="absolute left-0 right-0 sm:right-auto top-full mt-2 z-30 sm:min-w-[280px] rounded-[12px] border border-line bg-card/95 backdrop-blur-[8px] px-3 py-2 shadow-pop text-[12px] hidden group-hover:block group-focus-within:block">
          <div className="text-muted mb-[3px]">Saldo por conta</div>
          {contas.map((c) => (
            <div key={c.account_id} className="flex items-center gap-2 py-[1.5px]">
              <span className="w-[8px] h-[8px] rounded-full shrink-0" style={{ background: CAIXA_COR }} />
              <span className="text-muted truncate max-w-[180px]">{contaLabelCaixa(c)}</span>
              <span className={`ml-auto font-medium tabular-nums pl-3 ${(c.saldo ?? 0) < 0 ? "text-red" : ""}`}>
                {fmtMoeda(c.saldo ?? 0, c.moeda || "BRL")}
              </span>
            </div>
          ))}
          <div className="flex items-center gap-2 py-[1.5px] mt-[3px] pt-[5px] border-t border-line">
            <span className="text-txt font-medium">Total</span>
            <span className="ml-auto font-semibold tabular-nums pl-3">{BRL0(total)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

interface ColDef {
  key: keyof Investimento;
  label: string;
  num?: boolean;
  mono?: boolean;
  sortable?: boolean;
  noCsv?: boolean; // coluna só-de-UI (ações) que não entra na exportação
  render?: (i: Investimento) => ReactNode;
}

function toCsv(rows: Investimento[], allCols: ColDef[]): string {
  const cols = allCols.filter((c) => !c.noCsv);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = cols.map((c) => c.label).join(";");
  const body = rows.map((i) =>
    cols
      .map((c) =>
        esc(
          c.key === "tipo_manual" ? labelTipo(tipoEf(i)) :
          c.key === "liquidez_d1_manual" ? (liquidezD1Ef(i) ? "Sim" : "Não") :
          c.key === "saldo" && temCotacaoNativa(i) ? `${valorNativo(i)} ${i.moeda_cotacao}` :
          i[c.key],
        ),
      )
      .join(";"),
  );
  return [head, ...body].join("\n");
}

const MAX = 2000;

// rótulo + campo de formulário (modal manual)
function Campo({ label, children, full }: { label: string; children: ReactNode; full?: boolean }) {
  return (
    <label className={`flex flex-col gap-1 ${full ? "sm:col-span-2" : ""}`}>
      <span className="text-[12px] text-muted font-medium">{label}</span>
      {children}
    </label>
  );
}

const inputCls = "input w-full";
const selCls = "select-chev bg-card text-txt border border-line rounded-[10px] pl-3 py-[8px] text-[13.5px] cursor-pointer outline-none focus:border-muted transition-colors w-full";

// Modal de criar/editar uma posição MANUAL (fora do Open Finance). Com `ticker`,
// o valor atual passa a ser cotado pelo mercado (ex.: VT em US$); sem ticker, o
// usuário informa o valor atual em R$.
function ManualForm({ mode, inicial, onClose, onSaved }: {
  mode: "add" | "edit";
  inicial?: Investimento | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [nome, setNome] = useState(inicial?.nome ?? "");
  const [banco, setBanco] = useState(inicial?.banco ?? "");
  const [classe, setClasse] = useState(inicial?.tipo_manual ?? "");
  const [ticker, setTicker] = useState(inicial?.ticker ?? "");
  const [moeda, setMoeda] = useState(inicial?.moeda_cotacao ?? "USD");
  const [qtd, setQtd] = useState(inicial?.quantidade != null ? String(inicial.quantidade) : "");
  const [preco, setPreco] = useState(inicial?.preco_unitario != null ? String(inicial.preco_unitario) : "");
  const [valorAtual, setValorAtual] = useState(inicial && !inicial.ticker && inicial.saldo != null ? String(inicial.saldo) : "");
  const [aplicado, setAplicado] = useState(inicial?.valor_aplicado != null ? String(inicial.valor_aplicado) : "");
  const [salvando, setSalvando] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  const temTicker = ticker.trim() !== "";
  const num = (s: string) => { const n = parseFloat(s.replace(",", ".")); return Number.isFinite(n) ? n : null; };

  async function salvar() {
    if (!nome.trim()) { setErr("Informe um nome."); return; }
    setSalvando(true); setErr("");
    try {
      const mc = temTicker && moeda !== "BRL" ? moeda : null;
      const precoNum = num(preco), qtdNum = num(qtd);
      // saldo (BRL): sem ticker = valor atual digitado; ticker em BRL com preço = qtd*preço;
      // ticker em moeda estrangeira = fica p/ a cotação calcular (mantém o anterior por ora).
      let saldo: number | null;
      if (!temTicker) saldo = num(valorAtual);
      else if (!mc && precoNum != null && qtdNum != null) saldo = precoNum * qtdNum;
      else saldo = inicial?.saldo ?? null;
      const input: ManualInvestmentInput = {
        nome: nome.trim(),
        banco: banco.trim() || null,
        tipo_manual: classe || null,
        ticker: temTicker ? ticker.trim().toUpperCase() : null,
        moeda_cotacao: mc,
        quantidade: temTicker ? qtdNum : null,
        preco_unitario: temTicker ? precoNum : null,
        valor_aplicado: num(aplicado),
        saldo,
      };
      if (mode === "add") await addManualInvestment(input);
      else await updateManualInvestment(inicial!.investment_id, input);
      await onSaved();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-[6px] flex items-center justify-center z-50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-card border border-line rounded-[20px] max-w-[560px] w-full max-h-[90vh] flex flex-col shadow-[0_20px_60px_rgba(0,0,0,.25)] fade-in">
        <div className="flex justify-between items-start gap-3 p-5 border-b border-line">
          <div>
            <h3 className="text-[16px] font-semibold tracking-tight">{mode === "add" ? "Adicionar investimento manual" : "Editar investimento manual"}</h3>
            <div className="text-muted text-[12px] mt-[2px]">Fora do Open Finance — ex.: ETF <b>VT</b> numa corretora no exterior.</div>
          </div>
          <button onClick={onClose} aria-label="Fechar" className="w-[30px] h-[30px] rounded-full bg-fill text-muted hover:text-txt border-0 cursor-pointer flex items-center justify-center text-[13px] shrink-0 transition-colors">✕</button>
        </div>

        <div className="p-5 overflow-auto scroll-thin grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Campo label="Nome*" full><input className={inputCls} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Vanguard Total World (VT)" autoFocus /></Campo>
          <Campo label="Instituição"><input className={inputCls} value={banco} onChange={(e) => setBanco(e.target.value)} placeholder="Avenue / Vanguard" /></Campo>
          <Campo label="Classe">
            <select className={selCls} value={classe} onChange={(e) => setClasse(e.target.value)}>
              <option value="">(nenhuma)</option>
              {CLASSE_OPTS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
            </select>
          </Campo>
          <Campo label="Ticker (cotação ao vivo)"><input className={inputCls} value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="VT" /></Campo>
          {temTicker ? (
            <>
              <Campo label="Moeda do ticker">
                <select className={selCls} value={moeda} onChange={(e) => setMoeda(e.target.value)}>
                  <option value="USD">USD (US$)</option>
                  <option value="BRL">BRL (R$)</option>
                </select>
              </Campo>
              <Campo label="Quantidade (cotas)"><input className={inputCls} inputMode="decimal" value={qtd} onChange={(e) => setQtd(e.target.value)} placeholder="10" /></Campo>
              <Campo label={`Preço unitário ${moeda !== "BRL" ? `(${moeda}, opcional)` : "(opcional)"}`}>
                <input className={inputCls} inputMode="decimal" value={preco} onChange={(e) => setPreco(e.target.value)} placeholder="cotado automaticamente" />
              </Campo>
            </>
          ) : (
            <Campo label="Valor atual (R$)"><input className={inputCls} inputMode="decimal" value={valorAtual} onChange={(e) => setValorAtual(e.target.value)} placeholder="10000" /></Campo>
          )}
          <Campo label="Valor aplicado (R$, opcional)"><input className={inputCls} inputMode="decimal" value={aplicado} onChange={(e) => setAplicado(e.target.value)} placeholder="quanto custou em R$" /></Campo>

          {temTicker && (
            <div className="sm:col-span-2 text-[11.5px] text-muted leading-relaxed">
              Com ticker, o <b>valor atual é cotado pelo mercado</b> (Stooq, último fechamento)
              {moeda !== "BRL" && " e convertido para R$ pelo câmbio do dia"} ao salvar e em “Atualizar cotações”.
            </div>
          )}
        </div>

        {err && <div className="text-[13px] text-red bg-fill rounded-[10px] px-3 py-2 mx-5 mb-1">{err}</div>}
        <div className="flex justify-end gap-2 p-5 border-t border-line">
          <button className="btn-ghost" onClick={onClose} disabled={salvando}>Cancelar</button>
          <button
            onClick={salvar}
            disabled={salvando}
            className="bg-accent text-white border-0 rounded-[10px] px-4 py-[9px] text-[13.5px] font-semibold cursor-pointer disabled:opacity-50 hover:opacity-90 transition-opacity"
          >
            {salvando ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Modal de conexão com a IBKR (Interactive Brokers) via Flex Web Service.
function IbkrForm({ inicial, onClose, onReload }: {
  inicial: IbkrCredencial | null;
  onClose: () => void;
  onReload: () => void | Promise<void>;
}) {
  const conectado = !!inicial;
  const [token, setToken] = useState("");
  const [queryId, setQueryId] = useState(inicial?.flex_query_id ?? "");
  const [busy, setBusy] = useState<"" | "save" | "import" | "disc">("");
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  async function salvar(comImport: boolean) {
    // ao conectar, token + query são obrigatórios; já conectado, token em branco mantém o atual
    if (!queryId.trim() || (!conectado && !token.trim())) { setErr("Informe o token e o Query ID."); return; }
    setErr(""); setInfo("");
    try {
      setBusy("save");
      await saveIbkrCredencial(token.trim() ? token : null, queryId);
      if (comImport) {
        setBusy("import");
        const r = await importIbkr();
        setInfo(`✓ ${r.posicoes} posição(ões) importada(s).${r.aviso ? " " + r.aviso : ""}`);
      } else {
        setInfo("✓ Credenciais salvas.");
      }
      await onReload();
      setToken("");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  }
  async function importar() {
    setErr(""); setInfo("");
    try {
      setBusy("import");
      const r = await importIbkr();
      setInfo(`✓ ${r.posicoes} posição(ões) importada(s).${r.aviso ? " " + r.aviso : ""}`);
      await onReload();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  }
  async function desconectar() {
    if (!window.confirm("Desconectar a IBKR? As posições já importadas continuam, mas não serão mais atualizadas.")) return;
    setErr(""); setInfo("");
    try { setBusy("disc"); await deleteIbkrCredencial(); await onReload(); onClose(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-[6px] flex items-center justify-center z-50 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-card border border-line rounded-[20px] max-w-[560px] w-full max-h-[90vh] flex flex-col shadow-[0_20px_60px_rgba(0,0,0,.25)] fade-in">
        <div className="flex justify-between items-start gap-3 p-5 border-b border-line">
          <div>
            <h3 className="text-[16px] font-semibold tracking-tight">Conectar Interactive Brokers</h3>
            <div className="text-muted text-[12px] mt-[2px]">Importa suas posições via <b>Flex Web Service</b> (somente leitura). Atualiza junto do sync automático, 2×/dia.</div>
          </div>
          <button onClick={onClose} aria-label="Fechar" className="w-[30px] h-[30px] rounded-full bg-fill text-muted hover:text-txt border-0 cursor-pointer flex items-center justify-center text-[13px] shrink-0 transition-colors">✕</button>
        </div>

        <div className="p-5 overflow-auto scroll-thin flex flex-col gap-3">
          {conectado && (
            <div className="text-[12.5px] bg-fill rounded-[10px] px-3 py-2 leading-relaxed">
              <b>Conectado.</b> Query ID <span className="font-mono">{inicial!.flex_query_id}</span>
              {inicial!.account_id && <> · conta <span className="font-mono">{inicial!.account_id}</span></>}
              {inicial!.status && <> · status: {inicial!.status}</>}
              {inicial!.last_synced_at && <> · última importação: {new Date(inicial!.last_synced_at).toLocaleString("pt-BR")}</>}
            </div>
          )}

          <div className="text-[11.5px] text-muted leading-relaxed">
            Na IBKR: <b>Client Portal → Performance &amp; Reports → Flex Queries</b>. Crie uma
            <b> Activity Flex Query</b> com a seção <b>Open Positions</b> (formato XML) e copie o
            <b> Query ID</b>; em <b>Flex Web Service Configuration</b>, ative e gere um <b>token</b>.
          </div>

          <Campo label={conectado ? "Novo token (deixe em branco p/ manter)" : "Token do Flex Web Service"}>
            <input className={inputCls} value={token} onChange={(e) => setToken(e.target.value)} placeholder="cole o token aqui" autoFocus />
          </Campo>
          <Campo label="Query ID (Open Positions)">
            <input className={inputCls} inputMode="numeric" value={queryId} onChange={(e) => setQueryId(e.target.value)} placeholder="ex.: 1234567" />
          </Campo>

          {err && <div className="text-[13px] text-red bg-fill rounded-[10px] px-3 py-2">{err}</div>}
          {info && <div className="text-[13px] text-txt bg-fill rounded-[10px] px-3 py-2">{info}</div>}
        </div>

        <div className="flex justify-between items-center gap-2 p-5 border-t border-line">
          <div>
            {conectado && <button className="btn-ghost text-red" onClick={desconectar} disabled={busy !== ""}>Desconectar</button>}
          </div>
          <div className="flex gap-2">
            {conectado && (
              <button onClick={importar} disabled={busy !== ""} className="bg-fill text-txt border border-line rounded-[10px] px-3 py-[9px] text-[13.5px] font-medium cursor-pointer hover:border-muted transition-colors disabled:opacity-50">
                {busy === "import" ? "Importando…" : "Importar agora"}
              </button>
            )}
            <button
              onClick={() => salvar(!conectado)}
              disabled={busy !== ""}
              className="bg-accent text-white border-0 rounded-[10px] px-4 py-[9px] text-[13.5px] font-semibold cursor-pointer disabled:opacity-50 hover:opacity-90 transition-opacity"
            >
              {busy === "save" ? "Salvando…" : busy === "import" ? "Importando…" : conectado ? "Salvar credenciais" : "Conectar e importar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Investimentos() {
  const cc = useChart();
  const [rows, setRows] = useState<Investimento[]>([]);
  const [hist, setHist] = useState<InvestimentoHist[]>([]);
  const [histTipo, setHistTipo] = useState<InvestimentoHistTipo[]>([]);
  const [caixa, setCaixa] = useState<SaldoConta[]>([]); // saldo das contas (Open Banking)
  const [status, setStatus] = useState("carregando…");
  const [erro, setErro] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [cotBusy, setCotBusy] = useState(false);
  const [fx, setFx] = useState<number | null>(null);     // câmbio USD->BRL mais recente
  const [modal, setModal] = useState<{ mode: "add" | "edit"; inv?: Investimento } | null>(null);
  const [ibkr, setIbkr] = useState<IbkrCredencial | null>(null); // conexão IBKR (null = não conectado)
  const [ibkrModal, setIbkrModal] = useState(false);

  const [busca, setBusca] = useState("");
  const [fTipo, setFTipo] = useState("");
  const [fBanco, setFBanco] = useState("");
  const [sortCol, setSortCol] = useState<keyof Investimento>("saldo");
  const [sortDir, setSortDir] = useState(-1);

  // Recalcula o valor atual das posições manuais com `ticker` pela cotação de
  // mercado (Stooq) + câmbio USD->BRL. Grava `saldo` em BRL (convertido) e mostra
  // o valor nativo (US$) na linha. Silencioso no carregamento; com aviso no botão.
  const refreshCotacoes = useCallback(async (lista: Investimento[], opts?: { silent?: boolean }) => {
    const comTicker = lista.filter((i) => i.manual && i.ticker);
    const tickers = [...new Set(comTicker.map((i) => i.ticker!.toUpperCase()))];
    if (!tickers.length) return;
    setCotBusy(true);
    try {
      const { usdbrl, quotes } = await fetchCotacoes(tickers);
      if (usdbrl != null) setFx(usdbrl);
      const agora = new Date().toISOString();
      const patches = new Map<string, Partial<Investimento>>();
      const persist: Promise<void>[] = [];
      for (const i of comTicker) {
        const q = quotes[i.ticker!.toUpperCase()];
        if (!q) continue;
        const nativo = (i.quantidade ?? 0) * q.price;
        const estrangeira = !!(i.moeda_cotacao && i.moeda_cotacao !== "BRL");
        const taxa = i.moeda_cotacao === "USD" ? usdbrl : 1;     // só USD tem câmbio do Stooq
        const saldo = estrangeira ? (taxa != null ? nativo * taxa : i.saldo ?? null) : nativo;
        const lucro = saldo != null && i.valor_aplicado != null ? saldo - i.valor_aplicado : i.lucro ?? null;
        patches.set(i.investment_id, { preco_unitario: q.price, preco_em: agora, saldo, lucro });
        persist.push(setInvestmentCotacao(i.investment_id, { saldo, preco_unitario: q.price, preco_em: agora, lucro }).catch(() => {}));
      }
      if (patches.size) setRows((cur) => cur.map((i) => (patches.has(i.investment_id) ? { ...i, ...patches.get(i.investment_id) } : i)));
      await Promise.all(persist);
      if (!opts?.silent) setMsg(`✓ Cotações atualizadas${usdbrl ? ` · USD R$ ${usdbrl.toFixed(2)}` : ""}.`);
    } catch (e) {
      if (!opts?.silent) setMsg("Não foi possível atualizar cotações: " + (e as Error).message);
    } finally {
      setCotBusy(false);
    }
  }, []);

  const carregar = useCallback(async () => {
    setStatus("carregando…");
    setErro("");
    try {
      const [inv, h, ht, cx, cred] = await Promise.all([
        listInvestments(),
        listInvestmentHistory(),
        listInvestmentHistoryByTipo().catch(() => [] as InvestimentoHistTipo[]),
        listSaldoCaixa().catch(() => [] as SaldoConta[]),
        getIbkrCredencial().catch(() => null),
      ]);
      setRows(inv);
      setHist(h);
      setHistTipo(ht);
      setCaixa(cx);
      setIbkr(cred);
      void refreshCotacoes(inv, { silent: true }); // atualiza cotações em 2º plano
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setStatus("");
    }
  }, [refreshCotacoes]);

  useEffect(() => { carregar(); }, [carregar]);

  // exclui uma posição manual (com confirmação)
  const removerManual = useCallback(async (i: Investimento) => {
    if (!window.confirm(`Excluir "${i.nome ?? "este investimento"}"? Esta ação não pode ser desfeita.`)) return;
    try {
      await deleteManualInvestment(i.investment_id);
      setRows((rs) => rs.filter((r) => r.investment_id !== i.investment_id));
    } catch (e) {
      setMsg("Erro ao excluir: " + (e as Error).message);
    }
  }, []);

  const sincronizar = useCallback(async () => {
    setBusy(true);
    setMsg("Sincronizando investimentos…");
    try {
      const r = await syncInvestments();
      setMsg(`✓ ${r.investimentos} posição(ões) de ${r.itens} conexão(ões) sincronizadas.`);
      await carregar();
    } catch (e) {
      setMsg("Erro ao sincronizar: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [carregar]);

  // classifica um ativo (atualização otimista + persiste)
  const classificar = useCallback(async (id: string, valor: string) => {
    const novo = valor || null;
    setRows((rs) => rs.map((i) => (i.investment_id === id ? { ...i, tipo_manual: novo } : i)));
    try {
      await setTipoManual(id, novo);
    } catch (e) {
      setMsg("Erro ao classificar: " + (e as Error).message);
      carregar(); // reverte para o estado real do banco
    }
  }, [carregar]);

  // override de liquidez D+1 ("" = automático/heurística, "sim"/"nao" = manual)
  const setLiquidez = useCallback(async (id: string, valor: string) => {
    const novo = valor === "" ? null : valor === "sim";
    setRows((rs) => rs.map((i) => (i.investment_id === id ? { ...i, liquidez_d1_manual: novo } : i)));
    try {
      await setLiquidezD1Manual(id, novo);
    } catch (e) {
      setMsg("Erro ao salvar liquidez: " + (e as Error).message);
      carregar(); // reverte para o estado real do banco
    }
  }, [carregar]);

  const tipos = useMemo(() => [...new Set(rows.map(tipoEf).filter(Boolean))].sort(), [rows]);
  const instituicoes = useMemo(
    () => [...new Set(rows.map(instDe).filter((x) => x && x !== "—"))].sort(),
    [rows]
  );

  const filtrados = useMemo(() => {
    const q = busca.toLowerCase().trim();
    const r = rows.filter((i) =>
      (!fTipo || tipoEf(i) === fTipo) &&
      (!fBanco || instDe(i) === fBanco) &&
      (!q ||
        String(i.nome || "").toLowerCase().includes(q) ||
        String(i.emissor || "").toLowerCase().includes(q) ||
        String(i.banco || "").toLowerCase().includes(q) ||
        String(i.subtipo || "").toLowerCase().includes(q)));
    return r.sort((a, b) => {
      const va = a[sortCol], vb = b[sortCol];
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * sortDir;
      return String(va ?? "").localeCompare(String(vb ?? "")) * sortDir;
    });
  }, [rows, busca, fTipo, fBanco, sortCol, sortDir]);

  const kpis = useMemo(() => {
    let atual = 0, aplicado = 0, lucro = 0, liquidoD1 = 0;
    for (const i of filtrados) {
      atual += i.saldo ?? 0;
      aplicado += i.valor_aplicado ?? 0;
      lucro += i.lucro ?? 0;
      if (liquidezD1Ef(i)) liquidoD1 += i.saldo ?? 0;
    }
    const nInst = new Set(filtrados.map(instDe).filter((x) => x !== "—")).size;
    const pct = aplicado !== 0 ? (lucro / Math.abs(aplicado)) * 100 : 0;
    const pctLiquido = atual > 0 ? (liquidoD1 / atual) * 100 : 0;
    return { atual, aplicado, lucro, pct, instituicoes: nInst, liquidoD1, pctLiquido };
  }, [filtrados]);

  // Retrato de HOJE calculado ao vivo sobre a carteira inteira (inclui posições
  // MANUAIS e qualquer mudança ainda não fotografada por um sync). Substitui o
  // ponto do dia no histórico para que crescimento e evolução reflitam na hora.
  const liveHoje = useMemo(() => {
    let valor_total = 0, valor_aplicado = 0, lucro = 0;
    for (const i of rows) {
      valor_total += i.saldo ?? 0;
      valor_aplicado += i.valor_aplicado ?? 0;
      lucro += i.lucro ?? 0;
    }
    return { valor_total, valor_aplicado, lucro, posicoes: rows.length };
  }, [rows]);

  const histEff = useMemo<InvestimentoHist[]>(() => {
    if (!rows.length) return hist;
    const dia = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD" (UTC, como o snapshot)
    const base = hist.filter((h) => h.dia < dia);       // tira o ponto de hoje, se já houver
    return [...base, { dia, ...liveHoje }];
  }, [hist, liveHoje, rows.length]);

  // mesmo retrato de hoje, mas quebrado por categoria (alimenta a área stackada)
  const histTipoEff = useMemo<InvestimentoHistTipo[]>(() => {
    if (!rows.length) return histTipo;
    const dia = new Date().toISOString().slice(0, 10);
    const base = histTipo.filter((h) => h.dia < dia);
    const porT = new Map<string, { valor_total: number; valor_aplicado: number; posicoes: number }>();
    for (const i of rows) {
      const k = tipoEf(i) || "OUTROS";
      const acc = porT.get(k) ?? { valor_total: 0, valor_aplicado: 0, posicoes: 0 };
      acc.valor_total += i.saldo ?? 0;
      acc.valor_aplicado += i.valor_aplicado ?? 0;
      acc.posicoes += 1;
      porT.set(k, acc);
    }
    const hoje = [...porT.entries()].map(([tipo, v]) => ({ dia, tipo, ...v }));
    return [...base, ...hoje];
  }, [histTipo, rows]);

  // Crescimento do patrimônio (MoM / YTD / YoY) a partir do histórico diário.
  // Base de cada métrica: o retrato mais recente NA ou ANTES da data-âncora
  //  - MoM: fim do mês anterior;  - YTD: virada do ano;  - YoY: ~12 meses atrás.
  // Sem um retrato no período, cai no retrato mais antigo disponível (rótulo
  // "desde dd/mm/aa" deixa a base explícita) — assim os cards já têm valor e vão
  // se ajustando à medida que o histórico cresce. É a carteira inteira (não os
  // filtros), pois o histórico é gravado para o patrimônio todo.
  const cresc = useMemo(() => {
    const pts = histEff.filter((h) => h.valor_total != null) as { dia: string; valor_total: number }[];
    if (pts.length < 2) return null;
    const last = pts[pts.length - 1];
    const cur = last.valor_total;
    const earlier = pts.slice(0, pts.length - 1);
    const refOnOrBefore = (alvo: string) => {
      let best = earlier[0];
      for (const p of earlier) if (p.dia <= alvo) best = p;
      return best;
    };
    const y = +last.dia.slice(0, 4), m = +last.dia.slice(5, 7);
    const fimMesAnterior = new Date(y, m - 1, 0); // dia 0 do mês atual = último dia do anterior
    const alvoMoM = `${fimMesAnterior.getFullYear()}-${String(fimMesAnterior.getMonth() + 1).padStart(2, "0")}-${String(fimMesAnterior.getDate()).padStart(2, "0")}`;
    const alvoYTD = `${y - 1}-12-31`;
    const alvoYoY = `${y - 1}-${last.dia.slice(5)}`;
    const calc = (alvo: string) => {
      const ref = refOnOrBefore(alvo);
      const delta = cur - ref.valor_total;
      const pct = ref.valor_total !== 0 ? (delta / Math.abs(ref.valor_total)) * 100 : null;
      return { delta, pct, refDia: ref.dia };
    };
    return { mom: calc(alvoMoM), ytd: calc(alvoYTD), yoy: calc(alvoYoY) };
  }, [histEff]);

  // composição por tipo efetivo (sobre os filtrados), com cor estável
  const porTipo = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of filtrados) {
      const k = tipoEf(i) || "OUTROS";
      m.set(k, (m.get(k) ?? 0) + (i.saldo ?? 0));
    }
    const arr = [...m.entries()]
      .map(([tipo, total]) => ({ tipo, label: labelTipo(tipo), total }))
      .sort((a, b) => b.total - a.total)
      .map((x, i) => ({ ...x, cor: PALETA[i % PALETA.length] }));
    return arr;
  }, [filtrados]);

  // "Caixa": saldo líquido somado das contas (Open Banking). Entra no patrimônio e
  // na composição só na visão geral (sem filtros) — não é uma "posição" filtrável.
  const caixaTotal = useMemo(() => caixa.reduce((s, c) => s + (c.saldo ?? 0), 0), [caixa]);
  const mostraCaixa = !fTipo && !fBanco && !busca.trim() && caixaTotal !== 0;
  const caixaShown = mostraCaixa ? caixaTotal : 0;
  const totalPatrimonio = kpis.atual + caixaShown;
  // liquidez D+1 = saldo em conta (caixa, 100% líquido) + investimentos com D+1
  const d1Total = kpis.liquidoD1 + caixaShown;
  const d1Pct = totalPatrimonio > 0 ? (d1Total / totalPatrimonio) * 100 : 0;

  // composição do patrimônio: tipos de investimento + (opcional) o Caixa
  const composicao = useMemo(() => {
    if (!mostraCaixa) return porTipo;
    return [...porTipo, { tipo: "CAIXA", label: "Caixa", total: caixaTotal, cor: CAIXA_COR }]
      .sort((a, b) => b.total - a.total);
  }, [porTipo, mostraCaixa, caixaTotal]);

  // série de evolução do patrimônio (histórico diário)
  const serie = useMemo(
    () => histEff.map((h) => ({
      dia: h.dia,
      Patrimônio: Math.round((h.valor_total ?? 0) * 100) / 100,
      Aplicado: Math.round((h.valor_aplicado ?? 0) * 100) / 100,
    })),
    [histEff]
  );

  // cor estável por categoria (mesma do gráfico de composição -> serve de legenda)
  const corPorTipo = useMemo(() => {
    const m = new Map<string, string>();
    porTipo.forEach((t) => m.set(t.tipo, t.cor));
    return m;
  }, [porTipo]);

  // série STACKADA de evolução por categoria (dia-a-dia).
  //  - preferimos o histórico REAL por tipo (pluggy_investments_hist_tipo);
  //  - sem ele (migração não rodou / poucos dias), ESTIMAMOS distribuindo o total
  //    diário pela composição atual — o total bate, a quebra é aproximada.
  const stack = useMemo(() => {
    const round = (n: number) => Math.round(n * 100) / 100;
    const baseCats = porTipo.map((t) => ({ tipo: t.tipo, label: t.label, cor: t.cor }));

    // 1) histórico real por categoria
    const diasReais = [...new Set(histTipoEff.map((r) => r.dia))].sort();
    if (diasReais.length >= 2) {
      const tiposReais = new Set(histTipoEff.map((r) => r.tipo));
      // ordem: categorias da composição atual (na sua ordem) + as demais do histórico
      const extras = [...tiposReais].filter((t) => !baseCats.some((c) => c.tipo === t));
      const cats = [
        ...baseCats.filter((c) => tiposReais.has(c.tipo)),
        ...extras.map((t, i) => ({
          tipo: t,
          label: labelTipo(t),
          cor: corPorTipo.get(t) ?? PALETA[(baseCats.length + i) % PALETA.length],
        })),
      ];
      const byDia = new Map<string, Record<string, number>>();
      for (const r of histTipoEff) {
        const row = byDia.get(r.dia) ?? {};
        row[r.tipo] = round(r.valor_total ?? 0);
        byDia.set(r.dia, row);
      }
      const data = diasReais.map((dia) => {
        const vals = byDia.get(dia) ?? {};
        const row: Record<string, number | string> = { dia };
        for (const c of cats) row[c.tipo] = vals[c.tipo] ?? 0;
        return row;
      });
      return { data, cats, sintetico: false };
    }

    // 2) estimativa pela composição atual (total diário x fração de cada tipo)
    if (serie.length >= 2 && kpis.atual > 0 && baseCats.length) {
      const fracDe = new Map(baseCats.map((c) => [c.tipo, (porTipo.find((p) => p.tipo === c.tipo)?.total ?? 0) / kpis.atual]));
      const data = serie.map((s) => {
        const row: Record<string, number | string> = { dia: s.dia };
        for (const c of baseCats) row[c.tipo] = round(s["Patrimônio"] * (fracDe.get(c.tipo) ?? 0));
        return row;
      });
      return { data, cats: baseCats, sintetico: true };
    }

    return { data: [] as Record<string, number | string>[], cats: baseCats, sintetico: false };
  }, [histTipoEff, serie, porTipo, corPorTipo, kpis.atual]);

  function baixarCsv(cols: ColDef[]) {
    const blob = new Blob(["﻿" + toCsv(filtrados, cols)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "investimentos.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const COLS: ColDef[] = [
    {
      key: "nome", label: "Investimento", sortable: true, render: (i) => (
        <span title={i.nome ?? ""} className="inline-flex items-center gap-[6px] min-w-0">
          {ehIbkr(i) && <span className="text-[10px] px-[5px] py-[1px] rounded-[5px] bg-accent2/10 text-accent2 font-semibold shrink-0">IBKR</span>}
          {i.manual && <span className="text-[10px] px-[5px] py-[1px] rounded-[5px] bg-violet/10 text-violet font-semibold shrink-0">manual</span>}
          <span className="truncate">{cell(i.nome)}</span>
          {i.ticker && <span className="text-muted text-[11px] shrink-0">· {i.ticker}</span>}
        </span>
      ),
    },
    { key: "tipo", label: "Tipo (Pluggy)", sortable: true, render: (i) => (ehIbkr(i) ? <span className="text-muted">IBKR</span> : i.manual ? <span className="text-muted">Manual</span> : labelTipo(i.tipo)) },
    {
      key: "tipo_manual", label: "Classe (sua)", render: (i) => (
        <select
          value={i.tipo_manual ?? ""}
          onChange={(e) => classificar(i.investment_id, e.target.value)}
          className="select-chev bg-card text-txt border border-line rounded-[8px] pl-2 pr-6 py-[5px] text-[12px] cursor-pointer outline-none focus:border-muted transition-colors max-w-[140px]"
          title="Sua classificação (sobrepõe o tipo da Pluggy)"
        >
          <option value="">(automático)</option>
          {CLASSE_OPTS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
        </select>
      ),
    },
    { key: "banco", label: "Instituição", sortable: true, render: (i) => instDe(i) },
    { key: "emissor", label: "Emissor (Pluggy)", render: (i) => cell(i.emissor) },
    { key: "valor_aplicado", label: "Aplicado", num: true, sortable: true, render: (i) => (i.valor_aplicado != null ? fmtMoeda(i.valor_aplicado, moedaDe(i)) : "—") },
    {
      key: "saldo", label: "Valor atual", num: true, sortable: true, render: (i) => {
        if (temCotacaoNativa(i)) {
          return (
            <span title={i.saldo != null ? `≈ ${BRL(i.saldo)}` : ""}>
              {fmtMoeda(valorNativo(i), i.moeda_cotacao)}
              {i.saldo != null && <span className="block text-muted text-[10.5px] leading-tight">≈ {BRL0(i.saldo)}</span>}
            </span>
          );
        }
        return i.saldo != null ? fmtMoeda(i.saldo, moedaDe(i)) : "—";
      },
    },
    { key: "lucro", label: "Lucro", num: true, sortable: true, render: (i) => (i.lucro != null ? <span className={i.lucro < 0 ? "text-red" : "text-green"}>{fmtMoeda(i.lucro, moedaDe(i))}</span> : "—") },
    {
      key: "liquidez_d1_manual", label: "Liquidez D+1", render: (i) => (
        <select
          value={i.liquidez_d1_manual == null ? "" : i.liquidez_d1_manual ? "sim" : "nao"}
          onChange={(e) => setLiquidez(i.investment_id, e.target.value)}
          className="select-chev bg-card text-txt border border-line rounded-[8px] pl-2 pr-6 py-[5px] text-[12px] cursor-pointer outline-none focus:border-muted transition-colors max-w-[130px]"
          title="Tem liquidez D+1 (resgate disponível em ~1 dia útil)? 'Auto' usa uma heurística pelo tipo do ativo; escolha Sim/Não para sobrepor."
        >
          <option value="">{`Auto · ${liquidezD1Auto(i) ? "Sim" : "Não"}`}</option>
          <option value="sim">Sim</option>
          <option value="nao">Não</option>
        </select>
      ),
    },
    { key: "taxa", label: "Taxa", render: (i) => cell(i.taxa) },
    { key: "vencimento", label: "Vencimento", sortable: true, render: (i) => fmtVenc(i.vencimento) },
    { key: "quantidade", label: "Qtd.", num: true, render: (i) => (i.quantidade != null ? i.quantidade.toLocaleString("pt-BR") : "—") },
    {
      key: "manual", label: "", noCsv: true, render: (i) => (i.manual ? (
        <span className="inline-flex gap-1 whitespace-nowrap">
          <button onClick={() => setModal({ mode: "edit", inv: i })} title="Editar" className="w-[26px] h-[26px] rounded-[7px] bg-fill text-muted hover:text-txt border-0 cursor-pointer text-[12px] transition-colors">✎</button>
          <button onClick={() => removerManual(i)} title="Excluir" className="w-[26px] h-[26px] rounded-[7px] bg-fill text-muted hover:text-red border-0 cursor-pointer text-[12px] transition-colors">🗑</button>
        </span>
      ) : <span className="text-muted/40">—</span>),
    },
  ];

  function th(c: ColDef) {
    const base = `sticky top-0 bg-card z-[1] whitespace-nowrap ${c.num ? "text-right" : ""}`;
    if (!c.sortable) return <th key={String(c.key)} className={base}>{c.label}</th>;
    return (
      <th
        key={String(c.key)}
        className={`${base} cursor-pointer select-none`}
        onClick={() => { if (sortCol === c.key) setSortDir((x) => x * -1); else { setSortCol(c.key); setSortDir(c.num ? -1 : 1); } }}
      >
        {c.label}{sortCol === c.key ? (sortDir > 0 ? " ▲" : " ▼") : ""}
      </th>
    );
  }

  // card de crescimento: variação em R$ (grande, colorida) + % e base abaixo
  const crescKpi = (title: string, g: { delta: number; pct: number | null; refDia: string } | undefined) => {
    if (!g) return <Kpi key={title} title={title} value="—" sub="registrando histórico…" />;
    const pos = g.delta >= 0;
    const pctTxt = g.pct == null ? "" : `${pos ? "+" : ""}${g.pct.toFixed(1)}% · `;
    return (
      <Kpi
        key={title}
        title={title}
        value={<span className={pos ? "text-green" : "text-red"}>{pos ? "+" : ""}{BRL0(g.delta)}</span>}
        sub={`${pctTxt}desde ${fmtDiaBR(g.refDia)}`}
      />
    );
  };

  const limpar = () => { setBusca(""); setFTipo(""); setFBanco(""); };
  const temTickers = rows.some((i) => i.manual && i.ticker);

  const btnAddManual = (
    <button
      onClick={() => setModal({ mode: "add" })}
      className="bg-fill text-txt border border-line rounded-[10px] px-3 py-[8px] text-[13px] font-medium cursor-pointer hover:border-muted transition-colors"
    >
      + Adicionar manual
    </button>
  );

  const btnIbkr = (
    <button
      onClick={() => setIbkrModal(true)}
      className="bg-fill text-txt border border-line rounded-[10px] px-3 py-[8px] text-[13px] font-medium cursor-pointer hover:border-muted transition-colors"
      title={ibkr ? "IBKR conectada — importar/gerenciar" : "Conectar Interactive Brokers"}
    >
      {ibkr ? "IBKR ✓" : "Conectar IBKR"}
    </button>
  );

  const btnSync = (
    <button
      onClick={sincronizar}
      disabled={busy}
      className="bg-accent text-white border-0 rounded-[10px] px-4 py-[9px] text-[13.5px] font-semibold cursor-pointer disabled:opacity-50 hover:opacity-90 transition-opacity"
    >
      {busy ? "Sincronizando…" : "Sincronizar investimentos"}
    </button>
  );

  if (status && rows.length === 0) {
    return (
      <div className="inline-flex items-center gap-2 text-muted text-[13px]">
        <span className="w-[10px] h-[10px] rounded-full border-2 border-muted/40 border-t-muted animate-spin" />
        Carregando investimentos…
      </div>
    );
  }

  // estado vazio: nenhuma posição ainda nem saldo em caixa (ou tabela ainda não criada)
  if (!status && rows.length === 0 && caixa.length === 0) {
    return (
      <div className="bg-card border border-line rounded-[18px] p-6 sm:p-8 shadow-card text-center">
        <h2 className="text-[16px] font-semibold tracking-tight mb-2">Nenhum investimento ainda</h2>
        <p className="text-[13.5px] text-muted leading-relaxed max-w-[560px] mx-auto">
          Esta aba mostra o seu patrimônio investido (renda fixa, fundos, ações, ETFs,
          previdência…) puxado do Open Finance via Pluggy. Conecte um banco/corretora na
          aba <strong>Conectar</strong> e clique em <strong>Sincronizar investimentos</strong>,
          ou adicione uma posição <strong>manual</strong> (ex.: o ETF <strong>VT</strong> numa
          corretora no exterior).
        </p>
        {erro && <div className="text-[13px] text-red bg-fill rounded-[10px] px-3 py-2 mt-4 max-w-[560px] mx-auto">Erro: {erro}</div>}
        {msg && <div className="text-[13px] text-txt bg-fill rounded-[10px] px-3 py-2 mt-3 max-w-[560px] mx-auto">{msg}</div>}
        <div className="mt-4 flex gap-2 justify-center flex-wrap">{btnAddManual}{btnIbkr}{btnSync}</div>
        {modal && <ManualForm mode={modal.mode} inicial={modal.inv} onClose={() => setModal(null)} onSaved={carregar} />}
        {ibkrModal && <IbkrForm inicial={ibkr} onClose={() => setIbkrModal(false)} onReload={carregar} />}
      </div>
    );
  }

  return (
    <div>
      <div className={`grid grid-cols-2 gap-[14px] mb-[18px] ${caixa.length > 0 ? "md:grid-cols-3 lg:grid-cols-5" : "md:grid-cols-4"}`}>
        <Kpi
          title="Investido total"
          value={BRL0(kpis.atual)}
          sub={`D+1 ${BRL0(d1Total)} · ${d1Pct.toFixed(0)}%`}
          color="text-violet"
        />
        {caixa.length > 0 && <SaldoContaCard caixa={caixa} total={caixaTotal} />}
        {crescKpi("Crescimento MoM", cresc?.mom)}
        {crescKpi("Crescimento YTD", cresc?.ytd)}
        {crescKpi("Crescimento YoY", cresc?.yoy)}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-[14px] items-start">
        <Panel
          title="Evolução por categoria"
          sub={stack.sintetico ? "(estimativa pela composição atual, por dia)" : "(valor por categoria, por dia)"}
          className="lg:col-span-2"
        >
          {stack.data.length >= 2 && stack.cats.length > 0 ? (
            <>
              <div className="h-[300px] md:h-[340px] min-w-0 mt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={stack.data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
                    <CartesianGrid stroke={cc.grid} vertical={false} />
                    <XAxis dataKey="dia" tickFormatter={(d) => fmtDiaBR(String(d))} tick={cc.tickSm} minTickGap={28} axisLine={false} tickLine={false} />
                    <YAxis tick={cc.tickSm} tickFormatter={(v) => brlShort(v)} width={64} axisLine={false} tickLine={false} />
                    <Tooltip content={(p: any) => <StackTip {...p} />} />
                    {stack.cats.map((c) => (
                      <Area
                        key={c.tipo}
                        type="monotone"
                        dataKey={c.tipo}
                        name={c.label}
                        stackId="patrimonio"
                        stroke={c.cor}
                        strokeWidth={0.8}
                        fill={c.cor}
                        fillOpacity={0.88}
                        isAnimationActive={false}
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              {stack.sintetico && (
                <p className="text-[11.5px] text-muted leading-relaxed mt-2">
                  Estimativa: o total diário é distribuído pela composição atual da carteira. A quebra
                  real por categoria passa a ser registrada a cada sincronização — em dois dias ela
                  substitui esta visão automaticamente.
                </p>
              )}
            </>
          ) : (
            <p className="text-[13px] text-muted leading-relaxed mt-1">
              O histórico começa a ser registrado a cada sincronização. Assim que houver
              pelo menos <strong>dois dias</strong> sincronizados, a evolução por categoria aparece aqui.
              {serie.length === 1 && " (1 ponto registrado até agora.)"}
            </p>
          )}
        </Panel>

        <Panel title="Composição do patrimônio" sub={mostraCaixa ? "(investimentos + caixa)" : "(valor atual)"} className="lg:col-span-1">
          {composicao.length > 0 ? (
            <div className="flex flex-col gap-4 mt-1">
              <div className="relative h-[200px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={composicao} dataKey="total" nameKey="label" cx="50%" cy="50%" innerRadius={62} outerRadius={92} paddingAngle={1.5} stroke={cc.cardStroke} strokeWidth={2} isAnimationActive={false}>
                      {composicao.map((t) => <Cell key={t.tipo} fill={t.cor} />)}
                    </Pie>
                    <Tooltip content={(p: any) => <ChartTip {...p} pctOf={totalPatrimonio} />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-[11px] text-muted">Total</span>
                  <span className="text-[17px] font-semibold tracking-tight tabular-nums">{BRL0(totalPatrimonio)}</span>
                </div>
              </div>
              <div className="flex flex-col gap-2 w-full min-w-0">
                {composicao.map((t) => (
                  <BarRow
                    key={t.tipo}
                    label={<span className="inline-flex items-center gap-2"><span className="w-[9px] h-[9px] rounded-full shrink-0" style={{ background: t.cor }} />{t.label}</span>}
                    value={t.total}
                    max={composicao[0].total}
                    color={t.cor}
                    right={`${BRL0(t.total)} · ${totalPatrimonio > 0 ? ((t.total / totalPatrimonio) * 100).toFixed(0) : 0}%`}
                  />
                ))}
              </div>
              {mostraCaixa && (
                <p className="text-[11.5px] text-muted leading-relaxed">
                  <span className="inline-block w-[9px] h-[9px] rounded-full align-middle mr-1" style={{ background: CAIXA_COR }} />
                  Caixa = saldo líquido das contas via Open Banking. Atualiza ao sincronizar o banco na aba <strong>Conectar</strong>.
                </p>
              )}
            </div>
          ) : (
            <p className="text-[13px] text-muted mt-1">Sem posições para compor o gráfico.</p>
          )}
        </Panel>
      </div>

      <div className="flex flex-wrap gap-2 items-center mb-4">
        <input className="input min-w-[220px] flex-1" placeholder="Buscar (nome, emissor, instituição)…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <Select value={fTipo} onChange={setFTipo}>
          <option value="">Todos os tipos</option>
          {tipos.map((t) => <option key={t} value={t}>{labelTipo(t)}</option>)}
        </Select>
        <Select value={fBanco} onChange={setFBanco}>
          <option value="">Todas as instituições</option>
          {instituicoes.map((b) => <option key={b}>{b}</option>)}
        </Select>
        <button className="btn-ghost" onClick={limpar}>Limpar</button>
        <button className="bg-fill text-txt border border-line rounded-[10px] px-3 py-[8px] text-[13px] font-medium cursor-pointer hover:border-muted transition-colors" onClick={carregar}>
          Atualizar
        </button>
        <button className="bg-fill text-txt border border-line rounded-[10px] px-3 py-[8px] text-[13px] font-medium cursor-pointer hover:border-muted transition-colors disabled:opacity-50" onClick={() => baixarCsv(COLS)} disabled={!filtrados.length}>
          Exportar CSV
        </button>
        {temTickers && (
          <button
            onClick={() => refreshCotacoes(rows)}
            disabled={cotBusy}
            className="bg-fill text-txt border border-line rounded-[10px] px-3 py-[8px] text-[13px] font-medium cursor-pointer hover:border-muted transition-colors disabled:opacity-50"
          >
            {cotBusy ? "Atualizando cotações…" : "Atualizar cotações"}
          </button>
        )}
        {fx != null && temTickers && <span className="text-muted text-[12px] tabular-nums">USD R$ {fx.toFixed(2)}</span>}
        {btnAddManual}
        {btnIbkr}
        {btnSync}
      </div>

      {erro && <div className="text-[13px] text-red bg-fill rounded-[10px] px-3 py-2 mb-3">Erro: {erro}</div>}
      {msg && <div className="text-[13px] text-txt bg-fill rounded-[10px] px-3 py-2 mb-3">{msg}</div>}

      <div className="bg-card border border-line rounded-[18px] shadow-card overflow-hidden">
        <div className="max-h-[620px] overflow-auto scroll-thin">
          <table className="tbl min-w-[1320px] text-[12.5px]">
            <thead><tr>{COLS.map(th)}</tr></thead>
            <tbody>
              {filtrados.slice(0, MAX).map((i) => (
                <tr key={i.investment_id}>
                  {COLS.map((c) => (
                    <td key={String(c.key)} className={`${c.num ? "num" : ""} ${c.mono ? "font-mono text-[11.5px]" : ""}`}>
                      {c.render ? c.render(i) : cell(i[c.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {filtrados.length > MAX && <div className="text-muted text-[12.5px] mt-2">Mostrando {MAX.toLocaleString("pt-BR")} de {filtrados.length.toLocaleString("pt-BR")} posições. Refine os filtros.</div>}

      {modal && <ManualForm mode={modal.mode} inicial={modal.inv} onClose={() => setModal(null)} onSaved={carregar} />}
      {ibkrModal && <IbkrForm inicial={ibkr} onClose={() => setIbkrModal(false)} onReload={carregar} />}
    </div>
  );
}
