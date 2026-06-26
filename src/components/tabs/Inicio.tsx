import { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, Tooltip } from "recharts";
import type { Aba, Lancamento } from "../../types";
import { Panel, BarRow, Select, Seg } from "../ui";
import { useChart, ChartTip } from "../../lib/theme";
import { sb } from "../../lib/supabase";
import {
  BRL, BRL0, catKey, corCategoria, ehGasto, ehReceita, dvGasto, dvDataReal,
  dvDiasNoMes, dvLabel, MES_ABREV, mesCurto, normEstab,
} from "../../lib/finance";
import { type Plano, projetar, contribNoMes, ehReceitaTipo } from "../../lib/projecao";

interface Props {
  dados: Lancamento[];
  allDados: Lancamento[];
  months: string[];
  openModal: (t: string, r: Lancamento[]) => void;
  go: (a: Aba) => void;
}

// valor grande da coluna da direita
function BigVal({
  label, value, sub, accent = "", dot, onClick,
}: { label: string; value: string; sub?: string; accent?: string; dot?: string; onClick?: () => void }) {
  const Tag: any = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={`w-full text-left block py-[14px] first:pt-0 last:pb-0 bg-transparent border-0 ${onClick ? "cursor-pointer group" : ""}`}
    >
      <div className="flex items-center gap-[6px] text-muted text-[12px] font-medium">
        {dot && <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: dot }} />}
        <span className={onClick ? "group-hover:text-accent transition-colors" : ""}>{label}</span>
        {onClick && <span className="text-muted text-[14px] leading-none ml-auto" aria-hidden>›</span>}
      </div>
      <div className={`text-[25px] sm:text-[29px] font-semibold tracking-tight tabular-nums mt-[3px] leading-none ${accent}`}>{value}</div>
      {sub && <div className="text-[11.5px] text-muted mt-[3px]">{sub}</div>}
    </Tag>
  );
}

function ActionRow({ label, detail, onClick, tone = "amber" }: { label: string; detail?: string; onClick: () => void; tone?: "amber" | "red" }) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 px-0 py-[11px] bg-transparent border-0 cursor-pointer text-left group">
      <span className={`w-[7px] h-[7px] rounded-full shrink-0 ${tone === "red" ? "bg-red" : "bg-amber"}`} />
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-medium group-hover:text-accent transition-colors">{label}</span>
        {detail && <span className="block text-[11.5px] text-muted mt-[1px]">{detail}</span>}
      </span>
      <span className="text-muted text-[16px] leading-none shrink-0" aria-hidden>›</span>
    </button>
  );
}

const JANELAS = [{ v: "3", label: "3m" }, { v: "6", label: "6m" }, { v: "12", label: "12m" }];

