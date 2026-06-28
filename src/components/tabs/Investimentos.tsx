import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, PieChart, Pie, Cell,
} from "recharts";
import type { Investimento, InvestimentoHist, InvestimentoHistTipo } from "../../types";
import { Kpi, Panel, Select, BarRow } from "../ui";
import { useChart, ChartTip } from "../../lib/theme";
import { listInvestments, listInvestmentHistory, listInvestmentHistoryByTipo, syncInvestments, setTipoManual, setLiquidezD1Manual, listSaldoCaixa, type SaldoConta } from "../../lib/pluggy";
import { BRL0, brlShort, fmtMoeda } from "../../lib/finance";
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

interface ColDef {
  key: keyof Investimento;
  label: string;
  num?: boolean;
  mono?: boolean;
  sortable?: boolean;
  render?: (i: Investimento) => ReactNode;
}

function toCsv(rows: Investimento[], cols: ColDef[]): string {
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
          i[c.key],
        ),
      )
      .join(";"),
  );
  return [head, ...body].join("\n");
}

const MAX = 2000;

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

  const [busca, setBusca] = useState("");
  const [fTipo, setFTipo] = useState("");
  const [fBanco, setFBanco] = useState("");
  const [sortCol, setSortCol] = useState<keyof Investimento>("saldo");
  const [sortDir, setSortDir] = useState(-1);

  const carregar = useCallback(async () => {
    setStatus("carregando…");
    setErro("");
    try {
      const [inv, h, ht, cx] = await Promise.all([
        listInvestments(),
        listInvestmentHistory(),
        listInvestmentHistoryByTipo().catch(() => [] as InvestimentoHistTipo[]),
        listSaldoCaixa().catch(() => [] as SaldoConta[]),
      ]);
      setRows(inv);
      setHist(h);
      setHistTipo(ht);
      setCaixa(cx);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setStatus("");
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

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

  // Crescimento do patrimônio (MoM / YTD / YoY) a partir do histórico diário.
  // Base de cada métrica: o retrato mais recente NA ou ANTES da data-âncora
  //  - MoM: fim do mês anterior;  - YTD: virada do ano;  - YoY: ~12 meses atrás.
  // Sem um retrato no período, cai no retrato mais antigo disponível (rótulo
  // "desde dd/mm/aa" deixa a base explícita) — assim os cards já têm valor e vão
  // se ajustando à medida que o histórico cresce. É a carteira inteira (não os
  // filtros), pois o histórico é gravado para o patrimônio todo.
  const cresc = useMemo(() => {
    const pts = hist.filter((h) => h.valor_total != null) as { dia: string; valor_total: number }[];
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
  }, [hist]);

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

  // composição do patrimônio: tipos de investimento + (opcional) o Caixa
  const composicao = useMemo(() => {
    if (!mostraCaixa) return porTipo;
    return [...porTipo, { tipo: "CAIXA", label: "Caixa", total: caixaTotal, cor: CAIXA_COR }]
      .sort((a, b) => b.total - a.total);
  }, [porTipo, mostraCaixa, caixaTotal]);

  // série de evolução do patrimônio (histórico diário)
  const serie = useMemo(
    () => hist.map((h) => ({
      dia: h.dia,
      Patrimônio: Math.round((h.valor_total ?? 0) * 100) / 100,
      Aplicado: Math.round((h.valor_aplicado ?? 0) * 100) / 100,
    })),
    [hist]
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
    const diasReais = [...new Set(histTipo.map((r) => r.dia))].sort();
    if (diasReais.length >= 2) {
      const tiposReais = new Set(histTipo.map((r) => r.tipo));
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
      for (const r of histTipo) {
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
  }, [histTipo, serie, porTipo, corPorTipo, kpis.atual]);

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
    { key: "nome", label: "Investimento", sortable: true, render: (i) => <span title={i.nome ?? ""}>{cell(i.nome)}</span> },
    { key: "tipo", label: "Tipo (Pluggy)", sortable: true, render: (i) => labelTipo(i.tipo) },
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
    { key: "saldo", label: "Valor atual", num: true, sortable: true, render: (i) => (i.saldo != null ? fmtMoeda(i.saldo, moedaDe(i)) : "—") },
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
          aba <strong>Conectar</strong> e clique em <strong>Sincronizar investimentos</strong>.
        </p>
        {erro && <div className="text-[13px] text-red bg-fill rounded-[10px] px-3 py-2 mt-4 max-w-[560px] mx-auto">Erro: {erro}</div>}
        {msg && <div className="text-[13px] text-txt bg-fill rounded-[10px] px-3 py-2 mt-3 max-w-[560px] mx-auto">{msg}</div>}
        <div className="mt-4">{btnSync}</div>
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-[14px] mb-[18px]">
        <Kpi
          title="Patrimônio total"
          value={BRL0(totalPatrimonio)}
          sub={caixaShown > 0
            ? `${BRL0(kpis.atual)} investido · ${BRL0(caixaShown)} em caixa`
            : `${BRL0(kpis.liquidoD1)} com liquidez D+1 (${kpis.pctLiquido.toFixed(0)}%)`}
          color="text-violet"
        />
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
        {btnSync}
      </div>

      {erro && <div className="text-[13px] text-red bg-fill rounded-[10px] px-3 py-2 mb-3">Erro: {erro}</div>}
      {msg && <div className="text-[13px] text-txt bg-fill rounded-[10px] px-3 py-2 mb-3">{msg}</div>}

      <div className="bg-card border border-line rounded-[18px] shadow-card overflow-hidden">
        <div className="max-h-[620px] overflow-auto scroll-thin">
          <table className="tbl min-w-[1240px] text-[12.5px]">
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
    </div>
  );
}
