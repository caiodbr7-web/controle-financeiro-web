import { useState, useMemo, useEffect } from "react";
import type { Lancamento } from "../../types";
import { Panel, Select, Seg, Toolbar } from "../ui";
import { construirMatriz, mesesDisponiveis } from "../../lib/matrizMensal";
import { MatrizMensal } from "../MatrizMensal";
import { dvLabel, dvParcialLimite } from "../../lib/finance";
import { useCategorias } from "../../lib/categorias";

interface Props { dados: Lancamento[]; allDados: Lancamento[]; months: string[]; openModal: (t: string, r: Lancamento[]) => void; }

// Aba "mensal" — tabela-matriz (categorias x meses) por COMPETÊNCIA.
// Substitui os antigos KPIs/gráficos; o eixo de mês é a fatura/extrato do mês.
export function ResumoMensal({ dados, openModal }: Props) {
  const [mes, setMes] = useState("");
  const [nStr, setNStr] = useState("6");
  const { categorias } = useCategorias(); // recomputa a matriz quando muda ordem/nome/cor

  const meses = useMemo(() => mesesDisponiveis(dados), [dados]);
  const lim = useMemo(() => dvParcialLimite(), []);

  // default: o último mês disponível (mais recente, inclusive parcial).
  // mantém a escolha do usuário enquanto ela existir nos dados.
  useEffect(() => {
    if (!meses.length) return;
    if (mes && meses.includes(mes)) return;
    setMes(meses[meses.length - 1]);
  }, [meses]);

  const m = mes && meses.includes(mes) ? mes : meses[meses.length - 1] || "";
  const nMeses = +nStr;
  const parcial = m >= lim;

  const matriz = useMemo(() => construirMatriz(dados, { mesSelecionado: m, nMeses }), [dados, m, nMeses, categorias]);
  const primeiroMes = matriz.meses[0] || m;

  if (!m) return <div className="text-muted">Sem dados.</div>;

  return (
    <div>
      <Toolbar
        right={
          <span className="text-muted text-[12px]">
            por competência · {nMeses} meses
            {parcial ? " · mês parcial (faturas por vir)" : ""}
          </span>
        }
      >
        <Select value={m} onChange={setMes}>
          {meses.map((x) => <option key={x} value={x}>{dvLabel(x)}{x >= lim ? " *" : ""}</option>)}
        </Select>
        <Seg
          value={nStr}
          onChange={setNStr}
          options={[{ v: "3", label: "3m" }, { v: "6", label: "6m" }, { v: "12", label: "12m" }]}
        />
      </Toolbar>

      <Panel title="Resumo por categoria" sub={`(${dvLabel(primeiroMes)} — ${dvLabel(m)})`}>
        <MatrizMensal dados={dados} matriz={matriz} openModal={openModal} />
      </Panel>

      <div className="text-muted text-[12px] mt-2">
        Tudo nesta aba é agrupado pela <b>competência</b> (fatura/extrato do mês) — parcelas contam no mês em que caem. Receitas/Gastos excluem transferências internas e aportes; investimento (Σ Aporte) e renda de investimentos aparecem em seção própria. Meses marcados com <b>*</b> ainda podem receber faturas futuras.
      </div>
    </div>
  );
}
