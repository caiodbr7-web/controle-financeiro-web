import { Fragment, useMemo, useRef, useState, useCallback } from "react";
import type { Aba, Lancamento, Visao } from "./types";
import { useAuth } from "./hooks/useAuth";
import { useLancamentos } from "./hooks/useLancamentos";
import { useTheme, type ThemePref } from "./lib/theme";
import { ehGasto } from "./lib/finance";
import { Login } from "./components/Login";
import { Modal, type ModalData } from "./components/Modal";
import { Seg } from "./components/ui";
import { Inicio } from "./components/tabs/Inicio";
import { VisaoGeral } from "./components/tabs/VisaoGeral";
import { EvolucaoDiaria } from "./components/tabs/EvolucaoDiaria";
import { ResumoMensal } from "./components/tabs/ResumoMensal";
import { Lancamentos } from "./components/tabs/Lancamentos";
import { Classificar } from "./components/tabs/Classificar";
import { Planejamento } from "./components/tabs/Planejamento";
import { Importar } from "./components/tabs/Importar";
import { Conectar } from "./components/tabs/Conectar";
import { OpenBanking } from "./components/tabs/OpenBanking";
import { Conciliacao } from "./components/tabs/Conciliacao";

type SubAba = { id: Aba; label: string };

/* sub-abas internas das abas de importação */
const SUB_MANUAL: SubAba[] = [
  { id: "importar", label: "Importar" },
  { id: "classificar", label: "Classificar" },
  { id: "lanc", label: "Lançamentos" },
];
const SUB_AUTO: SubAba[] = [
  { id: "conectar", label: "Conectar" },
  { id: "openbanking", label: "Open Banking" },
  { id: "conciliacao", label: "Conciliação" },
];

/* navegação agrupada: Análise · Planejar · Importação.
   As abas com `subs` agrupam sub-abas internas (renderizadas no conteúdo). */
type TopAba = SubAba | { grupo: "manual" | "auto"; label: string; subs: SubAba[] };
const GRUPOS: TopAba[][] = [
  [
    { id: "inicio", label: "Início" },
    { id: "geral", label: "Visão Geral" },
    { id: "mensal", label: "Mensal" },
    { id: "diario", label: "Diário" },
  ],
  [{ id: "planejamento", label: "Planejamento" }],
  [
    { grupo: "manual", label: "Importação Manual", subs: SUB_MANUAL },
    { grupo: "auto", label: "Importação Automática", subs: SUB_AUTO },
  ],
];

function ThemeIcon({ pref }: { pref: ThemePref }) {
  if (pref === "light")
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M18.5 5.5l-1.4 1.4M6.9 17.1l-1.4 1.4" />
      </svg>
    );
  if (pref === "dark")
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.4 14.3A8.4 8.4 0 0 1 9.7 3.6a8.4 8.4 0 1 0 10.7 10.7z" />
      </svg>
    );
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 3.4a8.6 8.6 0 0 1 0 17.2z" fill="currentColor" stroke="none" />
    </svg>
  );
}

const TEMA_TITLE: Record<ThemePref, string> = {
  auto: "Tema: automático (segue o sistema)",
  light: "Tema: claro",
  dark: "Tema: escuro",
};

