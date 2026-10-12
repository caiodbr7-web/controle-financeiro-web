import { useMemo, useState } from "react";
import { ResponsiveContainer, Treemap, Tooltip } from "recharts";
import { BRL, BRL0, corCategoria, dvAddMes, dvLabel } from "../../lib/finance";
import { type Plano, fimEfetivo, mesAtual, mesesEntre } from "../../lib/projecao";
import {
  type AutosMap, LEMBRAR_OPCOES, TIPO_LABEL, descreveRegra, ehDespesa, ocorrencia, progresso,
} from "../../lib/agenda";
import { useIsMobile } from "../../lib/theme";
import { Seg } from "../ui";
import { useToast } from "../Toast";
import { StatusBadge, fmtN, inp } from "./comum";
import type { PlanejamentoApi } from "./usePlanejamento";

type Vista = "mapa" | "lista" | "tempo";
type Metrica = "12m" | "mes";
type Agrup = "categoria" | "tipo";

const COR_TIPO: Record<string, string> = {
  Recorrente: "#6d28d9", Parcelado: "#0891b2", "Pagamento único": "#c2334a", "Meta / caixinha": "#b7791f",
};

export function VisaoDespesas({ api, autos, onEditar, onNova }: {
  api: PlanejamentoApi; autos: AutosMap; onEditar: (p: Plano) => void; onNova: () => void;
}) {
  const [vista, setVista] = useState<Vista>("mapa");
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Seg<Vista> value={vista} onChange={setVista} options={[{ v: "mapa", label: "▦ Mapa de área" }, { v: "lista", label: "☰ Lista" }, { v: "tempo", label: "▬ Linha do tempo" }]} />
        <span className="text-muted text-[12px]">
          {vista === "mapa" ? "Cada retângulo é proporcional ao peso da despesa." : vista === "lista" ? "Todas as despesas cadastradas, com os dados de pagamento." : "Quando cada compromisso começa e termina."}
        </span>
      </div>
      {vista === "mapa" && <Mapa api={api} autos={autos} onEditar={onEditar} />}
      {vista === "lista" && <Lista api={api} autos={autos} onEditar={onEditar} onNova={onNova} />}
      {vista === "tempo" && <LinhaTempo api={api} autos={autos} onEditar={onEditar} />}
    </div>
  );
}

