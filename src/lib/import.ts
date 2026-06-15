import { MES_ABREV } from "./finance";
import { sb } from "./supabase";

/* papaparse (CSV) e xlsx (Excel) são pesados e só fazem sentido na
   importação — carregamos sob demanda para não inflar o bundle principal. */

/* ============================================================
   Importação de extratos/planilhas (Fase 1: CSV, Excel, OFX)
   Roda 100% no navegador. Normaliza para o schema de `lancamentos`
   e deduplica por um hash_natural determinístico.
   ============================================================ */

export type FileKind = "csv" | "xlsx" | "ofx";

export interface ParsedFile {
  kind: FileKind;
  columns: string[]; // cabeçalhos detectados (vazio só não acontece; OFX já vem fixo)
  rows: Record<string, any>[]; // linhas cruas, indexadas pelo cabeçalho
}

export interface MapConfig {
  data: string;
  descricao: string;
  valor: string;
}

export interface BuildOpts {
  banco: string;
  tipo: "Cartao" | "Conta";
  inverterSinal: boolean; // bancos que exportam gasto como positivo
}

/** Linha pronta para inserir em `lancamentos` (user_id vem do default auth.uid()). */
export interface InsertRow {
  hash_natural: string;
  competencia: string;
  ano: number;
  mes: number;
  banco: string;
  origem: string;
  data_mov: string;
  descricao: string;
  detalhe: string | null;
  classe: string;
  categoria_auto: string | null;
  valor: number;
  natureza: string;
}

// ---------- parse de arquivo ----------

export async function parseFile(file: File): Promise<ParsedFile> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".ofx") || name.endsWith(".qfx")) {
    return { kind: "ofx", columns: OFX_COLS, rows: parseOfx(await file.text()) };
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json<any[]>(ws, {
      header: 1, raw: false, dateNF: "yyyy-mm-dd", blankrows: false,
    });
    return aoaToParsed(aoa, "xlsx");
  }
  // csv / tsv / txt
  const Papa = (await import("papaparse")).default;
  const res = Papa.parse<any[]>(await file.text(), { skipEmptyLines: "greedy" });
  return aoaToParsed(res.data, "csv");
}

const OFX_COLS = ["Data", "Descrição", "Valor"];

function aoaToParsed(aoa: any[][], kind: FileKind): ParsedFile {
  const clean = (aoa || []).filter((r) => Array.isArray(r) && r.some((c) => String(c ?? "").trim() !== ""));
  if (!clean.length) return { kind, columns: [], rows: [] };
  const header = clean[0].map((c, i) => String(c ?? "").trim() || `Coluna ${i + 1}`);
  const rows = clean.slice(1).map((r) => {
    const o: Record<string, any> = {};
    header.forEach((h, i) => { o[h] = r[i]; });
    return o;
  });
  return { kind, columns: header, rows };
}

// OFX é SGML/XML; tags muitas vezes vêm sem fechamento. Lemos por bloco STMTTRN.
function parseOfx(text: string): Record<string, any>[] {
  const tag = (s: string, t: string) => {
    const m = s.match(new RegExp(`<${t}>([^<\\r\\n]*)`, "i"));
    return m ? m[1].trim() : "";
  };
  return text.split(/<STMTTRN>/i).slice(1).map((b) => ({
    [OFX_COLS[0]]: ofxDate(tag(b, "DTPOSTED")),
    [OFX_COLS[1]]: tag(b, "MEMO") || tag(b, "NAME"),
    [OFX_COLS[2]]: tag(b, "TRNAMT"),
  })).filter((r) => r[OFX_COLS[0]] && r[OFX_COLS[2]] !== "");
}
const ofxDate = (s: string) => {
  const m = String(s).match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
};

// ---------- adivinhação de colunas ----------

export function guessMap(columns: string[]): MapConfig {
  const find = (...keys: string[]) =>
    columns.find((c) => keys.some((k) => c.toLowerCase().includes(k))) || "";
  return {
    data: find("data", "date", "dt") || columns[0] || "",
    descricao: find("desc", "histó", "histor", "lançamento", "lancamento", "memo", "estabelec", "título", "titulo", "name") || columns[1] || "",
    valor: find("valor", "amount", "vlr", "value", "montante", "quantia") || columns[2] || "",
  };
}

// ---------- parsers de campo ----------

