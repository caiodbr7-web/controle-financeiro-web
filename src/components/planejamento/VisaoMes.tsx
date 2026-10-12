import { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from "recharts";
import { BRL, BRL0, brlShort, dvAddMes, dvDiasNoMes } from "../../lib/finance";
import { type Plano, contribNoMes, ehReceitaTipo, mesAtual } from "../../lib/projecao";
import {
  type AutosMap, type Ocorrencia, DIAS_SEM, STATUS_INFO, aPagar, dataCurta, fluxoMes, hoje0, mesLongo, ocorrencia, ocorrenciasMes,
} from "../../lib/agenda";
import { useChart } from "../../lib/theme";
import { listSaldoCaixa } from "../../lib/pluggy";
import { Kpi } from "../ui";
import { useToast } from "../Toast";
import { Copiar, StatusBadge, fmtN, inp, parseValorBR } from "./comum";
import type { PlanejamentoApi } from "./usePlanejamento";

// preferências do gráfico de fluxo (conveniência local deste navegador)
const LS_FLUXO = "cf_plan_fluxo";
function lerPrefs(): { saldo: number | null; diaReceita: number } {
  try {
    const v = JSON.parse(localStorage.getItem(LS_FLUXO) || "{}");
    return { saldo: typeof v.saldo === "number" ? v.saldo : null, diaReceita: v.diaReceita || 5 };
  } catch { return { saldo: null, diaReceita: 5 }; }
}
function gravarPrefs(p: { saldo: number | null; diaReceita: number }) {
  try { localStorage.setItem(LS_FLUXO, JSON.stringify(p)); } catch { /* sem storage: só não lembra */ }
}

export function VisaoMes({ api, autos, onAbrir, onNova, onEditar }: {
  api: PlanejamentoApi; autos: AutosMap;
  onAbrir: (o: Ocorrencia) => void; onNova: (inicial?: Partial<Plano>) => void; onEditar: (p: Plano) => void;
}) {
  const { toast } = useToast();
  const cc = useChart();
  const atual = mesAtual();
  const hoje = hoje0();
  const [k, setK] = useState(atual);
  const [dia, setDia] = useState(hoje.getDate());
  const [prefs, setPrefs] = useState(lerPrefs);
  const [saldoTxt, setSaldoTxt] = useState(prefs.saldo != null ? String(prefs.saldo).replace(".", ",") : "");
  const { planos, mensal, receitaPlano } = api;
  // saldo atual das contas via Open Finance (ponto de partida padrão do fluxo)
  const [caixa, setCaixa] = useState<{ total: number; dia: string } | null>(null);
  useEffect(() => {
    listSaldoCaixa().then((cs) => {
      const brl = cs.filter((c) => (c.moeda || "BRL") === "BRL");
      if (brl.length) setCaixa({ total: brl.reduce((s, c) => s + Number(c.saldo || 0), 0), dia: brl.map((c) => c.dia).sort().pop() || "" });
    }).catch(() => { /* sem Open Finance: usa o saldo digitado */ });
  }, []);
  const saldoBase = prefs.saldo ?? caixa?.total ?? null;

  const ocsDe = (m: string) => ocorrenciasMes(planos, m, mensal, autos);
  const ocs = useMemo(() => ocsDe(k), [planos, mensal, autos, k]);

  // receitas previstas do mês (itens de receita + receita prevista da visão clássica), com o dia em que caem
  const receitasDe = (m: string) => {
    const out: { nome: string; dia: number; valor: number }[] = [];
    for (const p of planos) {
      if (!ehReceitaTipo(p.tipo)) continue;
      const o = ocorrencia(p, m, mensal, autos);
      if (o) out.push({ nome: p.nome, dia: o.dia ?? prefs.diaReceita, valor: o.valor });
    }
    if (receitaPlano?.ativo) {
      const v = mensal[m]?.[receitaPlano.id]?.valor_real ?? contribNoMes(receitaPlano, m);
      if (v) out.push({ nome: "Receita prevista", dia: receitaPlano.dia_venc ?? prefs.diaReceita, valor: v });
    }
    return out;
  };
  const receitas = useMemo(() => receitasDe(k), [planos, mensal, autos, k, receitaPlano, prefs.diaReceita]);

  const total = ocs.reduce((s, o) => s + o.valor, 0);
  const pago = ocs.filter((o) => o.pago).reduce((s, o) => s + o.valor, 0);
  const atrasadas = ocs.filter((o) => o.status === "atrasado");
  const recPrev = receitas.reduce((s, r) => s + r.valor, 0);
  const semDia = ocs.filter((o) => o.dia == null);

  // ---------- calendário ----------
  const [y, m] = [+k.slice(0, 4), +k.slice(5, 7)];
  const primeiro = new Date(y, m - 1, 1).getDay();
  const nd = dvDiasNoMes(k);
  const porDia = useMemo(() => {
    const r: Record<number, Ocorrencia[]> = {};
    ocs.forEach((o) => { if (o.dia) (r[o.dia] ||= []).push(o); });
    return r;
  }, [ocs]);
  const recPorDia = useMemo(() => {
    const r: Record<number, number> = {};
    receitas.forEach((x) => { const d = Math.min(x.dia, nd); r[d] = (r[d] || 0) + x.valor; });
    return r;
  }, [receitas, nd]);
  const diaSel = Math.min(dia, nd);
  const doDia = porDia[diaSel] || [];
  const ehHoje = (d: number) => k === atual && d === hoje.getDate();

  // ---------- fluxo de caixa (saldo em conta dia a dia) ----------
  const fluxo = useMemo(() => {
    if (k < atual) return null;
    const saldo0 = saldoBase ?? 0;
    // encadeia do mês atual (a partir de hoje) até o mês exibido
    let s = saldo0, pts = fluxoMes(atual, ocsDe(atual), receitasDe(atual).filter((r) => r.dia >= hoje.getDate()), s, hoje.getDate());
    for (let mm = dvAddMes(atual, 1); mm <= k; mm = dvAddMes(mm, 1)) {
      s = pts.length ? pts[pts.length - 1].saldo : s;
      pts = fluxoMes(mm, ocsDe(mm), receitasDe(mm), s, 1);
    }
    return pts;
  }, [k, atual, planos, mensal, autos, prefs, receitaPlano, saldoBase]);
  const minimo = fluxo?.length ? fluxo.reduce((a, b) => (b.saldo < a.saldo ? b : a)) : null;

  function salvarSaldo() {
    const v = parseValorBR(saldoTxt);
    const novo = { ...prefs, saldo: v };
    setPrefs(novo); gravarPrefs(novo);
  }
  function mudarDiaReceita(v: string) {
    const d = Math.max(1, Math.min(31, parseInt(v) || 5));
    const novo = { ...prefs, diaReceita: d };
    setPrefs(novo); gravarPrefs(novo);
  }
  async function marcarPago(o: Ocorrencia) {
    try {
      await api.salvarMensal(o.p.id, o.k, { pago: true });
      toast({ message: `${o.p.nome} marcado como pago.`, variant: "success" });
    } catch (e: any) { toast({ message: "Erro ao salvar: " + (e?.message || e), variant: "error" }); }
  }

  const proximos = useMemo(() => aPagar(planos, mensal, autos, 7), [planos, mensal, autos]);
  const irPara = (mm: string, d = 1) => { setK(mm); setDia(d); };

  return (
    <div>
      {/* navegação do mês */}
      <div className="flex items-center gap-2 mb-3 md:mb-4">
        <button onClick={() => irPara(dvAddMes(k, -1))} aria-label="Mês anterior" className="tap btn-ghost !px-3 !py-[6px]">‹</button>
        <h2 className="font-display text-[18px] md:text-[20px] font-bold tracking-tight min-w-[150px] md:min-w-[170px] text-center capitalize">{mesLongo(k)}</h2>
        <button onClick={() => irPara(dvAddMes(k, 1))} aria-label="Próximo mês" className="tap btn-ghost !px-3 !py-[6px]">›</button>
        {k !== atual && <button onClick={() => irPara(atual, hoje.getDate())} className="bg-transparent border-0 text-accent text-[13px] cursor-pointer">Hoje</button>}
      </div>

      {/* celular: uma linha-resumo no lugar dos 4 cartões */}
      <div className="md:hidden bg-card border border-line rounded-[14px] px-3 py-[10px] mb-3 shadow-card">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[12px] text-muted">Falta pagar</span>
          <span className="font-display text-[20px] font-bold tabular-nums">{BRL0(total - pago)}<span className="text-muted text-[12px] font-normal"> de {BRL0(total)}</span></span>
        </div>
        <div className="h-[6px] rounded-full bg-fill overflow-hidden mt-[6px]"><div className="h-full bg-green rounded-full" style={{ width: `${total ? (pago / total) * 100 : 0}%` }} /></div>
        <div className="flex flex-wrap justify-between gap-x-3 gap-y-[2px] text-[11.5px] mt-[6px]">
          <span className="text-green">pago {BRL0(pago)}</span>
          {atrasadas.length ? <span className="text-red font-semibold">{atrasadas.length} atrasada(s) · {BRL0(atrasadas.reduce((s, o) => s + o.valor, 0))}</span> : <span className="text-muted">nada atrasado</span>}
          <span className={recPrev - total < 0 ? "text-red" : "text-muted"}>sobra prevista {BRL0(recPrev - total)}</span>
        </div>
      </div>

      <div className="hidden md:grid grid-cols-2 lg:grid-cols-4 gap-[14px] mb-[18px]">
        <Kpi title="Contas no mês" value={BRL0(total)} sub={`${ocs.length} pagamentos`} />
        <Kpi title="Pago" value={BRL0(pago)} sub={total ? `${Math.round((pago / total) * 100)}% do mês` : "—"} color="text-green" />
        <Kpi title="Falta pagar" value={BRL0(total - pago)} sub={atrasadas.length ? <span className="text-red font-semibold">{atrasadas.length} atrasada(s) · {BRL0(atrasadas.reduce((s, o) => s + o.valor, 0))}</span> : "nada atrasado"} />
        <Kpi title="Sobra prevista" value={BRL0(recPrev - total)} sub={`receita prevista ${BRL0(recPrev)}`} color={recPrev - total < 0 ? "text-red" : "text-green"} />
      </div>

      {semDia.length > 0 && (
        <div className="bg-amber/10 border border-amber/30 rounded-[12px] px-3 py-2 mb-3 text-[12.5px] flex flex-wrap items-center gap-x-2 gap-y-1">
          <b>{semDia.length} despesa(s) sem dia de vencimento</b>
          <span className="text-muted">(não aparecem no calendário):</span>
          {semDia.map((o, i) => (
            <button key={o.key} onClick={() => onEditar(o.p)} className="bg-transparent border-0 p-0 text-accent cursor-pointer underline-offset-2 hover:underline">
              {o.p.nome}{i < semDia.length - 1 ? "," : ""}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-[14px] items-start">
        <div className="min-w-0 xl:col-start-1 xl:row-start-1">
          {/* calendário */}
          <div className="grid grid-cols-7 bg-card border border-line rounded-[16px] overflow-hidden shadow-card">
            {DIAS_SEM.map((d) => <div key={d} className="text-[10.5px] uppercase tracking-wide text-muted font-semibold px-2 py-[6px] bg-card2 border-b border-line">{d}</div>)}
            {Array.from({ length: primeiro }, (_, i) => <div key={"v" + i} className="bg-card2/60 border-b border-r border-line min-h-[54px] md:min-h-[104px]" />)}
            {Array.from({ length: nd }, (_, i) => {
              const d = i + 1;
              const evs = porDia[d] || [];
              const tot = evs.reduce((s, o) => s + o.valor, 0);
              const sel = d === diaSel;
              return (
                <button key={d} onClick={() => setDia(d)}
                  className={`text-left align-top bg-card border-0 border-b border-r border-line min-h-[54px] md:min-h-[104px] p-[5px] cursor-pointer flex flex-col gap-[3px] min-w-0 hover:bg-card2 transition-colors ${sel ? "ring-2 ring-inset ring-accent" : ""}`}>
                  <div className="flex items-center justify-between text-[12px] font-semibold">
                    <span className={ehHoje(d) ? "bg-accent text-onaccent rounded-full w-[22px] h-[22px] inline-flex items-center justify-center" : ""}>{d}</span>
                    {tot > 0 && <span className="hidden md:inline text-[10.5px] text-muted font-normal tabular-nums">{fmtN(tot)}</span>}
                  </div>
                  {recPorDia[d] > 0 && <div className="hidden md:block text-[10.5px] rounded-[5px] px-[5px] py-[1px] text-green border border-dashed border-green/50 truncate">+ {fmtN(recPorDia[d])} receita</div>}
                  {evs.slice(0, 3).map((o) => (
                    <div key={o.key} className={`hidden md:block text-[10.5px] rounded-[5px] px-[5px] py-[1px] truncate ${STATUS_INFO[o.status].cls} ${o.pago ? "line-through decoration-green/50" : ""}`}
                      title={`${o.p.nome} · ${BRL(o.valor)} · ${STATUS_INFO[o.status].label}`}>
                      {o.status === "atrasado" ? "! " : o.pago ? "✓ " : ""}{o.p.nome} {fmtN(o.valor)}
                    </div>
                  ))}
                  {evs.length > 3 && <div className="hidden md:block text-[10px] text-muted">+{evs.length - 3} mais</div>}
                  {/* celular: pontinhos por status */}
                  {(evs.length > 0 || recPorDia[d] > 0) && (
                    <div className="md:hidden flex flex-wrap gap-[2px]">
                      {recPorDia[d] > 0 && <span className="w-[6px] h-[6px] rounded-full bg-green" />}
                      {evs.slice(0, 4).map((o) => <span key={o.key} className={`w-[6px] h-[6px] rounded-full ${o.pago ? "bg-green/50" : o.status === "atrasado" ? "bg-red" : o.status === "hoje" || o.status === "proximo" ? "bg-amber" : "bg-accent/60"}`} />)}
                    </div>
                  )}
                </button>
              );
            })}
            {Array.from({ length: (7 - ((primeiro + nd) % 7)) % 7 }, (_, i) => <div key={"f" + i} className="bg-card2/60 border-b border-r border-line" />)}
          </div>
        </div>

        {/* fluxo de caixa (no celular fica depois do painel do dia) */}
        <div className="min-w-0 xl:col-start-1 xl:row-start-2 order-3 xl:order-none">
          <div className="bg-card border border-line rounded-[18px] p-4 sm:p-5 shadow-card">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-display text-[15px] font-bold tracking-tight">Saldo em conta ao longo do mês</h3>
              {minimo && <span className="text-[12px] text-muted">Menor saldo: <b className={minimo.saldo < 0 ? "text-red" : "text-txt"}>{BRL0(minimo.saldo)}</b> em {String(minimo.dia).padStart(2, "0")}/{k.slice(5)}</span>}
            </div>
            {fluxo == null ? (
              <div className="text-muted text-[13px] mt-2">Mês encerrado: o fluxo mostra só o mês atual e os próximos.</div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-2 text-[12.5px] text-muted">
                  <label className="inline-flex items-center gap-2">Saldo em conta hoje
                    <input className={`${inp} !w-[120px] text-right`} inputMode="decimal" value={saldoTxt} placeholder={caixa ? fmtN(caixa.total) : "0,00"}
                      onChange={(e) => setSaldoTxt(e.target.value)} onBlur={salvarSaldo} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
                  </label>
                  <label className="inline-flex items-center gap-2">Salário cai no dia
                    <input className={`${inp} !w-[64px] text-right`} type="number" min={1} max={31} value={prefs.diaReceita} onChange={(e) => mudarDiaReceita(e.target.value)} />
                  </label>
                </div>
                {prefs.saldo == null && caixa && <div className="text-[12px] text-muted mt-2">Partindo do saldo das contas no Open Finance ({BRL0(caixa.total)}{caixa.dia ? `, atualizado em ${caixa.dia.slice(8, 10)}/${caixa.dia.slice(5, 7)}` : ""}). Digite outro valor para substituir.</div>}
                {saldoBase == null && <div className="text-[12px] text-amber mt-2">Informe o saldo de hoje para ver valores reais. Sem ele, o gráfico mostra a variação a partir de zero.</div>}
                {minimo && minimo.saldo < 0 && (
                  <div className="bg-red/10 text-red rounded-[10px] px-3 py-2 mt-3 text-[12.5px]">
                    ⚠ O saldo fica negativo em {String(minimo.dia).padStart(2, "0")}/{k.slice(5)}. Reserve o dinheiro antes, ou veja se dá para mudar algum vencimento para depois do dia em que a receita cai.
                  </div>
                )}
                <div className="h-[180px] md:h-[200px] mt-3">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={fluxo} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid stroke={cc.grid} vertical={false} />
                      <XAxis dataKey="dia" tick={cc.tickSm} axisLine={false} tickLine={false} minTickGap={8} />
                      <YAxis tick={cc.tickSm} tickFormatter={(v) => brlShort(v)} width={64} axisLine={false} tickLine={false} />
                      {minimo && minimo.saldo < 0 && <ReferenceLine y={0} stroke={cc.despesa} strokeDasharray="4 4" />}
                      <Tooltip cursor={{ stroke: cc.tick.fill, strokeDasharray: "3 3" }} content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const pt = payload[0].payload as { dia: number; saldo: number; entradas: number; saidas: number };
                        return (
                          <div className="rounded-[12px] border border-line bg-card/95 backdrop-blur-[8px] px-3 py-2 shadow-pop text-[12px] min-w-[160px]">
                            <div className="text-muted mb-[3px]">{String(pt.dia).padStart(2, "0")}/{k.slice(5)}</div>
                            <div className="flex justify-between gap-3"><span>Saldo</span><b className="tabular-nums">{BRL0(pt.saldo)}</b></div>
                            {pt.entradas > 0 && <div className="flex justify-between gap-3 text-green"><span>Entradas</span><span className="tabular-nums">+{BRL0(pt.entradas)}</span></div>}
                            {pt.saidas > 0 && <div className="flex justify-between gap-3 text-muted"><span>Contas</span><span className="tabular-nums">−{BRL0(pt.saidas)}</span></div>}
                          </div>
                        );
                      }} />
                      <Line type="stepAfter" dataKey="saldo" stroke={cc.roxoLinha("1")} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="text-muted text-[11.5px] mt-1">
                  Contas saem no vencimento; as já pagas não contam. Atrasadas e sem dia definido contam no primeiro dia mostrado.
                </div>
              </>
            )}
          </div>
        </div>

        {/* painel do dia */}
        <aside className="bg-card border border-line rounded-[18px] p-4 shadow-card xl:col-start-2 xl:row-start-1 xl:row-span-2 order-2 xl:order-none">
          <div className="font-display text-[16px] font-bold">{String(diaSel).padStart(2, "0")}/{k.slice(5)} · {DIAS_SEM[new Date(y, m - 1, diaSel).getDay()]}</div>
          <div className="text-muted text-[12.5px]">
            {doDia.length ? `${doDia.length} pagamento(s) · ${BRL(doDia.reduce((s, o) => s + o.valor, 0))}` : "Nada vence neste dia"}
            {recPorDia[diaSel] > 0 && <span className="text-green"> · entra {BRL0(recPorDia[diaSel])}</span>}
          </div>
          <div className="mt-2">
            {doDia.map((o) => (
              <div key={o.key} onClick={() => onAbrir(o)} className="py-[10px] border-b border-line last:border-b-0 cursor-pointer group">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold group-hover:text-accent transition-colors">{o.p.nome}{o.parcela && <span className="text-muted font-normal text-[11.5px]"> · {o.parcela}</span>}</div>
                    <div className="text-muted text-[12px]">{o.p.favorecido ? `para ${o.p.favorecido}` : "—"}{o.p.forma_pagamento ? ` · ${o.p.forma_pagamento}` : ""}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-bold tabular-nums">{o.p.variavel && o.real == null ? "≈" : ""}{BRL(o.valor)}</div>
                    <div className="mt-1"><StatusBadge o={o} /></div>
                  </div>
                </div>
                {o.p.dados_pagamento && (
                  <div className="flex flex-wrap items-center gap-2 mt-[6px] text-[12px]">
                    <code className="bg-fill rounded-[6px] px-[6px] py-[1px] break-all">{o.p.dados_pagamento}</code>
                    <Copiar texto={o.p.dados_pagamento} onCopiado={() => toast({ message: "Copiado.", variant: "success" })} />
                  </div>
                )}
                {(o.nota || o.p.observacoes) && <div className="text-[12px] mt-[6px] text-amber">📝 {o.nota || o.p.observacoes}</div>}
                {!o.pago && k <= atual && (
                  <button onClick={(e) => { e.stopPropagation(); marcarPago(o); }} className="mt-2 btn-ghost !py-[4px] !px-3 !text-[12px] !text-green hover:!border-green">✓ Paguei</button>
                )}
              </div>
            ))}
          </div>
          <button onClick={() => onNova({ dia_venc: diaSel, mes_inicio: k })} className="btn-ghost w-full mt-3">+ Despesa neste dia</button>

          <div className="text-[11px] uppercase tracking-wide text-muted font-semibold mt-5 mb-2">Próximos 7 dias</div>
          {proximos.length ? proximos.map((o) => (
            <button key={o.key} onClick={() => { irPara(o.k, o.dia || 1); }}
              className="w-full flex items-center gap-2 py-[4px] text-[12.5px] bg-transparent border-0 cursor-pointer text-left hover:text-accent">
              <span className={`w-[42px] tabular-nums ${o.status === "atrasado" ? "text-red font-semibold" : "text-muted"}`}>{o.venc ? dataCurta(o.venc) : ""}</span>
              <span className="flex-1 truncate">{o.p.nome}</span>
              <b className="tabular-nums">{BRL0(o.valor)}</b>
            </button>
          )) : <div className="text-muted text-[12.5px]">Nada a pagar nos próximos 7 dias.</div>}
        </aside>
      </div>
    </div>
  );
}