export default function App() {
  const { logado, erro, entrarGoogle, entrarEmail, sair } = useAuth();
  const { allDados, status, reload } = useLancamentos(!!logado);
  const { pref, cycle } = useTheme();
  const [visao, setVisao] = useState<Visao>("pessoal");
  const [aba, setAba] = useState<Aba>("inicio");
  const [modal, setModal] = useState<ModalData | null>(null);

  // lembra a última sub-aba visitada de cada grupo de importação
  const lastManual = useRef<Aba>("importar");
  const lastAuto = useRef<Aba>("conectar");
  const navTo = useCallback((id: Aba) => {
    if (SUB_MANUAL.some((s) => s.id === id)) lastManual.current = id;
    else if (SUB_AUTO.some((s) => s.id === id)) lastAuto.current = id;
    setAba(id);
  }, []);

  const openModal = useCallback((title: string, rows: Lancamento[]) => {
    if (rows.length) setModal({ title, rows });
  }, []);

  const dados = useMemo(
    () => visao === "ALL" ? allDados
      : allDados.filter((d) => visao === "pessoal" ? d.categoria_manual !== "Corporativo" : d.categoria_manual === "Corporativo"),
    [allDados, visao]
  );
  const months = useMemo(() => [...new Set(dados.map((d) => d.competencia))].sort(), [dados]);

  // pendência global de classificação (pontinho na navegação)
  const pendClass = useMemo(
    () => allDados.reduce((s, d) => s + (ehGasto(d.classe) && !d.categoria_manual ? 1 : 0), 0),
    [allDados]
  );

  if (logado === null) return <div className="p-8 text-muted">Carregando…</div>;
  if (!logado) return <Login onGoogle={entrarGoogle} onEmail={entrarEmail} erro={erro} />;

  const tabProps = { dados, allDados, months, openModal };
  const iconBtn = "w-[30px] h-[30px] rounded-full border border-line bg-transparent text-muted hover:text-txt cursor-pointer flex items-center justify-center transition-colors shrink-0";

  // grupo de sub-abas ativo (mostra a barra interna no conteúdo)
  const subAtivo = SUB_MANUAL.some((s) => s.id === aba)
    ? SUB_MANUAL
    : SUB_AUTO.some((s) => s.id === aba)
      ? SUB_AUTO
      : null;

  return (
    <div>
      <header className="sticky top-0 z-20 bg-bg/80 backdrop-blur-[14px] border-b border-line">
        <div className="max-w-[1380px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-[10px] pt-[10px]">
            <div className="w-[26px] h-[26px] rounded-[8px] bg-gradient-to-br from-[#820ad1] to-[#a855f7] text-white text-[13px] font-bold flex items-center justify-center select-none shrink-0">
              C
            </div>
            <h1 className="text-[15px] font-semibold tracking-tight whitespace-nowrap hidden min-[420px]:block">
              Controle Financeiro
            </h1>
            <div className="ml-auto flex items-center gap-2">
              <Seg
                size="sm"
                value={visao}
                onChange={(v) => setVisao(v as Visao)}
                options={[
                  { v: "pessoal", label: "Pessoal" },
                  { v: "corporativo", label: "Corp." },
                  { v: "ALL", label: "Tudo" },
                ]}
              />
              <button onClick={cycle} title={TEMA_TITLE[pref]} aria-label={TEMA_TITLE[pref]} className={iconBtn}>
                <ThemeIcon pref={pref} />
              </button>
              <button onClick={sair} title="Sair" aria-label="Sair" className={iconBtn}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <path d="M16 17l5-5-5-5M21 12H9" />
                </svg>
              </button>
            </div>
          </div>

          <nav className="flex items-center overflow-x-auto no-scrollbar mt-[2px]">
            {GRUPOS.map((grupo, gi) => (
              <Fragment key={gi}>
                {gi > 0 && <span className="w-px h-[13px] bg-line mx-[7px] shrink-0" aria-hidden />}
                {grupo.map((a) => {
                  const isParent = "subs" in a;
                  const ativo = isParent ? a.subs.some((s) => s.id === aba) : aba === a.id;
                  const onClick = isParent
                    ? () => navTo(a.grupo === "manual" ? lastManual.current : lastAuto.current)
                    : () => navTo(a.id);
                  // pontinho de pendência: aba Classificar ou seu grupo pai (Importação Manual)
                  const dot = isParent ? a.grupo === "manual" && pendClass > 0 : a.id === "classificar" && pendClass > 0;
                  return (
                    <button
                      key={isParent ? a.grupo : a.id}
                      onClick={onClick}
                      className={`relative whitespace-nowrap bg-transparent border-0 px-[10px] pt-[7px] pb-[11px] text-[13.5px] cursor-pointer transition-colors ${
                        ativo ? "text-txt font-semibold" : "text-muted hover:text-txt font-medium"
                      }`}
                    >
                      {a.label}
                      {dot && (
                        <span className="absolute top-[7px] right-[2px] w-[5px] h-[5px] rounded-full bg-amber" title={`${pendClass} lançamentos a classificar`} />
                      )}
                      {ativo && <span className="absolute left-[10px] right-[10px] bottom-0 h-[2px] rounded-full bg-txt" />}
                    </button>
                  );
                })}
              </Fragment>
            ))}
          </nav>
        </div>
      </header>

      <main className="px-4 sm:px-6 lg:px-8 py-5 sm:py-6 max-w-[1380px] mx-auto">
        {status && <div className="text-muted text-[12.5px] mb-3">{status}</div>}

        {subAtivo && (
          <div className="inline-flex gap-[2px] bg-fill p-[3px] rounded-[10px] flex-wrap mb-[18px]">
            {subAtivo.map((s) => {
              const on = aba === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => navTo(s.id)}
                  className={`relative whitespace-nowrap border-0 px-[13px] py-[7px] text-[13px] cursor-pointer rounded-[8px] font-medium transition-all ${
                    on ? "bg-card text-txt shadow-[0_1px_3px_rgba(0,0,0,.16)]" : "bg-transparent text-muted hover:text-txt"
                  }`}
                >
                  {s.label}
                  {s.id === "classificar" && pendClass > 0 && (
                    <span className="absolute top-[5px] right-[3px] w-[5px] h-[5px] rounded-full bg-amber" title={`${pendClass} lançamentos a classificar`} />
                  )}
                </button>
              );
            })}
          </div>
        )}

        <div key={aba} className="fade-in">
          {aba === "inicio" && <Inicio {...tabProps} go={navTo} />}
          {aba === "geral" && <VisaoGeral {...tabProps} />}
          {aba === "mensal" && <ResumoMensal {...tabProps} />}
          {aba === "diario" && <EvolucaoDiaria {...tabProps} />}
          {aba === "planejamento" && <Planejamento lancamentos={dados} />}
          {aba === "classificar" && <Classificar dados={dados} allDados={allDados} openModal={openModal} reload={reload} />}
          {aba === "lanc" && <Lancamentos {...tabProps} reload={reload} />}
          {aba === "importar" && <Importar reload={reload} />}
          {aba === "conectar" && <Conectar reload={reload} />}
          {aba === "openbanking" && <OpenBanking />}
          {aba === "conciliacao" && <Conciliacao />}
        </div>
      </main>

      <Modal data={modal} onClose={() => setModal(null)} />
    </div>
  );
}