export function Inicio({ dados, allDados, months, openModal, go }: Props) {
  const cc = useChart();
  const hoje = new Date();
  const mesAtual = hoje.getFullYear() + "-" + String(hoje.getMonth() + 1).padStart(2, "0");

  // mês escolhido como "atual" e janela da média (em meses)
  const [selKey, setSelKey] = useState("");
  const [janela, setJanela] = useState(3);

  // Série diária por COMPETÊNCIA (mês da fatura/extrato), não pela data da compra.
  // Assim cada parcela conta no mês em que cai na fatura (sofá 12x = 1 parcela/mês),
  // e o total do mês bate com a fatura + extrato — cartão e conta juntos.
  // O dia (eixo x) vem da data_mov; sem data válida, cai no dia 1.
  const compSeries = useMemo(() => {
    const map: Record<string, number[]> = {};
    for (const d of dados) {
      const g = dvGasto(d);
      if (!g) continue;
      const k = String(d.competencia || "").slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(k)) continue;
      const m = String(d.data_mov || "").match(/^(\d{1,2})\/(\d{1,2})$/);
      let dia = m ? +m[1] : 1;
      if (!(dia >= 1 && dia <= 31)) dia = 1;
      (map[k] = map[k] || new Array(31).fill(0))[dia - 1] += g;
    }
    return map;
  }, [dados]);

  // meses disponíveis para escolher (por competência) + o mês civil atual
  const mesesOpc = useMemo(() => {
    const ks = new Set(Object.keys(compSeries));
    ks.add(mesAtual);
    return [...ks].filter((k) => k <= mesAtual).sort().reverse();
  }, [compSeries, mesAtual]);

  // default / correção do mês selecionado: o mais recente disponível (= mês atual)
  useEffect(() => {
    if (selKey && mesesOpc.includes(selKey)) return;
    setSelKey(mesesOpc[0] || mesAtual);
  }, [mesesOpc, selKey, mesAtual]);

  /* ---------- gasto do mês selecionado vs média da janela ---------- */
  const calc = useMemo(() => {
    if (!selKey) return null;
    const map = compSeries;

    const cum = (k: string) => {
      const nd = dvDiasNoMes(k); const out: number[] = []; let s = 0;
      for (let j = 0; j < nd; j++) { s += map[k]?.[j] || 0; out.push(Math.round(s * 100) / 100); }
      return out;
    };

    const nd = dvDiasNoMes(selKey);
    const isAtual = selKey === mesAtual;
    const completo = selKey < mesAtual; // fatura/extrato do mês já fechou
    const refDay = isAtual ? Math.min(hoje.getDate(), nd) : nd; // "este momento do mês"
    // comparação justa com a média: mês fechado, ou mês corrente comparado no mesmo dia.
    const comparavel = completo || isAtual;

    // benchmark: média acumulada dos N meses fechados ANTERIORES ao selecionado
    const base = Object.keys(map).filter((k) => k < selKey).sort().slice(-janela);
    const bench: (number | null)[] = [];
    for (let j = 0; j < 31; j++) {
      let s = 0, c = 0;
      base.forEach((k) => { const a = cum(k); const v = j < a.length ? a[j] : a[a.length - 1]; if (v != null) { s += v; c++; } });
      bench.push(c ? Math.round((s / c) * 100) / 100 : null);
    }
    let benchFim = 0;
    for (let j = nd - 1; j >= 0; j--) if (bench[j] != null) { benchFim = bench[j] as number; break; }
    const benchAtRef = bench[refDay - 1]; // esperado no mesmo ponto do mês

    const selArr = cum(selKey);
    const gastoAtual = selArr[refDay - 1] || 0;
    const delta = benchAtRef != null ? gastoAtual - benchAtRef : null;

    const serieNome = dvLabel(selKey);
    const benchNome = `Média ${janela}m`;
    const chart = Array.from({ length: nd }, (_, i) => ({
      dia: i + 1,
      [serieNome]: isAtual && i + 1 > refDay ? null : selArr[i],
      [benchNome]: bench[i],
    }));

    return {
      selKey, isAtual, completo, comparavel, nd, refDay, gastoAtual, benchAtRef: benchAtRef ?? null, benchFim,
      delta, chart, serieNome, benchNome, temBench: base.length > 0, nBase: base.length,
    };
  }, [compSeries, selKey, janela, mesAtual, hoje]);

  /* ---------- top categorias do mês selecionado (por competência) ---------- */
  const topCats = useMemo(() => {
    if (!calc) return { rows: [] as { cat: string; val: number; itens: Lancamento[] }[], total: 0 };
    const tot: Record<string, number> = {};
    const itens: Record<string, Lancamento[]> = {};
    dados.forEach((d) => {
      const g = dvGasto(d); if (!g) return;
      if (String(d.competencia || "").slice(0, 7) !== calc.selKey) return;
      const k = catKey(d);
      tot[k] = (tot[k] || 0) + g;
      (itens[k] = itens[k] || []).push(d);
    });
    const rows = Object.keys(tot)
      .map((cat) => ({ cat, val: tot[cat], itens: itens[cat] }))
      .filter((x) => x.val > 0)
      .sort((a, b) => b.val - a.val);
    return { rows: rows.slice(0, 6), total: rows.reduce((s, x) => s + x.val, 0) };
  }, [dados, calc]);

  /* ---------- últimos lançamentos conhecidos ---------- */
  const ultimos = useMemo(() => {
    const arr: { d: Lancamento; k: string; dia: number }[] = [];
    dados.forEach((d) => {
      if (!ehGasto(d.classe) && !ehReceita(d.classe)) return;
      const r = dvDataReal(d); if (!r) return;
      arr.push({ d, k: r.k, dia: r.d });
    });
    arr.sort((a, b) => (b.k.localeCompare(a.k)) || (b.dia - a.dia) || (b.d.id - a.d.id));
    return arr.slice(0, 7).map((x) => x.d);
  }, [dados]);

  /* ---------- pendências ---------- */
  const pend = useMemo(() => {
    const grupos = new Set<string>(); let classTotal = 0, classN = 0;
    allDados.forEach((d) => {
      if (ehGasto(d.classe) && !d.categoria_manual) { grupos.add(normEstab(d.descricao)); classTotal += Math.abs(d.valor); classN++; }
    });
    const comps = [...new Set(allDados.map((d) => d.competencia))].sort();
    const ult = comps[comps.length - 1];
    const bancos = ["Nubank", "PicPay", "Itau"].filter((b) => allDados.some((d) => d.banco === b));
    let arqFaltam = 0;
    if (ult) bancos.forEach((b) => {
      if (!allDados.some((d) => d.competencia === ult && d.banco === b && String(d.origem || "").startsWith("Cartao"))) arqFaltam++;
      if (!allDados.some((d) => d.competencia === ult && d.banco === b && String(d.origem || "").startsWith("Conta"))) arqFaltam++;
    });
    return { classGrupos: grupos.size, classTotal, classN, arqFaltam, arqMes: ult ? mesCurto(ult) : "" };
  }, [allDados]);

  /* ---------- planos: budget do mês selecionado + pendência de preenchimento ---------- */
  const [planosRaw, setPlanosRaw] = useState<Plano[] | null>(null);
  const [budget, setBudget] = useState<number | null>(null);
  const [orc, setOrc] = useState<{ pend: number; total: number } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await sb.from("planos").select("*").eq("ativo", true);
        setPlanosRaw(error || !data ? [] : (data as Plano[]));
      } catch { setPlanosRaw([]); }
    })();
  }, []);

  useEffect(() => {
    if (!planosRaw) return;
    if (!planosRaw.length) { setBudget(null); setOrc(null); return; }
    (async () => {
      try {
        const card = planosRaw.find((p) => (p as any).eh_cartao_total) || null;
        const conta = planosRaw.find((p) => (p as any).eh_conta_total) || null;
        const rec = planosRaw.find((p) => (p as any).eh_receita_total) || null;
        const comuns = planosRaw.filter((p) => p.id !== card?.id && p.id !== conta?.id && p.id !== rec?.id);

        const meses = [...new Set([mesAtual, selKey].filter(Boolean))];
        const { data: mensal } = await sb.from("plano_mensal").select("plano_id,competencia,valor_real").in("competencia", meses);
        const ovr: Record<string, Record<number, number>> = {};
        (mensal || []).forEach((m: any) => { if (m.valor_real != null) (ovr[m.competencia] = ovr[m.competencia] || {})[m.plano_id] = m.valor_real; });

        // budget total (consolidado, sem contar em dobro) do mês selecionado
        if (selKey) {
          const proj = projetar(comuns, [{ k: selKey }], card, conta, rec, ovr);
          const g = proj[0]?.gerais ?? 0;
          setBudget(g > 0 ? g : null);
        }

        // pendência de planejamento: contas do mês civil atual ainda sem valor preenchido
        const gastos = planosRaw.filter((p) => !ehReceitaTipo(p.tipo) && contribNoMes(p, mesAtual) !== 0);
        if (!gastos.length) { setOrc(null); }
        else {
          const ok = new Set(Object.keys(ovr[mesAtual] || {}).map(Number));
          setOrc({ pend: gastos.filter((p) => !ok.has(p.id)).length, total: gastos.length });
        }
      } catch { setBudget(null); setOrc(null); }
    })();
  }, [planosRaw, selKey, mesAtual]);

  if (!calc) return <div className="text-muted p-4">Sem dados ainda — importe os primeiros PDFs para começar.</div>;

  const temPend = pend.classGrupos > 0 || (orc?.pend || 0) > 0 || pend.arqFaltam > 0;
  const roxo = cc.roxoLinha("1");

  // "ainda previsto" — placeholder provisório (cálculo final a definir):
  // o que falta para fechar o budget do mês (ou, sem budget, para alcançar a média).
  const aindaPrev = budget != null ? Math.max(0, budget - calc.gastoAtual)
    : calc.benchFim ? Math.max(0, calc.benchFim - calc.gastoAtual) : null;
  const aindaSub = budget != null ? "provisório · falta p/ o budget"
    : calc.benchFim ? "provisório · falta p/ a média" : "a definir";

  return (
    <div>
      {/* ---------- metade esquerda: gráfico · metade direita: 4 valores ---------- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[18px]">
        {/* gráfico: mês selecionado vs média da janela */}
        <Panel className="!mb-0 flex flex-col">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
            <div className="text-muted text-[12.5px] font-medium min-w-0">
              {dvLabel(calc.selKey)} {calc.completo ? "· fatura fechada" : "· em curso"} vs média {janela}m
            </div>
            <div className="flex items-center gap-[6px] shrink-0">
              <Seg size="sm" value={String(janela)} onChange={(v) => setJanela(+v)} options={JANELAS} />
              <Select value={selKey} onChange={setSelKey} className="!py-[6px] text-[12.5px]">
                {mesesOpc.map((k) => <option key={k} value={k}>{dvLabel(k)}{k === mesAtual ? " (atual)" : ""}</option>)}
              </Select>
            </div>
          </div>

          <div className="h-[200px] sm:h-[230px] mt-2 -ml-1 min-w-0 flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={calc.chart} margin={{ top: 6, right: 4, left: 4, bottom: 0 }}>
                <defs>
                  <linearGradient id="heroGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={roxo} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={roxo} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="dia" hide />
                <YAxis hide domain={[0, "auto"]} />
                <Tooltip content={<ChartTip labelPrefix="Dia " />} />
                <Line type="monotone" dataKey={calc.benchNome} stroke={cc.media} strokeWidth={2} strokeDasharray="4 4" dot={false} connectNulls isAnimationActive={false} />
                <Area type="monotone" dataKey={calc.serieNome} stroke={roxo} strokeWidth={2.5} fill="url(#heroGrad)" dot={false} connectNulls={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2">
            <span className="inline-flex items-center gap-[6px] text-[11.5px] text-muted">
              <span className="w-[10px] h-[3px] rounded-full" style={{ background: roxo }} />{dvLabel(calc.selKey)}
            </span>
            <span className="inline-flex items-center gap-[6px] text-[11.5px] text-muted">
              <span className="w-[10px] h-0 border-t-2 border-dashed" style={{ borderColor: cc.media }} />Média {janela}m
            </span>
            {calc.delta != null && calc.comparavel && (
              <span className={`inline-flex items-center gap-1 rounded-full px-[10px] py-[3px] text-[12px] font-semibold ${
                calc.delta <= 0 ? "bg-green/10 text-green" : "bg-red/10 text-red"
              }`}>
                {calc.delta <= 0 ? "▼" : "▲"} {BRL(Math.abs(calc.delta))} {calc.delta <= 0 ? "abaixo" : "acima"} da média{calc.isAtual ? " (no mesmo dia)" : ""}
              </span>
            )}
            {calc.delta != null && !calc.comparavel && (
              <span className="inline-flex items-center gap-1 rounded-full px-[10px] py-[3px] text-[12px] font-medium bg-fill text-muted">
                comparação parcial · faltam faturas
              </span>
            )}
          </div>
          <div className="text-[11.5px] text-muted mt-2">
            Pela competência (fatura/extrato do mês), cartão + contas — parcelas contam no mês em que caem na fatura.{!calc.completo ? " Mês ainda em curso." : ""}
          </div>
        </Panel>

        {/* 4 valores grandes */}
        <Panel className="!mb-0">
          <div className="divide-y divide-line">
            <BigVal
              label={`Gasto atual · ${dvLabel(calc.selKey)}`}
              value={BRL0(calc.gastoAtual)}
              sub={calc.isAtual ? `até hoje · dia ${calc.refDay}/${calc.nd}` : "fatura + extrato do mês"}
              dot={roxo}
            />
            <BigVal
              label="Esperado para este momento"
              value={calc.benchAtRef != null ? BRL0(calc.benchAtRef) : "—"}
              sub={calc.temBench ? `média ${janela}m no mesmo ponto · fim ~${BRL0(calc.benchFim)}` : "sem meses completos p/ comparar"}
              dot={cc.media}
            />
            <BigVal
              label="Ainda previsto no mês"
              value={aindaPrev != null ? BRL0(aindaPrev) : "—"}
              sub={aindaSub}
            />
            <BigVal
              label="Budget total do mês"
              value={budget != null ? BRL0(budget) : "—"}
              sub={budget != null ? "planejamento do mês" : "definir no Planejamento"}
              onClick={() => go("planejamento")}
            />
          </div>
        </Panel>
      </div>

      {/* ---------- pendências ---------- */}
      {temPend && (
        <Panel title="Pendências" className="!mb-0 mt-[18px]">
          <div className="divide-y divide-line">
            {pend.classGrupos > 0 && (
              <ActionRow
                label={`Classificar ${pend.classGrupos} ${pend.classGrupos === 1 ? "estabelecimento" : "estabelecimentos"}`}
                detail={`${pend.classN} lançamentos · ${BRL(pend.classTotal)}`}
                onClick={() => go("classificar")}
              />
            )}
            {(orc?.pend || 0) > 0 && (
              <ActionRow
                label={`Planejamento: ${orc!.pend} ${orc!.pend === 1 ? "conta sem valor" : "contas sem valor"} em ${MES_ABREV[hoje.getMonth()]}`}
                detail={`${orc!.total - orc!.pend} de ${orc!.total} preenchidas`}
                onClick={() => go("planejamento")}
              />
            )}
            {pend.arqFaltam > 0 && (
              <ActionRow
                label={`${pend.arqFaltam} ${pend.arqFaltam === 1 ? "documento pendente" : "documentos pendentes"} · ${pend.arqMes}`}
                detail="faturas/extratos ainda não importados"
                onClick={() => go("lanc")}
              />
            )}
          </div>
        </Panel>
      )}

      {/* ---------- top categorias + últimos lançamentos ---------- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[18px] mt-[18px]">
        <Panel
          title="Onde foi o dinheiro"
          sub={`(${dvLabel(calc.selKey)} · clique p/ detalhar)`}
          right={
            <button onClick={() => go("mensal")} className="bg-transparent border-0 text-accent text-[12.5px] font-medium cursor-pointer p-0 hover:underline">
              Resumo completo ›
            </button>
          }
        >
          {topCats.rows.length ? (
            <div className="space-y-[14px] mt-2">
              {topCats.rows.map((c) => (
                <BarRow
                  key={c.cat}
                  label={c.cat}
                  value={c.val}
                  max={topCats.rows[0].val}
                  color={corCategoria(c.cat)}
                  right={`${BRL(c.val)} · ${topCats.total ? Math.round((c.val / topCats.total) * 100) : 0}%`}
                  onClick={() => openModal(`${c.cat} · ${dvLabel(calc.selKey)}`, c.itens)}
                />
              ))}
            </div>
          ) : (
            <div className="text-muted text-[13px] py-2">Sem gastos registrados neste mês.</div>
          )}
        </Panel>

        <Panel
          title="Últimos lançamentos"
          sub="(pela data da compra)"
          right={
            <button onClick={() => go("lanc")} className="bg-transparent border-0 text-accent text-[12.5px] font-medium cursor-pointer p-0 hover:underline">
              Ver todos ›
            </button>
          }
        >
          <div className="divide-y divide-line">
            {ultimos.map((d) => (
              <div key={d.id} className="flex items-center gap-3 py-[9px] min-w-0">
                <span className="w-[8px] h-[8px] rounded-full shrink-0" style={{ background: corCategoria(catKey(d)) }} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium truncate">{d.descricao}</div>
                  <div className="text-[11.5px] text-muted truncate">{d.data_mov} · {catKey(d)} · {d.origem}</div>
                </div>
                <div className={`tabular-nums text-[13px] font-medium shrink-0 ${ehReceita(d.classe) || d.valor > 0 ? "text-green" : ""}`}>
                  {BRL(d.valor)}
                </div>
              </div>
            ))}
            {!ultimos.length && <div className="text-muted text-[13px] py-2">Nada por aqui ainda.</div>}
          </div>
        </Panel>
      </div>
    </div>
  );
}
