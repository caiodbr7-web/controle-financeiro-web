import { useMemo, useState, useCallback } from "react";
import type { Lancamento, Visao } from "./types";
import { useAuth } from "./hooks/useAuth";
import { useLancamentos } from "./hooks/useLancamentos";
import { Login } from "./components/Login";
import { Modal, type ModalData } from "./components/Modal";
import { Select } from "./components/ui";
import { VisaoGeral } from "./components/tabs/VisaoGeral";
import { EvolucaoDiaria } from "./components/tabs/EvolucaoDiaria";
import { ResumoMensal } from "./components/tabs/ResumoMensal";
import { Arquivos } from "./components/tabs/Arquivos";
import { Lancamentos } from "./components/tabs/Lancamentos";
import { Classificar } from "./components/tabs/Classificar";

type Aba = "geral" | "diario" | "mesdet" | "classificar" | "arquivos" | "lanc";
const ABAS: { id: Aba; label: string }[] = [
  { id: "geral", label: "Visão Geral" },
  { id: "diario", label: "Evolução Diária" },
  { id: "mesdet", label: "Resumo Mensal" },
  { id: "classificar", label: "Classificar" },
  { id: "arquivos", label: "Arquivos" },
  { id: "lanc", label: "Lançamentos" },
];

export default function App() {
  const { logado, erro, entrarGoogle, entrarEmail, sair } = useAuth();
  const { allDados, status, reload } = useLancamentos(!!logado);
  const [visao, setVisao] = useState<Visao>("pessoal");
  const [aba, setAba] = useState<Aba>("geral");
  const [modal, setModal] = useState<ModalData | null>(null);

  const openModal = useCallback((title: string, rows: Lancamento[]) => {
    if (rows.length) setModal({ title, rows });
  }, []);

  const dados = useMemo(
    () => visao === "ALL" ? allDados
      : allDados.filter((d) => visao === "pessoal" ? d.natureza !== "Corporativo" : d.natureza === "Corporativo"),
    [allDados, visao]
  );
  const months = useMemo(() => [...new Set(dados.map((d) => d.competencia))].sort(), [dados]);

  if (logado === null) return <div className="p-8 text-muted">Carregando…</div>;
  if (!logado) return <Login onGoogle={entrarGoogle} onEmail={entrarEmail} erro={erro} />;

  const tabProps = { dados, allDados, months, openModal };

  return (
    <div>
      <header className="sticky top-0 z-20 flex flex-wrap gap-x-3 gap-y-2 items-center justify-between px-4 sm:px-6 lg:px-8 py-3 bg-bg/85 backdrop-blur-[14px] border-b border-line">
        <h1 className="text-base sm:text-[17px] font-semibold tracking-tight">Controle Financeiro</h1>
        <div className="flex gap-2 items-center ml-auto">
          <label className="text-muted text-[13px] hidden sm:inline">Visão:</label>
          <Select value={visao} onChange={(v) => setVisao(v as Visao)} className="py-2">
            <option value="ALL">Completo</option>
            <option value="pessoal">Pessoal</option>
            <option value="corporativo">Corporativo</option>
          </Select>
          <button onClick={sair} className="bg-transparent border border-line text-muted rounded-[10px] px-3 sm:px-4 py-2 cursor-pointer hover:text-txt">Sair</button>
        </div>
      </header>

      <div className="px-4 sm:px-6 lg:px-8 py-4 sm:py-6 max-w-[1380px] mx-auto">
        <div className="flex gap-[2px] bg-[#ececf0] p-1 rounded-[12px] mb-5 overflow-x-auto no-scrollbar">
          {ABAS.map((a) => (
            <button
              key={a.id}
              onClick={() => setAba(a.id)}
              className={`whitespace-nowrap border-0 px-3 sm:px-4 py-2 text-[13px] sm:text-sm cursor-pointer rounded-[9px] font-medium transition ${
                aba === a.id ? "bg-card text-txt shadow-[0_1px_3px_rgba(0,0,0,.12)]" : "bg-transparent text-muted hover:text-txt"
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
        {status && <div className="text-muted text-[12.5px] mb-3">{status}</div>}

        {aba === "geral" && <VisaoGeral {...tabProps} />}
        {aba === "diario" && <EvolucaoDiaria {...tabProps} />}
        {aba === "mesdet" && <ResumoMensal {...tabProps} />}
        {aba === "classificar" && <Classificar dados={dados} openModal={openModal} reload={reload} />}
        {aba === "arquivos" && <Arquivos {...tabProps} />}
        {aba === "lanc" && <Lancamentos {...tabProps} reload={reload} />}
      </div>

      <Modal data={modal} onClose={() => setModal(null)} />
    </div>
  );
}