export function parseData(v: any): { yyyy: number; mm: number; dd: number } | null {
  if (v == null || v === "") return null;
  const ok = (d: { yyyy: number; mm: number; dd: number } | null) =>
    d && d.mm >= 1 && d.mm <= 12 && d.dd >= 1 && d.dd <= 31 && d.yyyy >= 1900 && d.yyyy <= 2200 ? d : null;
  if (v instanceof Date && !isNaN(v.getTime()))
    return ok({ yyyy: v.getFullYear(), mm: v.getMonth() + 1, dd: v.getDate() });
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); // ISO
  if (m) return ok({ yyyy: +m[1], mm: +m[2], dd: +m[3] });
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/); // dd/mm/aaaa (BR)
  if (m) { let y = +m[3]; if (y < 100) y += 2000; return ok({ yyyy: y, mm: +m[2], dd: +m[1] }); }
  if (/^\d+(\.\d+)?$/.test(s)) { // serial do Excel
    const n = +s;
    if (n > 59 && n < 100000) {
      const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
      return ok({ yyyy: d.getUTCFullYear(), mm: d.getUTCMonth() + 1, dd: d.getUTCDate() });
    }
  }
  return null;
}

export function parseValor(v: any): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return isNaN(v) ? null : v;
  let s = String(v).trim();
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); } // (123,45) = negativo
  s = s.replace(/[R$\s]/gi, "");
  if (s.includes("-")) neg = true;
  s = s.replace(/-/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", "."); // pt-BR: . milhar, , decimal
  const n = parseFloat(s);
  if (isNaN(n)) return null;
  return neg ? -Math.abs(n) : n;
}

// ---------- normalização para o schema ----------

const normTxt = (s: string) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();

// hash determinístico (djb2 + sdbm) — estável para deduplicar
function hashNatural(s: string): string {
  let a = 5381, b = 52711;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = (a * 33 + c) | 0;
    b = (b * 33) ^ c;
  }
  return "imp_" + (a >>> 0).toString(36) + (b >>> 0).toString(36);
}

export function buildRow(
  date: { yyyy: number; mm: number; dd: number }, descricao: string, valorRaw: number, opts: BuildOpts
): InsertRow {
  const valor = opts.inverterSinal ? -valorRaw : valorRaw;
  const { yyyy, mm, dd } = date;
  const mm2 = String(mm).padStart(2, "0");
  const dd2 = String(dd).padStart(2, "0");
  const competencia = `${yyyy}-${mm2} (${MES_ABREV[mm - 1]}/${String(yyyy).slice(2)})`;
  const origem = `${opts.tipo} ${opts.banco}`;
  const classe = valor < 0 ? "Gasto" : valor > 0 ? "Receita" : "Transferencia/Pagamento";
  const desc = String(descricao || "").trim().slice(0, 200) || "(sem descrição)";
  return {
    hash_natural: hashNatural(`${opts.banco}|${origem}|${yyyy}-${mm2}-${dd2}|${valor.toFixed(2)}|${normTxt(desc)}`),
    competencia, ano: yyyy, mes: mm, banco: opts.banco, origem,
    data_mov: `${dd2}/${mm2}`, descricao: desc, detalhe: null,
    classe, categoria_auto: null, valor, natureza: "Pessoal",
  };
}

export interface BuildResult { rows: InsertRow[]; validas: number; invalidas: number; }

export function buildAll(parsed: ParsedFile, map: MapConfig, opts: BuildOpts): BuildResult {
  const rows: InsertRow[] = [];
  const seen = new Set<string>();
  let invalidas = 0;
  for (const r of parsed.rows) {
    const d = parseData(r[map.data]);
    const v = parseValor(r[map.valor]);
    if (!d || v == null) { invalidas++; continue; }
    const row = buildRow(d, String(r[map.descricao] ?? ""), v, opts);
    if (seen.has(row.hash_natural)) continue; // duplicata dentro do próprio arquivo
    seen.add(row.hash_natural);
    rows.push(row);
  }
  return { rows, validas: rows.length, invalidas };
}

// ---------- inserção com deduplicação contra o banco ----------

export interface ImportResult { inseridos: number; duplicados: number; erro?: string }

export async function importarRows(rows: InsertRow[]): Promise<ImportResult> {
  const existentes = new Set<string>();
  const PAG = 1000;
  for (let de = 0; ; de += PAG) {
    const { data, error } = await sb.from("lancamentos").select("hash_natural").range(de, de + PAG - 1);
    if (error) return { inseridos: 0, duplicados: 0, erro: error.message };
    (data || []).forEach((x: any) => existentes.add(x.hash_natural));
    if (!data || data.length < PAG) break;
  }
  const novos = rows.filter((r) => !existentes.has(r.hash_natural));
  const duplicados = rows.length - novos.length;
  for (let i = 0; i < novos.length; i += 500) {
    const { error } = await sb.from("lancamentos").insert(novos.slice(i, i + 500));
    if (error) return { inseridos: i, duplicados, erro: error.message };
  }
  return { inseridos: novos.length, duplicados };
}
