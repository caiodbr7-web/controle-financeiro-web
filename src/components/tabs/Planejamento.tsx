import { useMemo, useState } from "react";
import type { Lancamento } from "../../types";
import type { Plano } from "../../lib/projecao";
import { type Ocorrencia, calcAutos, receitasReais } from "../../lib/agenda";
import { Seg } from "../ui";
import { JANELA, MSG_MIGRACAO_LEMBRETES, usePlanejamento } from "../planejamento/usePlanejamento";
import { VisaoMes } from "../planejamento/VisaoMes";
import { VisaoPlanilha } from "../planejamento/VisaoPlanilha";
import { VisaoDespesas } from "../planejamento/VisaoDespesas";
import { CadastroDespesa } from "../planejamento/CadastroDespesa";
import { DetalhePagamento } from "../planejamento/DetalhePagamento";
import { PlanejamentoClassico } from "../planejamento/PlanejamentoClassico";

type AbaPlan = "mes" | "planilha" | "despesas" | "orcamento";
const LS_ABA = "cf_plan_aba";

/* Planejamento: calendário de contas (Mês), planilha previsto × realizado (Planilha),
   o cadastro de despesas em visões alternativas (Despesas) e o orçamento clássico
   de cartão/conta/receita (Orçamento). `lancamentos` já vem filtrado pela Visão. */
export function Planejamento({ lancamentos }: { lancamentos: Lancamento[] }) {
  const api = usePlanejamento();
  const [aba, setAba] = useState<AbaPlan>(() => {
    try { return (localStorage.getItem(LS_ABA) as AbaPlan) || "mes"; } catch { return "mes"; }
  });
  const [detalhe, setDetalhe] = useState<Ocorrencia | null>(null);
  const [cadastro, setCadastro] = useState<{ plano?: Plano | null; inicial?: Partial<Plano> } | null>(null);

  function trocarAba(a: AbaPlan) {
    // o Orçamento clássico grava por conta própria: ao sair dele, recarrega os itens
    if (aba === "orcamento" && a !== "orcamento") api.carregar();
    setAba(a);
    try { localStorage.setItem(LS_ABA, a); } catch { /* sem storage */ }
  }

  const comps = useMemo(() => new Set(JANELA), []);
  const autos = useMemo(() => calcAutos(api.planos, lancamentos, comps), [api.planos, lancamentos, comps]);
  const recReal = useMemo(() => receitasReais(lancamentos, comps), [lancamentos, comps]);

  if (api.semTabela) return <PlanejamentoClassico lancamentos={lancamentos} />;

  const abrirEdicao = (p: Plano) => { setDetalhe(null); setCadastro({ plano: p }); };

  return (
    <div>
      <div className="flex flex-wrap gap-x-3 gap-y-2 items-center justify-between mb-3 md:mb-4">
        <Seg value={aba} onChange={trocarAba} options={[
          { v: "mes", label: "Mês" }, { v: "planilha", label: "Planilha" },
          { v: "despesas", label: "Despesas" }, { v: "orcamento", label: "Orçamento" },
        ]} />
        {aba !== "orcamento" && <button onClick={() => setCadastro({})} className="btn-primary hidden md:inline-flex">+ Nova despesa</button>}
      </div>
      {/* celular: botão flutuante acima da navegação inferior */}
      {aba !== "orcamento" && (
        <button onClick={() => setCadastro({})} aria-label="Nova despesa"
          className="md:hidden fixed bottom-[80px] right-4 z-40 w-[52px] h-[52px] rounded-full bg-accent text-onaccent text-[26px] leading-none border-0 shadow-pop cursor-pointer flex items-center justify-center">+</button>
      )}

      {aba !== "orcamento" && !api.loading && !api.temNovas && (
        <div className="bg-amber/10 border border-amber/30 rounded-[12px] px-3 py-2 mb-4 text-[12.5px]">{MSG_MIGRACAO_LEMBRETES}</div>
      )}
      {api.erro && <div className="bg-card border border-line rounded-[14px] p-3 text-red mb-4 text-[13px]">{api.erro}</div>}

      {aba === "mes" && <VisaoMes api={api} autos={autos} onAbrir={setDetalhe} onNova={(inicial) => setCadastro({ inicial })} onEditar={abrirEdicao} />}
      {aba === "planilha" && <VisaoPlanilha api={api} autos={autos} receitaReal={recReal} onAbrir={setDetalhe} onEditar={abrirEdicao} />}
      {aba === "despesas" && <VisaoDespesas api={api} autos={autos} onEditar={abrirEdicao} onNova={() => setCadastro({})} />}
      {aba === "orcamento" && <PlanejamentoClassico lancamentos={lancamentos} />}

      {detalhe && <DetalhePagamento o={detalhe} api={api} onEditar={() => abrirEdicao(detalhe.p)} onClose={() => setDetalhe(null)} />}
      {cadastro && <CadastroDespesa plano={cadastro.plano} inicial={cadastro.inicial} api={api} onClose={() => setCadastro(null)} />}
    </div>
  );
}
