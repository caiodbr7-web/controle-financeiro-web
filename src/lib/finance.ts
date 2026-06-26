import type { Lancamento, Modo } from "../types";
import { semAcento } from "./texto";

// ---------- formatação ----------
export const BRL = (v: number) =>
  (v < 0 ? "-" : "") +
  "R$ " +
  Math.abs(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const brlShort = (v: number) => "R$ " + Number(v || 0).toLocaleString("pt-BR");

// reais sem centavos — para os números grandes do painel
export const BRL0 = (v: number) =>
  (v < 0 ? "-" : "") + "R$ " + Math.round(Math.abs(v || 0)).toLocaleString("pt-BR", { maximumFractionDigits: 0 });

// símbolo por moeda ISO; cai para o próprio código quando não mapeado
const SIMBOLO_MOEDA: Record<string, string> = {
  BRL: "R$", USD: "US$", EUR: "€", GBP: "£", ARS: "AR$", CLP: "CL$", JPY: "¥",
};
const simboloMoeda = (m?: string | null) => {
  const k = (m || "BRL").toUpperCase();
  return SIMBOLO_MOEDA[k] ?? `${k} `;
};

// formata um valor na moeda informada (default BRL). Use no lugar de BRL()
// sempre que a linha puder estar em moeda estrangeira (lançamentos do Pluggy).
export const fmtMoeda = (v: number, moeda?: string | null) =>
  (v < 0 ? "-" : "") +
  simboloMoeda(moeda) +
  Math.abs(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// dica do valor original de uma transação internacional (ex.: "US$ 3,00"),
// ou null quando a linha é nacional / sem moeda de origem.
export const dicaMoedaOrigem = (d: { valor_origem?: number | null; moeda_origem?: string | null }) =>
  d.moeda_origem && d.valor_origem != null ? fmtMoeda(d.valor_origem, d.moeda_origem) : null;

export const mesCurto = (c: string) => {
  const m = String(c).match(/\(([^)]+)\)/);
  return (m ? m[1] : String(c)).replace("/", "-");
};

// ---------- classes ----------
export const ehGasto = (c: string | null) => c === "Gasto";
export const ehReceita = (c: string | null) => c === "Receita";
export const ehTransfer = (c: string | null) => String(c || "").startsWith("Transfer");
export const catKey = (d: Lancamento) =>
  d.categoria_manual || d.categoria_auto || d.detalhe || "Sem categoria";

// ---------- cores por banco / origem ----------
export const BANK_COLORS: Record<string, { cartao: string; conta: string }> = {
  itau: { cartao: "#2f6df6", conta: "#9ec3ff" },
  nubank: { cartao: "#7c3aed", conta: "#c4b5fd" },
  picpay: { cartao: "#16a34a", conta: "#86efac" },
  rico: { cartao: "#0ea5e9", conta: "#7dd3fc" },
  xp: { cartao: "#111827", conta: "#6b7280" },
  outro: { cartao: "#86868b", conta: "#c2cbdb" },
};
const BANK_ORDER: Record<string, number> = { itau: 0, nubank: 1, picpay: 2, rico: 3, xp: 4, outro: 9 };
export const bankOf = (k: string) => {
  k = semAcento(k || "").toLowerCase();
  if (k.includes("itau")) return "itau";
  if (k.includes("nubank") || k.includes("nu pagamentos")) return "nubank";
  if (k.includes("picpay")) return "picpay";
  if (k.includes("rico")) return "rico";
  if (/(^|[^a-z])xp([^a-z]|$)/.test(k)) return "xp";
  return "outro";
};
export const isConta = (k: string) => (k || "").toLowerCase().includes("conta");
export const corChave = (k: string) => {
  const b = BANK_COLORS[bankOf(k)] || BANK_COLORS.outro;
  return isConta(k) ? b.conta : b.cartao;
};
export const ordemChave = (k: string) => BANK_ORDER[bankOf(k)] * 10 + (isConta(k) ? 1 : 0);

// ---------- agregação mensal ----------
export interface MonthAgg { rec: number; gas: number; tr: number; saldo: number; }
export function monthAgg(dados: Lancamento[], m: string): MonthAgg {
  let rec = 0, gas = 0, tr = 0;
  for (const d of dados) {
    if (d.competencia !== m) continue;
    if (ehGasto(d.classe)) gas += Math.abs(d.valor);
    else if (ehReceita(d.classe)) rec += Math.abs(d.valor);
    else if (ehTransfer(d.classe)) tr += d.valor;
  }
  return { rec, gas, tr, saldo: rec - gas };
}

export function deltaTxt(cur: number, prev: number | null | undefined) {
  if (prev === null || prev === undefined) return "";
  if (prev === 0) return cur === 0 ? "sem variação" : "novo";
  const pc = ((cur - prev) / Math.abs(prev)) * 100;
  return (pc >= 0 ? "▲ " : "▼ ") + Math.abs(pc).toFixed(0) + "%";
}

// ---------- evolução diária / mensal (data real da compra) ----------
export const MES_ABREV = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
export const dvLabel = (k: string) => MES_ABREV[+k.slice(5, 7) - 1] + "/" + k.slice(2, 4);
export const dvAddMes = (k: string, n: number) => {
  let y = +k.slice(0, 4), m = +k.slice(5, 7) + n;
  y += Math.floor((m - 1) / 12);
  m = (((m - 1) % 12) + 12) % 12 + 1;
  return y + "-" + String(m).padStart(2, "0");
};
export const dvDiasNoMes = (k: string) => new Date(+k.slice(0, 4), +k.slice(5, 7), 0).getDate();

export function dvDataReal(d: Lancamento): { k: string; d: number } | null {
  const m = String(d.data_mov || "").trim().match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  const dd = +m[1], mm = +m[2];
  if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return null;
  const cy = +String(d.competencia).slice(0, 4), cm = +String(d.competencia).slice(5, 7);
  if (!cy || !cm) return null;
  return { k: (mm > cm ? cy - 1 : cy) + "-" + String(mm).padStart(2, "0"), d: dd };
}

// data completa "DD/MM/AA" a partir da data real do movimento (usa o ano da
// competência, tratando a virada de ano: compra em dez na fatura de jan).
// Cai no data_mov cru quando não há data válida.
export function dataCompleta(d: Lancamento): string {
  const r = dvDataReal(d);
  if (r) return `${String(r.d).padStart(2, "0")}/${r.k.slice(5, 7)}/${r.k.slice(2, 4)}`;
  return String(d.data_mov || "") || "—";
}

// chave cronológica "YYYY-MM-DD" para ORDENAR pela data do movimento (a coluna
// "Data" guarda só "dd/mm", que ordenaria por dia). Cai na competência se inválida.
export function dataOrdKey(d: Lancamento): string {
  const r = dvDataReal(d);
  if (r) return `${r.k}-${String(r.d).padStart(2, "0")}`;
  return String(d.competencia || "").slice(0, 7) + "-00";
}

export function dvGasto(d: Lancamento): number {
  if (d.classe === "Gasto") return Math.abs(d.valor);
  if (d.classe === "Estorno/Credito") return -Math.abs(d.valor);
  return 0;
}

// mês pela DATA REAL do movimento ("YYYY-MM"); cai no mês de competência quando não há data válida
export function mesReal(d: Lancamento): string {
  const r = dvDataReal(d);
  return r ? r.k : String(d.competencia).slice(0, 7);
}

export function mvOrigemOk(origem: string, modo: Modo): boolean {
  const o = String(origem || "");
  if (modo === "cartao") return o.startsWith("Cartao");
  if (modo === "conta") return o.startsWith("Conta");
  return true; // ambos
}

// limite de parciais: cartão/ambos usam a regra das faturas; conta só exclui o mês atual
export function dvParcialLimite(allDados: Lancamento[]): string {
  const h = new Date();
  const curK = h.getFullYear() + "-" + String(h.getMonth() + 1).padStart(2, "0");
  let max = "";
  for (const d of allDados) {
    if (String(d.origem || "").startsWith("Cartao")) {
      const c = String(d.competencia).slice(0, 7);
      // ignora competências futuras (faturas que o Pluggy adianta) — elas não
      // estendem o horizonte de meses "completos".
      if (c > max && c <= curK) max = c;
    }
  }
  return max ? dvAddMes(max, -1) : "9999-99";
}
export function mvLimiteParcial(allDados: Lancamento[], modo: Modo): string {
  if (modo === "conta") {
    const h = new Date();
    return h.getFullYear() + "-" + String(h.getMonth() + 1).padStart(2, "0");
  }
  return dvParcialLimite(allDados);
}

// série diária (mapa mês -> array[31] de gasto por dia), respeitando o modo
export function dvSeries(dados: Lancamento[], months: string[], modo: Modo) {
  const map: Record<string, number[]> = {};
  for (const d of dados) {
    const g = dvGasto(d);
    if (!g) continue;
    if (!mvOrigemOk(d.origem, modo)) continue;
    const r = dvDataReal(d);
    if (!r) continue;
    (map[r.k] = map[r.k] || new Array(31).fill(0))[r.d - 1] += g;
  }
  const first = months.length ? String(months[0]).slice(0, 7) : "0000-00";
  return { keys: Object.keys(map).filter((k) => k >= first).sort(), map };
}

// série mensal (total por mês), só meses completos
export function mvSeriesMensal(dados: Lancamento[], allDados: Lancamento[], months: string[], modo: Modo) {
  const tot: Record<string, number> = {};
  for (const d of dados) {
    const g = dvGasto(d);
    if (!g) continue;
    if (!mvOrigemOk(d.origem, modo)) continue;
    const r = dvDataReal(d);
    if (!r) continue;
    tot[r.k] = (tot[r.k] || 0) + g;
  }
  const first = months.length ? String(months[0]).slice(0, 7) : "0000-00";
  const lim = mvLimiteParcial(allDados, modo);
  const keys = Object.keys(tot).filter((k) => k >= first && k < lim).sort();
  return { keys, tot };
}

export const MODOS: Record<Modo, { rotulo: string; cor: string }> = {
  cartao: { rotulo: "Cartão de crédito", cor: "#820ad1" },
  ambos: { rotulo: "Cartão + contas", cor: "#5e5ce6" },
  conta: { rotulo: "Contas", cor: "#2f6df6" },
};

// normaliza a descrição para agrupar por "estabelecimento"
// (tira números/parcelas, *, #, espaços extras) — mesmo critério da análise
export function normEstab(desc: string): string {
  return String(desc || "")
    .toLowerCase()
    .replace(/\d/g, "")
    .replace(/[*#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48);
}

// paleta fixa por categoria (mesma cor no gráfico, na rosca e na legenda)
export const CAT_CORES: Record<string, string> = {
  Moradia: "#820ad1", Mercado: "#16a34a", Alimentacao: "#f59e0b", Transporte: "#2f6df6",
  Saude: "#e0382b", Academia: "#0ea5e9", Vestuario: "#db2777", Compras: "#7c3aed",
  Assinaturas: "#0891b2", Lazer: "#f97316", Viagem: "#6d28d9", Educacao: "#059669",
  Servicos: "#64748b", Transferencias: "#94a3b8", "Impostos/Taxas": "#b45309",
  Presentes: "#ec4899", Pets: "#a16207", Corporativo: "#334155", Outros: "#9ca3af",
  "Sem categoria": "#cbd5e1",
};
export const corCategoria = (c: string) => CAT_CORES[c] || "#9ca3af";

export const CATEGORIAS = [
  "", "Moradia", "Mercado", "Alimentacao", "Transporte", "Saude", "Academia",
  "Vestuario", "Compras", "Assinaturas", "Lazer", "Viagem", "Educacao",
  "Servicos", "Transferencias", "Impostos/Taxas", "Presentes", "Pets",
  "Corporativo", "Outros",
];
