import type { Lancamento, Modo } from "../types";
import { semAcento } from "./texto";
import {
  ehGasto as ehGastoClasse,
  ehReceita as ehReceitaClasse,
  ehTransfer as ehTransferClasse,
  precisaClassificar as precisaClassificarClasse,
  valorGasto as valorGastoClasse,
  valorReceita as valorReceitaClasse,
  valorAporte as valorAporteClasse,
  valorReceitaInvest as valorReceitaInvestClasse,
} from "./lancClasses";
// reexporta os helpers de valor do contrato, sem duplicar lógica:
export {
  valorGasto, valorReceita, valorAporte, valorReceitaInvest,
} from "./lancClasses";

// ---------- formatação ----------
export const BRL = (v: number) =>
  (v < 0 ? "-" : "") +
  "R$ " +
  Math.abs(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const brlShort = (v: number) => "R$ " + Math.round(Number(v || 0)).toLocaleString("pt-BR");

// reais compactos p/ caixas apertadas (mobile): milhares viram "k", milhões "M".
// Abaixo de 10 mil mantém o valor cheio (abreviar "R$ 4.428" só atrapalha).
export const kBRL = (v: number) => {
  const n = Number(v || 0), a = Math.abs(n), s = n < 0 ? "-" : "";
  if (a >= 1_000_000) return s + "R$ " + (a / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "M";
  if (a >= 10_000) return s + "R$ " + Math.round(a / 1000).toLocaleString("pt-BR") + "k";
  return s + "R$ " + Math.round(a).toLocaleString("pt-BR");
};

// compacto SEM "R$" — p/ tabelas onde a moeda já está implícita (ex.: Matriz Mensal).
// Mantém o "k"/"M" e o sinal, mas economiza a largura do "R$ " (evita quebra de linha).
export const kNum = (v: number) => {
  const n = Number(v || 0), a = Math.abs(n), s = n < 0 ? "-" : "";
  if (a >= 1_000_000) return s + (a / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "M";
  if (a >= 10_000) return s + Math.round(a / 1000).toLocaleString("pt-BR") + "k";
  return s + Math.round(a).toLocaleString("pt-BR");
};

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
// FONTE ÚNICA EM CÓDIGO: os predicados de classe e os critérios de inclusão dos
// dashboards moram em src/lib/lancClasses.ts. Aqui só REEXPORTAMOS (sem duplicar a
// lógica) e reexpomos os helpers de valor que respeitam `interna`/Aporte/Receita
// Investimento. Ver docs/fonte-unica-lancamentos.md §3.4.
export const ehGasto = ehGastoClasse;
export const ehReceita = ehReceitaClasse;
export const ehTransfer = ehTransferClasse;
// pendência de classificação (fonte única): não categorizado e não-interno.
export const precisaClassificar = precisaClassificarClasse;
// helpers de valor reexportados acima (de lancClasses; respeitam `interna`):
//  valorGasto    — Gasto (+) menos Estorno/Credito (−), 0 se interna/Aporte
//  valorReceita  — Receita real (exclui interna e Receita Investimento)
//  valorAporte   — Σ Aporte (investido no mês)
//  valorReceitaInvest — Σ Receita Investimento (renda de investimentos)
export const catKey = (d: Lancamento) =>
  d.categoria_manual || d.categoria_auto || d.detalhe || "Sem categoria";

// mês de COMPETÊNCIA ("YYYY-MM") — eixo único de TODO total mensal (decisão 2 do
// contrato). A competência é guardada como "YYYY-MM (Mmm/AA)"; pegamos o prefixo.
export const mesComp = (d: { competencia: string }) => String(d.competencia || "").slice(0, 7);

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

// ---------- agregação mensal (eixo COMPETÊNCIA) ----------
// Delega aos helpers do contrato: gasto/receita excluem `interna` e `Aporte`;
// Receita Investimento NÃO entra em receita (ganha métrica própria `recInv`);
// `inv` = Σ Aporte (investido no mês). `tr` = fluxo neutro (transferência/pagto).
export interface MonthAgg {
  rec: number; gas: number; tr: number; saldo: number;
  inv: number; recInv: number;
}
// aceita "YYYY-MM" OU a competência completa "YYYY-MM (...)" como filtro de mês
export function monthAgg(dados: Lancamento[], m: string): MonthAgg {
  const mk = String(m).slice(0, 7);
  let rec = 0, gas = 0, tr = 0, inv = 0, recInv = 0;
  for (const d of dados) {
    if (mesComp(d) !== mk) continue;
    gas += valorGastoClasse(d);
    rec += valorReceitaClasse(d);
    inv += valorAporteClasse(d);
    recInv += valorReceitaInvestClasse(d);
    if (ehTransfer(d.classe)) tr += d.valor;
  }
  return { rec, gas, tr, saldo: rec - gas, inv, recInv };
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

// valor de GASTO de uma linha (Gasto + / Estorno − / resto 0), delegando ao
// contrato: respeita `interna` (transferência interna e aporte NÃO contam).
export function dvGasto(d: Lancamento): number {
  return valorGastoClasse(d);
}

// mês pela DATA REAL do movimento ("YYYY-MM"); cai no mês de competência quando não há data válida.
// NOTA: o eixo dos totais mensais é a COMPETÊNCIA (use mesComp). `mesReal` só serve para
// usos legados (conciliação) que precisam casar pela data real do extrato.
export function mesReal(d: Lancamento): string {
  const r = dvDataReal(d);
  return r ? r.k : String(d.competencia).slice(0, 7);
}

// dia do mês (1..31) a partir do "dd/mm" do movimento; cai no dia 1 quando inválido.
// É só o EIXO X da curva diária — o mês ao qual o dia pertence vem da competência.
export function diaDoMov(d: Lancamento): number {
  const m = String(d.data_mov || "").match(/^(\d{1,2})\/(\d{1,2})$/);
  const dia = m ? +m[1] : 1;
  return dia >= 1 && dia <= 31 ? dia : 1;
}

// ---------- parcelas / compras de meses anteriores (platô do dia 1) ----------
// Detecta a linha cuja COMPRA aconteceu em mês ANTERIOR ao da competência — a
// parcela de uma compra antiga, ou a compra do fim do ciclo passado que só caiu
// na fatura deste mês. Esse valor já estava comprometido quando o mês abriu,
// então a curva diária o conta desde o dia 1. Dois sinais, um por regime de
// datação dos bancos (docs/fonte-unica-lancamentos.md):
//  (a) data real da compra em mês < competência — base PDF curada e bancos que
//      datam toda parcela na data ORIGINAL da compra ("regime colapsado");
//  (b) sufixo "NN/MM" com NN >= 2 na descrição de linha de CARTÃO — bancos que
//      datam cada parcela dentro do próprio ciclo ("regime espalhado"); é a
//      mesma regra do SQL de tradução que espalha a competência das parcelas.
const RE_PARCELA_FIM = /(?:^|\D)(\d{1,2})\s*\/\s*(\d{1,2})\s*$/;
export function ehParcelaAnterior(d: Lancamento): boolean {
  const r = dvDataReal(d);
  if (r && r.k < mesComp(d)) return true;
  if (String(d.origem || "").startsWith("Cartao")) {
    const m = String(d.descricao || "").match(RE_PARCELA_FIM);
    if (m && +m[1] >= 2 && +m[1] <= +m[2]) return true;
  }
  return false;
}

// dia da linha no eixo diário da competência: parcela/compra de mês anterior
// conta desde o dia 1 (o platô já comprometido ao abrir o mês); o resto entra no
// dia da compra, limitado aos dias do mês da competência (um dia 31 numa
// competência de 30 dias não pode cair fora da curva).
export function diaNaComp(d: Lancamento): number {
  if (ehParcelaAnterior(d)) return 1;
  const nd = dvDiasNoMes(mesComp(d));
  return nd ? Math.min(diaDoMov(d), nd) : diaDoMov(d);
}

export function mvOrigemOk(origem: string, modo: Modo): boolean {
  const o = String(origem || "");
  if (modo === "cartao") return o.startsWith("Cartao");
  if (modo === "conta") return o.startsWith("Conta");
  return true; // ambos
}

// limite de parciais: só o mês civil ATUAL é parcial; todo mês passado já fechou.
// Antes a regra olhava a última fatura de cartão e recuava 1 mês — herança da era
// PDF, quando faturas chegavam atrasadas e ainda podiam mexer no mês anterior. Com
// Open Finance os dados chegam continuamente e o mês corrente sempre tem cartão,
// então recuar 1 mês passou a marcar o mês JÁ FECHADO (ex.: maio em 28/jun) como
// parcial sem motivo — escondendo-o do KPI "automático" e pondo "*" no rótulo.
// (`allDados` não é mais necessário; mantido na assinatura p/ não mexer nos callers.)
export function dvParcialLimite(allDados?: Lancamento[]): string {
  void allDados;
  const h = new Date();
  return h.getFullYear() + "-" + String(h.getMonth() + 1).padStart(2, "0");
}
export function mvLimiteParcial(allDados: Lancamento[], modo: Modo): string {
  if (modo === "conta") {
    const h = new Date();
    return h.getFullYear() + "-" + String(h.getMonth() + 1).padStart(2, "0");
  }
  return dvParcialLimite(allDados);
}

// série diária (mapa mês -> array[31] de gasto por dia), respeitando o modo.
// EIXO DO MÊS = competência (cada parcela cai no mês da fatura/extrato); o DIA
// (eixo x dentro do mês) vem da data real do movimento — sem data válida, dia 1;
// parcelas/compras de meses anteriores contam desde o dia 1 (ver diaNaComp).
export function dvSeries(dados: Lancamento[], months: string[], modo: Modo) {
  const map: Record<string, number[]> = {};
  for (const d of dados) {
    const g = dvGasto(d);
    if (!g) continue;
    if (!mvOrigemOk(d.origem, modo)) continue;
    const k = mesComp(d);
    if (!/^\d{4}-\d{2}$/.test(k)) continue;
    (map[k] = map[k] || new Array(31).fill(0))[diaNaComp(d) - 1] += g;
  }
  const first = months.length ? String(months[0]).slice(0, 7) : "0000-00";
  return { keys: Object.keys(map).filter((k) => k >= first).sort(), map };
}

// série mensal (total por mês), só meses completos. EIXO = competência.
export function mvSeriesMensal(dados: Lancamento[], allDados: Lancamento[], months: string[], modo: Modo) {
  const tot: Record<string, number> = {};
  for (const d of dados) {
    const g = dvGasto(d);
    if (!g) continue;
    if (!mvOrigemOk(d.origem, modo)) continue;
    const k = mesComp(d);
    if (!/^\d{4}-\d{2}$/.test(k)) continue;
    tot[k] = (tot[k] || 0) + g;
  }
  const first = months.length ? String(months[0]).slice(0, 7) : "0000-00";
  const lim = mvLimiteParcial(allDados, modo);
  const keys = Object.keys(tot).filter((k) => k >= first && k < lim).sort();
  return { keys, tot };
}

export const MODOS: Record<Modo, { rotulo: string; cor: string }> = {
  cartao: { rotulo: "Cartão de crédito", cor: "#6d28d9" },
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

// ---------- categorias: registry dinâmico, sincronizado do banco ----------
// As categorias passaram a ser editáveis pelo usuário (aba "Categorias"): nome,
// cor e a ORDEM em que aparecem nos dropdowns moram em public.categorias.
// Para manter os módulos PUROS (matrizMensal, classificador) e os helpers de cor
// funcionando sem prop-drilling, guardamos um registry mutável em memória que o
// CategoriasProvider (src/lib/categorias.tsx) mantém em sincronia com o banco.
// Os DEFAULTS abaixo são a SEMENTE (1ª carga / base nova) e o FALLBACK.
export interface CatDef { nome: string; cor: string }

export const CATEGORIAS_DEFAULT: CatDef[] = [
  { nome: "Moradia", cor: "#6d28d9" }, { nome: "Mercado", cor: "#16a34a" },
  { nome: "Alimentacao", cor: "#f59e0b" }, { nome: "Transporte", cor: "#2f6df6" },
  { nome: "Saude", cor: "#e0382b" }, { nome: "Academia", cor: "#0ea5e9" },
  { nome: "Vestuario", cor: "#db2777" }, { nome: "Compras", cor: "#7c3aed" },
  { nome: "Assinaturas", cor: "#0891b2" }, { nome: "Lazer", cor: "#f97316" },
  { nome: "Viagem", cor: "#6d28d9" }, { nome: "Educacao", cor: "#059669" },
  { nome: "Servicos", cor: "#64748b" }, { nome: "Transferencias", cor: "#94a3b8" },
  { nome: "Impostos/Taxas", cor: "#b45309" }, { nome: "Presentes", cor: "#ec4899" },
  { nome: "Pets", cor: "#a16207" }, { nome: "Corporativo", cor: "#334155" },
  { nome: "Outros", cor: "#9ca3af" },
];

// cor da linha/segmento "Sem categoria" e fallback p/ nomes desconhecidos
export const COR_SEM_CATEGORIA = "#cbd5e1";
const COR_FALLBACK = "#9ca3af";

let _cats: CatDef[] = CATEGORIAS_DEFAULT.slice();
let _corMap: Record<string, string> = Object.fromEntries(_cats.map((c) => [c.nome, c.cor]));

/** Substitui o registry de categorias (chamado pelo CategoriasProvider ao carregar/editar). */
export function setCategoriasRegistry(cats: CatDef[]): void {
  _cats = cats.slice();
  _corMap = Object.fromEntries(_cats.map((c) => [c.nome, c.cor]));
}

/** Nomes das categorias na ORDEM atual (sem a opção vazia). */
export function getCategorias(): string[] {
  return _cats.map((c) => c.nome);
}

/** Registry completo (nome + cor) na ordem atual. */
export function getCategoriasDef(): CatDef[] {
  return _cats;
}

// paleta usada nas paletas/swatches da aba Categorias (cores distintas e legíveis)
export const PALETA_CORES = [
  "#6d28d9", "#7c3aed", "#a855f7", "#2f6df6", "#0ea5e9", "#0891b2", "#16a34a",
  "#059669", "#f59e0b", "#f97316", "#e0382b", "#db2777", "#ec4899", "#b45309",
  "#a16207", "#64748b", "#334155", "#94a3b8", "#9ca3af",
];

export const corCategoria = (c: string) =>
  c === "Sem categoria" ? COR_SEM_CATEGORIA : _corMap[c] || COR_FALLBACK;
