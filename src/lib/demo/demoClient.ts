import { buildDemoData, type DemoDb } from "./fakeData";

/* ============================================================================
   Cliente Supabase FAKE para o "Acesso teste" (modo demo).

   Implementa o subconjunto da API do supabase-js que o app realmente usa:
     • auth: getSession / getUser / onAuthStateChange / signInWithOAuth / signOut
     • from(table) com um query-builder encadeável e "thenable":
         select / insert / update / upsert / delete
         eq / in / order / range / limit / single / maybeSingle / count+head

   Os dados vivem só em memória (fakeData) e as mutações persistem durante a
   sessão (some ao recarregar a página). NADA disso vai para a rede/Supabase.
   ============================================================================ */

type Row = Record<string, unknown>;
interface Result<T = unknown> { data: T; error: { message: string } | null; count?: number | null }

// tabelas cujo id é numérico autoincremento (geramos id no insert quando ausente)
const TABELAS_ID_NUM = new Set(["lancamentos", "categorias", "subcategorias", "planos"]);

function cmp(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

type Op = "select" | "insert" | "update" | "upsert" | "delete";
type Filtro = ["eq" | "in" | "not", string, unknown];

class Query<T = unknown> implements PromiseLike<Result<T>> {
  private op: Op = "select";
  private cols = "*";
  private filtros: Filtro[] = [];
  private ordens: [string, boolean][] = [];
  private faixa: [number, number] | null = null;
  private lim: number | null = null;
  private umSo = false;
  private talvezUm = false;
  private comHead = false;
  private comCount = false;
  private retornar = false;
  private payload: Row | Row[] | null = null;
  private onConflict: string | null = null;

  constructor(private table: string, private db: DemoDb, private nextId: () => number) {}

  select(cols = "*", opts?: { count?: string; head?: boolean }): this {
    this.cols = cols;
    this.retornar = true;
    if (opts?.count) this.comCount = true;
    if (opts?.head) this.comHead = true;
    return this;
  }
  insert(payload: Row | Row[]): this { this.op = "insert"; this.payload = payload; return this; }
  update(payload: Row): this { this.op = "update"; this.payload = payload; return this; }
  upsert(payload: Row | Row[], opts?: { onConflict?: string }): this {
    this.op = "upsert"; this.payload = payload; this.onConflict = opts?.onConflict ?? null; return this;
  }
  delete(): this { this.op = "delete"; return this; }
  eq(col: string, val: unknown): this { this.filtros.push(["eq", col, val]); return this; }
  in(col: string, vals: unknown[]): this { this.filtros.push(["in", col, vals]); return this; }
  // negação — só usamos `.not(col, "is", null)` (col IS NOT NULL); guardamos o valor negado
  not(col: string, _op: string, val: unknown): this { this.filtros.push(["not", col, val]); return this; }
  // `.is(col, null)` (col IS NULL) — trata null e undefined como "sem valor"
  is(col: string, val: unknown): this { this.filtros.push(["is", col, val]); return this; }
  order(col: string, opts?: { ascending?: boolean }): this { this.ordens.push([col, opts?.ascending !== false]); return this; }
  range(de: number, ate: number): this { this.faixa = [de, ate]; return this; }
  limit(n: number): this { this.lim = n; return this; }
  single(): this { this.umSo = true; this.retornar = true; return this; }
  maybeSingle(): this { this.talvezUm = true; this.retornar = true; return this; }

  // torna o builder "awaitable" (como o supabase-js)
  then<R1 = Result<T>, R2 = never>(
    onF?: ((v: Result<T>) => R1 | PromiseLike<R1>) | null,
    onR?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    return this.run().then(onF, onR);
  }

  private tabela(): Row[] {
    if (!this.db[this.table]) this.db[this.table] = [];
    return this.db[this.table];
  }
  private filtrar(rows: Row[]): Row[] {
    return rows.filter((r) =>
      this.filtros.every(([t, c, v]) => {
        if (t === "eq") return r[c] === v;
        if (t === "in") return Array.isArray(v) && v.includes(r[c]);
        if (t === "is") return v === null ? r[c] == null : r[c] === v;
        // "not": negação do valor — usado como `.not(col, "is", null)` => col != null
        return v === null ? r[c] != null : r[c] !== v;
      }),
    );
  }
  private precisaId(): boolean { return TABELAS_ID_NUM.has(this.table); }

  private async run(): Promise<Result<T>> {
    try {
      const tbl = this.tabela();
      switch (this.op) {
        case "select": return this.runSelect(tbl) as Result<T>;
        case "insert": return this.runInsert(tbl) as Result<T>;
        case "update": return this.runUpdate(tbl) as Result<T>;
        case "upsert": return this.runUpsert(tbl) as Result<T>;
        case "delete": return this.runDelete(tbl) as Result<T>;
      }
    } catch (e) {
      return { data: (this.umSo || this.talvezUm ? null : []) as T, error: { message: (e as Error).message } };
    }
  }

  private runSelect(tbl: Row[]): Result {
    let rows = this.filtrar(tbl);
    const total = rows.length;
    if (this.comHead && this.comCount) return { data: null, error: null, count: total };
    // ordena respeitando a precedência (1ª ordem = mais significativa)
    for (let i = this.ordens.length - 1; i >= 0; i--) {
      const [col, asc] = this.ordens[i];
      rows = rows.slice().sort((a, b) => cmp(a[col], b[col]) * (asc ? 1 : -1));
    }
    if (this.faixa) rows = rows.slice(this.faixa[0], this.faixa[1] + 1);
    if (this.lim != null) rows = rows.slice(0, this.lim);
    const clone = rows.map((r) => ({ ...r }));
    if (this.umSo) return { data: clone[0] ?? null, error: clone[0] ? null : { message: "No rows found" } };
    if (this.talvezUm) return { data: clone[0] ?? null, error: null };
    return { data: clone, error: null, count: this.comCount ? total : undefined };
  }

  private runInsert(tbl: Row[]): Result {
    const entrada = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
    const inseridas = entrada.map((r) => {
      const row = { ...r };
      if (row.id == null && this.precisaId()) row.id = this.nextId();
      tbl.push(row);
      return row;
    });
    return this.saida(inseridas);
  }

  private runUpdate(tbl: Row[]): Result {
    const alvo = this.filtrar(tbl);
    for (const r of alvo) Object.assign(r, this.payload);
    return this.saida(alvo);
  }

  private runUpsert(tbl: Row[]): Result {
    const entrada = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
    const chaves = this.onConflict ? this.onConflict.split(",").map((s) => s.trim()) : ["id"];
    const out: Row[] = [];
    for (const r of entrada) {
      const existente = tbl.find((x) => chaves.every((k) => x[k] === r[k]));
      if (existente) { Object.assign(existente, r); out.push(existente); }
      else {
        const row = { ...r };
        if (row.id == null && this.precisaId()) row.id = this.nextId();
        tbl.push(row);
        out.push(row);
      }
    }
    return this.saida(out);
  }

  private runDelete(tbl: Row[]): Result {
    const remover = new Set(this.filtrar(tbl));
    this.db[this.table] = tbl.filter((r) => !remover.has(r));
    return { data: null, error: null };
  }

  // formata o retorno de insert/update/upsert conforme select()/single() pedidos
  private saida(rows: Row[]): Result {
    if (!this.retornar) return { data: null, error: null };
    if (this.umSo) return { data: rows[0] ? { ...rows[0] } : null, error: rows[0] ? null : { message: "No rows" } };
    if (this.talvezUm) return { data: rows[0] ? { ...rows[0] } : null, error: null };
    return { data: rows.map((r) => ({ ...r })), error: null };
  }
}

export interface DemoClient {
  auth: {
    getSession: () => Promise<{ data: { session: unknown }; error: null }>;
    getUser: () => Promise<{ data: { user: unknown }; error: null }>;
    onAuthStateChange: (cb: unknown) => { data: { subscription: { unsubscribe: () => void } } };
    signInWithOAuth: () => Promise<{ data: Record<string, never>; error: null }>;
    signOut: () => Promise<{ error: null }>;
  };
  from: (table: string) => Query;
}

/** Cria um cliente fake com a base demo carregada de forma preguiçosa. */
export function createDemoClient(): DemoClient {
  let db: DemoDb | null = null;
  const getDb = () => (db ??= buildDemoData());
  let seq = 900000;
  const nextId = () => ++seq;

  const user = { id: "demo-user", email: "demo@exemplo.com", user_metadata: { name: "Conta Demonstração" } };
  const session = { access_token: "demo-token", token_type: "bearer", expires_in: 3600, user };

  return {
    auth: {
      async getSession() { return { data: { session }, error: null }; },
      async getUser() { return { data: { user }, error: null }; },
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
      async signInWithOAuth() { return { data: {}, error: null }; },
      async signOut() { return { error: null }; },
    },
    from(table: string) { return new Query(table, getDb(), nextId); },
  };
}