/* ---------------- mapa de área (treemap) ---------------- */
function Mapa({ api, autos, onEditar }: { api: PlanejamentoApi; autos: AutosMap; onEditar: (p: Plano) => void }) {
  const [metrica, setMetrica] = useState<Metrica>("12m");
  const [agrup, setAgrup] = useState<Agrup>("categoria");
  const mobile = useIsMobile();
  const atual = mesAtual();
  const meses = metrica === "mes" ? [atual] : Array.from({ length: 12 }, (_, i) => dvAddMes(atual, i));

  const { grupos, total } = useMemo(() => {
    const by = new Map<string, { name: string; cor: string; children: { name: string; size: number; cor: string; p: Plano }[] }>();
    let total = 0;
    for (const p of api.planos) {
      if (!p.ativo || !ehDespesa(p)) continue;
      const size = meses.reduce((s, k) => s + (ocorrencia(p, k, api.mensal, autos)?.valor || 0), 0);
      if (size <= 0) continue;
      const g = agrup === "categoria" ? p.categoria || "Sem categoria" : TIPO_LABEL[p.tipo];
      const cor = agrup === "categoria" ? corCategoria(g) : COR_TIPO[g] || "#6e6a7c";
      if (!by.has(g)) by.set(g, { name: g, cor, children: [] });
      by.get(g)!.children.push({ name: p.nome, size, cor, p });
      total += size;
    }
    const grupos = [...by.values()]
      .map((g) => ({ ...g, children: g.children.sort((a, b) => b.size - a.size), size: g.children.reduce((s, c) => s + c.size, 0) }))
      .sort((a, b) => b.size - a.size);
    return { grupos, total };
  }, [api.planos, api.mensal, autos, metrica, agrup]);

  const ranking = grupos.flatMap((g) => g.children).sort((a, b) => b.size - a.size);

  // retângulo customizado: grupos (depth 1) com borda; itens (depth 2) preenchidos com nome + valor
  const Celula = (props: any) => {
    const { x, y, width, height, depth, name, size, cor } = props;
    if (width <= 0 || height <= 0) return null;
    // grupo (categoria/tipo): só a moldura — a identidade vai pela cor + legenda ao lado
    if (depth === 1) return <rect x={x} y={y} width={width} height={height} fill="none" stroke="rgb(var(--c-card))" strokeWidth={4} />;
    if (depth !== 2) return null;
    const pct = total ? (size / total) * 100 : 0;
    const mostra = width > 64 && height > 34;
    return (
      <g style={{ cursor: "pointer" }} onClick={() => props.p && onEditar(props.p)}>
        <rect x={x} y={y} width={width} height={height} fill={cor} fillOpacity={0.88} stroke="rgb(var(--c-card))" strokeWidth={2} rx={4} />
        {mostra && (
          <>
            <text x={x + 7} y={y + 17} fill="#fff" fontSize={12} fontWeight={650} style={{ pointerEvents: "none" }}>
              {name.length * 6.6 > width - 12 ? name.slice(0, Math.max(3, Math.floor((width - 14) / 6.6))) + "…" : name}
            </text>
            <text x={x + 7} y={y + 32} fill="rgba(255,255,255,.85)" fontSize={11} style={{ pointerEvents: "none" }}>
              {BRL0(size)}{height > 50 ? "" : ` · ${pct.toFixed(0)}%`}
            </text>
            {height > 50 && <text x={x + 7} y={y + 46} fill="rgba(255,255,255,.75)" fontSize={10.5} style={{ pointerEvents: "none" }}>{pct.toFixed(1)}% do total</text>}
          </>
        )}
      </g>
    );
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <Seg<Metrica> size="sm" value={metrica} onChange={setMetrica} options={[{ v: "12m", label: "Próximos 12 meses" }, { v: "mes", label: "Este mês" }]} />
        <Seg<Agrup> size="sm" value={agrup} onChange={setAgrup} options={[{ v: "categoria", label: "Por categoria" }, { v: "tipo", label: "Por tipo" }]} />
        <span className="text-[12.5px] text-muted ml-auto">Total: <b className="text-txt">{BRL0(total)}</b></span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-[14px] items-start">
        <div className="bg-card border border-line rounded-[16px] shadow-card p-1 md:p-2 h-[380px] md:h-[520px]">
          {grupos.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <Treemap data={grupos} dataKey="size" aspectRatio={mobile ? 1 : 4 / 3} isAnimationActive={false} content={<Celula />}>
                <Tooltip content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload as any;
                  if (!d?.p) return null;
                  return (
                    <div className="rounded-[12px] border border-line bg-card/95 backdrop-blur-[8px] px-3 py-2 shadow-pop text-[12px] min-w-[180px]">
                      <div className="font-semibold">{d.name}</div>
                      <div className="text-muted">{d.p.favorecido || TIPO_LABEL[d.p.tipo as Plano["tipo"]]}</div>
                      <div className="flex justify-between gap-3 mt-1"><span className="text-muted">{metrica === "mes" ? "Este mês" : "12 meses"}</span><b className="tabular-nums">{BRL(d.size)}</b></div>
                      <div className="flex justify-between gap-3"><span className="text-muted">Participação</span><span className="tabular-nums">{((d.size / total) * 100).toFixed(1)}%</span></div>
                    </div>
                  );
                }} />
              </Treemap>
            </ResponsiveContainer>
          ) : <div className="h-full flex items-center justify-center text-muted text-[13px]">Nenhuma despesa no período.</div>}
        </div>
        {/* ranking: a mesma informação em texto (acessível e fácil de comparar) */}
        <div className="bg-card border border-line rounded-[16px] shadow-card p-4">
          <div className="text-[11px] uppercase tracking-wide text-muted font-semibold mb-2">Maiores despesas</div>
          {ranking.slice(0, 12).map((r) => (
            <button key={r.p.id} onClick={() => onEditar(r.p)} className="w-full bg-transparent border-0 p-0 text-left cursor-pointer block mb-[9px] group">
              <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
                <span className="truncate font-medium group-hover:text-accent">{r.name}</span>
                <span className="tabular-nums text-muted shrink-0">{BRL0(r.size)} · {((r.size / total) * 100).toFixed(0)}%</span>
              </div>
              <div className="h-[4px] rounded-full bg-fill overflow-hidden mt-[3px]">
                <div className="h-full rounded-full" style={{ width: `${Math.max(2, (r.size / (ranking[0]?.size || 1)) * 100)}%`, background: r.cor }} />
              </div>
            </button>
          ))}
          <div className="border-t border-line mt-3 pt-2 space-y-[3px]">
            {grupos.map((g) => (
              <div key={g.name} className="flex items-center gap-2 text-[12px]">
                <span className="w-[8px] h-[8px] rounded-full shrink-0" style={{ background: g.cor }} />
                <span className="truncate flex-1">{g.name}</span>
                <span className="tabular-nums text-muted">{((g.size / total) * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- lista ---------------- */
type Ordem = "valor" | "nome" | "proximo";
function Lista({ api, autos, onEditar, onNova }: { api: PlanejamentoApi; autos: AutosMap; onEditar: (p: Plano) => void; onNova: () => void }) {
  const { toast } = useToast();
  const [filtro, setFiltro] = useState<"" | Plano["tipo"]>("");
  const [busca, setBusca] = useState("");
  const [ordem, setOrdem] = useState<Ordem>("valor");
  const [inativos, setInativos] = useState(false);
  const atual = mesAtual();

  const linhas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return api.planos
      .filter((p) => (inativos || p.ativo) && (!filtro || p.tipo === filtro))
      .filter((p) => !q || `${p.nome} ${p.favorecido || ""} ${p.categoria || ""} ${p.observacoes || ""}`.toLowerCase().includes(q))
      .map((p) => {
        // próximo pagamento em aberto (até 24 meses à frente)
        let prox = null;
        for (let i = -1; i < 24 && !prox; i++) {
          const o = ocorrencia({ ...p, ativo: true }, dvAddMes(atual, i), api.mensal, autos);
          if (o && !o.pago && (i >= 0 || o.status === "atrasado")) prox = o;
        }
        const fim = fimEfetivo(p);
        const prog = p.tipo !== "fixo" && p.tipo !== "receita" ? progresso(p, api.mensal, autos) : null;
        return { p, prox, fim, prog };
      })
      .sort((a, b) =>
        ordem === "nome" ? a.p.nome.localeCompare(b.p.nome)
        : ordem === "proximo" ? (a.prox?.venc?.getTime() ?? 9e15) - (b.prox?.venc?.getTime() ?? 9e15)
        : b.p.valor - a.p.valor);
  }, [api.planos, api.mensal, autos, filtro, busca, ordem, inativos]);

  const custoFixo = api.planos.filter((p) => p.ativo && p.tipo === "fixo" && (!p.mes_fim || p.mes_fim >= atual)).reduce((s, p) => s + p.valor, 0);
  const th = "text-left text-[10.5px] font-bold uppercase tracking-[0.05em] text-muted px-[10px] py-[8px] border-b border-line whitespace-nowrap";
  const td = "px-[10px] py-[9px] border-b border-line align-top text-[13px]";

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Seg<"" | Plano["tipo"]> size="sm" value={filtro} onChange={setFiltro} options={[
          { v: "", label: `Todas (${api.planos.filter((p) => inativos || p.ativo).length})` },
          { v: "fixo", label: "Recorrentes" }, { v: "parcelamento", label: "Parcelados" },
          { v: "pagamento", label: "Únicos" }, { v: "meta", label: "Metas" }, { v: "receita", label: "Receitas" },
        ]} />
        <input className={`${inp} md:!w-[220px]`} placeholder="Buscar nome, favorecido, obs…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <label className="inline-flex items-center gap-1 text-[12px] text-muted cursor-pointer"><input type="checkbox" checked={inativos} onChange={(e) => setInativos(e.target.checked)} /> mostrar pausadas</label>
        <span className="ml-auto text-[12.5px] text-muted">Custo fixo mensal: <b className="text-txt">{BRL0(custoFixo)}</b></span>
      </div>
      {/* celular: um cartão por despesa */}
      <div className="md:hidden flex flex-col gap-2">
        {linhas.map(({ p, prox, prog }) => (
          <button key={p.id} onClick={() => onEditar(p)} className={`text-left bg-card border border-line rounded-[14px] p-3 shadow-card cursor-pointer ${p.ativo ? "" : "opacity-50"}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-[8px] h-[8px] rounded-full shrink-0" style={{ background: p.tipo === "receita" ? "rgb(var(--c-green))" : corCategoria(p.categoria || "Sem categoria") }} />
                  <b className="truncate">{p.nome}</b>
                </div>
                <div className="text-muted text-[12px] truncate">{p.favorecido || TIPO_LABEL[p.tipo]}{p.forma_pagamento ? ` · ${p.forma_pagamento}` : ""}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-bold tabular-nums">{p.variavel ? "≈" : ""}{BRL0(p.valor)}</div>
                <div className="text-muted text-[11px]">{p.tipo === "fixo" || p.tipo === "receita" ? "por mês" : p.tipo === "parcelamento" ? "por parcela" : TIPO_LABEL[p.tipo]}</div>
              </div>
            </div>
            <div className="text-muted text-[12px] mt-[6px]">{descreveRegra(p, BRL0)}</div>
            {prog && prog.n > 1 && (
              <div className="mt-[6px]">
                <div className="h-[5px] bg-fill rounded-full overflow-hidden"><div className="h-full bg-accent rounded-full" style={{ width: `${(prog.pagas / prog.n) * 100}%` }} /></div>
                <div className="text-[11px] text-muted mt-[2px]">{prog.pagas}/{prog.n} pagas · faltam {BRL0(prog.restante)}</div>
              </div>
            )}
            <div className="flex items-center justify-between gap-2 mt-[8px]">
              {prox ? <span className="inline-flex items-center gap-2 text-[12px]"><span className="tabular-nums text-muted">{prox.venc ? prox.venc.toLocaleDateString("pt-BR") : dvLabel(prox.k)}</span><StatusBadge o={prox} /></span>
                : <span className="text-muted text-[12px]">concluída</span>}
              {p.observacoes && <span className="text-[11px] text-muted truncate max-w-[45%]" title={p.observacoes}>📝 {p.observacoes}</span>}
            </div>
          </button>
        ))}
        {!linhas.length && <div className="p-6 text-center text-muted text-[13px]">Nada por aqui.</div>}
      </div>

      <div className="hidden md:block bg-card border border-line rounded-[16px] shadow-card overflow-x-auto scroll-thin">
        <table className="w-full border-collapse min-w-[900px]">
          <thead>
            <tr>
              <th className={th}><button onClick={() => setOrdem("nome")} className={`bg-transparent border-0 p-0 cursor-pointer uppercase font-bold ${ordem === "nome" ? "text-accent" : "text-muted"}`}>Despesa</button></th>
              <th className={th}>Regra</th>
              <th className={`${th} text-right`}><button onClick={() => setOrdem("valor")} className={`bg-transparent border-0 p-0 cursor-pointer uppercase font-bold ${ordem === "valor" ? "text-accent" : "text-muted"}`}>Valor</button></th>
              <th className={th}><button onClick={() => setOrdem("proximo")} className={`bg-transparent border-0 p-0 cursor-pointer uppercase font-bold ${ordem === "proximo" ? "text-accent" : "text-muted"}`}>Próximo</button></th>
              <th className={th}>Pagamento</th>
              <th className={th}>Observações</th>
              <th className={th}></th>
            </tr>
          </thead>
          <tbody>
            {linhas.map(({ p, prox, prog }) => (
              <tr key={p.id} className={`hover:bg-card2 ${p.ativo ? "" : "opacity-50"}`}>
                <td className={td}>
                  <div className="flex items-center gap-2">
                    <span className="w-[8px] h-[8px] rounded-full shrink-0" style={{ background: p.tipo === "receita" ? "rgb(var(--c-green))" : corCategoria(p.categoria || "Sem categoria") }} />
                    <b className="truncate max-w-[220px]">{p.nome}</b>
                  </div>
                  <div className="text-muted text-[11.5px] ml-4">{p.favorecido || "—"}{p.categoria ? ` · ${p.categoria}` : ""}</div>
                </td>
                <td className={`${td} text-[12.5px]`}>
                  <span className="text-[10px] uppercase tracking-wide font-bold text-muted border border-line rounded-[5px] px-[5px] py-[1px] mr-1">{TIPO_LABEL[p.tipo]}</span>
                  <div className="text-muted mt-1">{descreveRegra(p, BRL0)}</div>
                  {prog && prog.n > 1 && (
                    <div className="mt-1">
                      <div className="h-[5px] w-[140px] bg-fill rounded-full overflow-hidden"><div className="h-full bg-accent rounded-full" style={{ width: `${(prog.pagas / prog.n) * 100}%` }} /></div>
                      <div className="text-[11px] text-muted mt-[2px]">{prog.pagas}/{prog.n} pagas · faltam {BRL0(prog.restante)}</div>
                    </div>
                  )}
                </td>
                <td className={`${td} text-right tabular-nums font-semibold`}>{p.variavel ? "≈" : ""}{BRL(p.valor)}</td>
                <td className={td}>
                  {prox ? <div className="flex flex-col gap-1 items-start"><span className="tabular-nums text-[12.5px]">{prox.venc ? prox.venc.toLocaleDateString("pt-BR") : dvLabel(prox.k)}</span><StatusBadge o={prox} /></div>
                    : <span className="text-muted text-[12px]">concluída</span>}
                </td>
                <td className={`${td} text-[12.5px]`}>
                  {p.forma_pagamento || "—"}
                  {p.tipo !== "receita" && <div className="text-muted text-[11.5px]">🔔 {LEMBRAR_OPCOES.find((o) => o.v === (p.lembrar_dias ?? -1))?.label || "—"}</div>}
                  {p.dados_pagamento && <div className="text-muted text-[11.5px] truncate max-w-[180px]" title={p.dados_pagamento}>{p.dados_pagamento}</div>}
                </td>
                <td className={`${td} text-[12.5px] text-muted max-w-[260px] whitespace-pre-wrap`}>{p.observacoes || "—"}</td>
                <td className={`${td} whitespace-nowrap text-[12px]`}>
                  <button onClick={() => onEditar(p)} className="bg-transparent border-0 p-0 cursor-pointer text-accent">editar</button>
                  <span className="text-line mx-1">·</span>
                  <button onClick={() => api.alternarAtivo(p).catch((e) => toast({ message: String(e?.message || e), variant: "error" }))}
                    className="bg-transparent border-0 p-0 cursor-pointer text-muted hover:text-txt">{p.ativo ? "pausar" : "reativar"}</button>
                </td>
              </tr>
            ))}
            {!linhas.length && <tr><td colSpan={7} className="p-6 text-center text-muted">Nada por aqui. <button onClick={onNova} className="bg-transparent border-0 p-0 text-accent cursor-pointer">+ Nova despesa</button></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------- linha do tempo ---------------- */
function LinhaTempo({ api, autos, onEditar }: { api: PlanejamentoApi; autos: AutosMap; onEditar: (p: Plano) => void }) {
  const atual = mesAtual();
  const [ini, n] = [dvAddMes(atual, -3), 18];
  const meses = Array.from({ length: n }, (_, i) => dvAddMes(ini, i));
  const fimJanela = meses[n - 1];

  const itens = useMemo(() => api.planos
    .filter((p) => p.ativo && ehDespesa(p))
    .map((p) => ({ p, fim: fimEfetivo(p) }))
    .filter(({ p, fim }) => p.mes_inicio <= fimJanela && (!fim || fim >= ini))
    .sort((a, b) => (a.fim ?? "9999").localeCompare(b.fim ?? "9999") || b.p.valor - a.p.valor), [api.planos, ini, fimJanela]);

  const totMes = meses.map((k) => itens.reduce((s, { p }) => s + (ocorrencia(p, k, api.mensal, autos)?.valor || 0), 0));
  const maxTot = Math.max(1, ...totMes);
  const col = (k: string) => Math.max(0, Math.min(n - 1, mesesEntre(ini, k)));

  return (
    <div className="bg-card border border-line rounded-[16px] shadow-card overflow-x-auto scroll-thin [--col-nome:150px] md:[--col-nome:220px]">
      <div className="min-w-[900px]">
        <div className="grid border-b border-line" style={{ gridTemplateColumns: `var(--col-nome) repeat(${n}, minmax(0,1fr))` }}>
          <div className="sticky left-0 z-10 bg-card px-3 py-2 text-[10.5px] uppercase tracking-wide font-bold text-muted">Compromisso</div>
          {meses.map((k) => <div key={k} className={`py-2 text-center text-[10.5px] font-semibold ${k === atual ? "text-accent" : "text-muted"}`}>{dvLabel(k)}</div>)}
        </div>
        {itens.map(({ p, fim }) => {
          const a = p.mes_inicio < ini ? 0 : col(p.mes_inicio);
          const b = !fim || fim > fimJanela ? n - 1 : col(fim);
          const cor = corCategoria(p.categoria || "Sem categoria");
          const continua = !fim || fim > fimJanela;
          return (
            <div key={p.id} className="grid items-center border-b border-line hover:bg-card2 cursor-pointer" style={{ gridTemplateColumns: `var(--col-nome) repeat(${n}, minmax(0,1fr))` }} onClick={() => onEditar(p)}>
              <div className="sticky left-0 z-10 bg-card px-3 py-[7px] min-w-0 border-r border-line">
                <div className="truncate text-[13px] font-medium">{p.nome}</div>
                <div className="truncate text-[11px] text-muted">{fim ? `termina ${dvLabel(fim)}` : "sem fim"} · {BRL0(p.valor)}{p.tipo === "fixo" || p.tipo === "parcelamento" ? "/mês" : ""}</div>
              </div>
              <div className="relative h-[22px]" style={{ gridColumn: `${a + 2} / ${b + 3}` }}>
                <div className={`absolute inset-y-[3px] left-[2px] right-[2px] ${continua ? "rounded-l-[6px]" : "rounded-[6px]"} flex items-center px-2 text-[10.5px] text-white font-semibold overflow-hidden whitespace-nowrap`}
                  style={{ background: cor, opacity: 0.85 }}>
                  {p.tipo === "pagamento" ? fmtN(p.valor) : TIPO_LABEL[p.tipo]}{continua ? " →" : ""}
                </div>
              </div>
            </div>
          );
        })}
        {/* soma por mês: mostra quando o compromisso mensal cai */}
        <div className="grid items-end bg-card2" style={{ gridTemplateColumns: `var(--col-nome) repeat(${n}, minmax(0,1fr))` }}>
          <div className="sticky left-0 z-10 bg-card2 px-3 py-2 text-[12px] font-semibold self-stretch flex items-end border-r border-line">Total por mês</div>
          {totMes.map((v, i) => (
            <div key={meses[i]} className="flex flex-col items-center justify-end px-[2px] pt-2 pb-1 h-[78px]" title={`${dvLabel(meses[i])}: ${BRL0(v)}`}>
              <div className={`w-full max-w-[26px] rounded-t-[4px] ${meses[i] === atual ? "bg-accent" : "bg-accent/40"}`} style={{ height: `${(v / maxTot) * 44}px` }} />
              <div className="text-[9.5px] text-muted tabular-nums mt-1">{fmtN(v / 1000)}k</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
