import { Fragment, useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { Aba, Lancamento, Visao } from "./types";
import { useAuth } from "./hooks/useAuth";
import { useLancamentos } from "./hooks/useLancamentos";
import { useTheme, type ThemePref } from "./lib/theme";
import { ehGasto } from "./lib/finance";
import { Login } from "./components/Login";
import { Modal, type ModalData } from "./components/Modal";
import { CommandPalette, type Cmd } from "./components/CommandPalette";
import { SkInicio, SkTabela } from "./components/Skeleton";
import { Inicio } from "./components/tabs/Inicio";
import { VisaoGeral } from "./components/tabs/VisaoGeral";
import { EvolucaoDiaria } from "./components/tabs/EvolucaoDiaria";
import { ResumoMensal } from "./components/tabs/ResumoMensal";
import { Lancamentos } from "./components/tabs/Lancamentos";
import { Classificar } from "./components/tabs/Classificar";
import { Planejamento } from "./components/tabs/Planejamento";
import { Adicionar, type MetodoAdd } from "./components/tabs/Adicionar";
import { OpenBanking } from "./components/tabs/OpenBanking";
import { Saldo } from "./components/tabs/Saldo";
import { Investimentos } from "./components/tabs/Investimentos";

type SubAba = { id: Aba; label: string };

/* sub-abas da aba Importação, organizadas por etapa do fluxo:
   trazer dados → categorizar → conferir → cruzar/validar Open Finance */
const SUB_IMPORT: SubAba[] = [
  { id: "adicionar", label: "Adicionar" },
  { id: "classificar", label: "Classificar" },
  { id: "lanc", label: "Lançamentos" },
  { id: "openbanking", label: "Open Banking" },
];
/* sub-abas da aba Saldo (saldos das contas via Open Finance) */
const SUB_SALDO: SubAba[] = [
  { id: "saldo_evolucao", label: "Evolução" },
  { id: "saldo_dados", label: "Dados" },
];

/* navegação agrupada: Análise · Planejar · Importação.
   As abas com `subs` agrupam sub-abas internas (renderizadas no conteúdo). */
type TopAba = SubAba | { grupo: "saldo" | "importacao"; label: string; subs: SubAba[] };
const GRUPOS: TopAba[][] = [
  [
    { id: "inicio", label: "Início" },
    { id: "geral", label: "Visão Geral" },
    { id: "mensal", label: "Mensal" },
    { id: "diario", label: "Diário" },
    { grupo: "saldo", label: "Saldo", subs: SUB_SALDO },
    { id: "investimentos", label: "Investimentos" },
  ],
  [{ id: "planejamento", label: "Planejamento" }],
  [{ grupo: "importacao", label: "Importação", subs: SUB_IMPORT }],
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

// ordem do botão de visão (clique alterna Pessoal → Corp. → Tudo)
const VISAO_ORDER: Visao[] = ["pessoal", "corporativo", "ALL"];
const VISAO_LABEL: Record<Visao, string> = {
  pessoal: "Pessoal",
  corporativo: "Corp.",
  ALL: "Tudo",
};

// abas analíticas que dependem dos lançamentos (mostram skeleton na 1ª carga)
const ABAS_DADOS = new Set<Aba>(["inicio", "geral", "mensal", "diario", "planejamento", "classificar", "lanc"]);

export default function App() {
  const { logado, erro, entrarGoogle, sair } = useAuth();
  const { allDados, status, reload, loading } = useLancamentos(!!logado);
  const { pref, cycle } = useTheme();
  const [visao, setVisao] = useState<Visao>("pessoal");
  const [aba, setAba] = useState<Aba>("inicio");
  const [modal, setModal] = useState<ModalData | null>(null);
  const [paletaAberta, setPaletaAberta] = useState(false);
  // método ativo da aba Adicionar (arquivo manual × banco via Open Finance)
  const [addMetodo, setAddMetodo] = useState<MetodoAdd>("arquivo");

  // lembra a última sub-aba visitada de cada grupo com sub-abas
  const lastImport = useRef<Aba>("adicionar");
  const lastSaldo = useRef<Aba>("saldo_evolucao");
  const navTo = useCallback((id: Aba) => {
    if (SUB_IMPORT.some((s) => s.id === id)) lastImport.current = id;
    else if (SUB_SALDO.some((s) => s.id === id)) lastSaldo.current = id;
    setAba(id);
  }, []);

  // atalho global: Cmd/Ctrl+K abre a paleta de comandos
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) { e.preventDefault(); setPaletaAberta((o) => !o); }
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, []);

  const openModal = useCallback((title: string, rows: Lancamento[]) => {
    if (rows.length) setModal({ title, rows });
  }, []);

  // botão único de visão: alterna Pessoal → Corp. → Tudo a cada clique
  const cycleVisao = () => {
    const i = VISAO_ORDER.indexOf(visao);
    setVisao(VISAO_ORDER[(i + 1) % VISAO_ORDER.length]);
  };

  const dados = useMemo(
    () => visao === "ALL" ? allDados
      : allDados.filter((d) => visao === "pessoal" ? d.categoria_manual !== "Corporativo" : d.categoria_manual === "Corporativo"),
    [allDados, visao]
  );
  // competências até o mês civil atual (rows de competência futura são alocados
  // pela data real da compra; não devem criar meses-fantasma nas abas por competência)
  const months = useMemo(() => {
    const h = new Date();
    const curK = h.getFullYear() + "-" + String(h.getMonth() + 1).padStart(2, "0");
    return [...new Set(dados.map((d) => d.competencia))].filter((c) => String(c).slice(0, 7) <= curK).sort();
  }, [dados]);

  // pendência global de classificação (pontinho na navegação)
  const pendClass = useMemo(
    () => allDados.reduce((s, d) => s + (ehGasto(d.classe) && !d.categoria_manual ? 1 : 0), 0),
    [allDados]
  );

  // comandos da paleta (Cmd/Ctrl+K): navegação + ações rápidas
  const comandos = useMemo<Cmd[]>(() => [
    { id: "inicio", label: "Início", grupo: "Análise", keywords: "home resumo", run: () => navTo("inicio") },
    { id: "geral", label: "Visão Geral", grupo: "Análise", keywords: "evolucao mensal receitas despesas", run: () => navTo("geral") },
    { id: "mensal", label: "Resumo Mensal", grupo: "Análise", keywords: "categorias rosca pizza", run: () => navTo("mensal") },
    { id: "diario", label: "Evolução Diária", grupo: "Análise", keywords: "acumulado dia", run: () => navTo("diario") },
    { id: "saldo_evolucao", label: "Saldo · Evolução", grupo: "Análise", keywords: "saldo contas banco grafico open finance patrimonio", run: () => navTo("saldo_evolucao") },
    { id: "saldo_dados", label: "Saldo · Dados", grupo: "Análise", keywords: "saldo tabela contas diario csv", run: () => navTo("saldo_dados") },
    { id: "investimentos", label: "Investimentos", grupo: "Análise", keywords: "investimento patrimonio renda fixa fundos acoes etf previdencia pluggy open finance carteira", run: () => navTo("investimentos") },
    { id: "planejamento", label: "Planejamento", grupo: "Planejar", keywords: "orcamento projecao metas parcelas", run: () => navTo("planejamento") },
    { id: "importar", label: "Importar arquivo", grupo: "Importação", keywords: "csv excel ofx upload extrato fatura adicionar", run: () => { setAddMetodo("arquivo"); navTo("adicionar"); } },
    { id: "conectar", label: "Conectar banco", grupo: "Importação", keywords: "pluggy open finance sincronizar adicionar", run: () => { setAddMetodo("banco"); navTo("adicionar"); } },
    { id: "classificar", label: "Classificar", grupo: "Importação", keywords: "categorizar pendencias", dot: pendClass > 0, hint: pendClass > 0 ? String(pendClass) : undefined, run: () => navTo("classificar") },
    { id: "lanc", label: "Lançamentos", grupo: "Importação", keywords: "tabela transacoes exportar", run: () => navTo("lanc") },
    { id: "openbanking", label: "Open Banking", grupo: "Importação", keywords: "pluggy validacao", run: () => navTo("openbanking") },
    { id: "tema", label: "Alternar tema", grupo: "Ações", keywords: "claro escuro dark light", run: cycle },
    { id: "v-pessoal", label: "Visão: Pessoal", grupo: "Ações", run: () => setVisao("pessoal") },
    { id: "v-corp", label: "Visão: Corporativo", grupo: "Ações", keywords: "trabalho", run: () => setVisao("corporativo") },
    { id: "v-tudo", label: "Visão: Tudo", grupo: "Ações", run: () => setVisao("ALL") },
    { id: "sair", label: "Sair", grupo: "Ações", keywords: "logout deslogar", run: sair },
  ], [navTo, pendClass, cycle, sair]);

  if (logado === null) return <div className="p-8 text-muted">Carregando…</div>;
  if (!logado) return <Login onGoogle={entrarGoogle} erro={erro} />;

  const tabProps = { dados, allDados, months, openModal };
  const iconBtn = "w-[28px] h-[28px] rounded-full border border-line bg-transparent text-muted hover:text-txt cursor-pointer flex items-center justify-center transition-colors shrink-0";

  // grupo de sub-abas ativo (mostra a barra interna no conteúdo)
  const subAtivo = SUB_IMPORT.some((s) => s.id === aba)
    ? SUB_IMPORT
    : SUB_SALDO.some((s) => s.id === aba)
      ? SUB_SALDO
      : null;

  // as duas sub-abas de Saldo compartilham o mesmo componente: chave estável
  // entre elas evita refazer o fetch ao alternar (só refaz ao trocar de aba-topo)
  const ehSaldo = aba === "saldo_evolucao" || aba === "saldo_dados";
  const viewKey = ehSaldo ? "saldo" : aba;

  return (
    <div>
      <header className="sticky top-0 z-20 bg-bg/80 backdrop-blur-[14px] border-b border-line">
        <div className="max-w-[1380px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-[10px] pt-[7px]">
            <div className="w-[24px] h-[24px] rounded-[7px] bg-gradient-to-br from-[#820ad1] to-[#a855f7] text-white text-[12px] font-bold flex items-center justify-center select-none shrink-0">
              C
            </div>
            <h1 className="text-[15px] font-semibold tracking-tight whitespace-nowrap hidden min-[420px]:block">
              Controle Financeiro
            </h1>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => setPaletaAberta(true)}
                title="Buscar e navegar (Ctrl/⌘K)"
                aria-label="Buscar e navegar"
                className="hidden sm:inline-flex items-center gap-2 h-[28px] rounded-full border border-line bg-transparent text-muted hover:text-txt hover:border-muted/60 cursor-pointer pl-[10px] pr-[8px] transition-colors shrink-0"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" strokeLinecap="round" /></svg>
                <span className="text-[12.5px]">Buscar</span>
                <kbd className="kbd">⌘K</kbd>
              </button>
              <button onClick={() => setPaletaAberta(true)} title="Buscar e navegar" aria-label="Buscar e navegar" className={`sm:hidden ${iconBtn}`}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" strokeLinecap="round" /></svg>
              </button>
              <button
                onClick={cycleVisao}
                title={`Visão: ${VISAO_LABEL[visao]} — clique para alternar`}
                aria-label={`Visão: ${VISAO_LABEL[visao]} (clique para alternar)`}
                className="inline-flex items-center gap-[6px] h-[28px] rounded-full border border-line bg-transparent text-muted hover:text-txt hover:border-muted/60 cursor-pointer pl-[10px] pr-[12px] text-[12.5px] font-medium transition-colors shrink-0"
              >
                <span className={`w-[7px] h-[7px] rounded-full shrink-0 ${visao === "pessoal" ? "bg-accent" : visao === "corporativo" ? "bg-amber" : "bg-muted"}`} />
                {VISAO_LABEL[visao]}
              </button>
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

          <nav className="flex items-center overflow-x-auto no-scrollbar mt-[1px]">
            {GRUPOS.map((grupo, gi) => (
              <Fragment key={gi}>
                {gi > 0 && <span className="w-px h-[13px] bg-line mx-[7px] shrink-0" aria-hidden />}
                {grupo.map((a) => {
                  const isParent = "subs" in a;
                  const ativo = isParent ? a.subs.some((s) => s.id === aba) : aba === a.id;
                  const onClick = isParent
                    ? () => navTo(a.grupo === "saldo" ? lastSaldo.current : lastImport.current)
                    : () => navTo(a.id);
                  // pontinho de pendência: aba Classificar ou seu grupo pai (Importação)
                  const dot = isParent ? a.grupo === "importacao" && pendClass > 0 : a.id === "classificar" && pendClass > 0;
                  return (
                    <button
                      key={isParent ? a.grupo : a.id}
                      onClick={onClick}
                      aria-current={ativo ? "page" : undefined}
                      className={`relative whitespace-nowrap bg-transparent border-0 px-[10px] pt-[5px] pb-[8px] text-[13px] cursor-pointer transition-colors ${
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
        {status && !loading && (
          <div className="inline-flex items-center gap-2 text-muted text-[12.5px] mb-3 bg-fill rounded-full px-[10px] py-[4px]">
            <span className="w-[8px] h-[8px] rounded-full border-2 border-muted/40 border-t-muted animate-spin" />
            {status}
          </div>
        )}

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

        {loading && ABAS_DADOS.has(aba) ? (
          aba === "inicio" ? <SkInicio /> : <SkTabela />
        ) : (
        <div key={viewKey} className="fade-in">
          {aba === "inicio" && <Inicio {...tabProps} go={navTo} />}
          {aba === "geral" && <VisaoGeral {...tabProps} />}
          {aba === "mensal" && <ResumoMensal {...tabProps} />}
          {aba === "diario" && <EvolucaoDiaria {...tabProps} />}
          {aba === "planejamento" && <Planejamento lancamentos={dados} />}
          {aba === "classificar" && <Classificar dados={dados} allDados={allDados} openModal={openModal} reload={reload} />}
          {aba === "lanc" && <Lancamentos {...tabProps} reload={reload} />}
          {aba === "adicionar" && <Adicionar reload={reload} metodo={addMetodo} onMetodo={setAddMetodo} allDados={allDados} />}
          {aba === "openbanking" && <OpenBanking />}
          {aba === "investimentos" && <Investimentos />}
          {ehSaldo && <Saldo aba={aba} />}
        </div>
        )}
      </main>

      <Modal data={modal} onClose={() => setModal(null)} />
      <CommandPalette open={paletaAberta} onClose={() => setPaletaAberta(false)} commands={comandos} />
    </div>
  );
}
