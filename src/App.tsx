import { Fragment, useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { Aba, Lancamento, Visao } from "./types";
import { useAuth } from "./hooks/useAuth";
import { useLancamentos, useSaving } from "./hooks/useLancamentos";
import { useTheme, type ThemePref } from "./lib/theme";
import { precisaClassificar } from "./lib/finance";
import { Login } from "./components/Login";
import { Logo } from "./components/Logo";
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
import { Investimentos } from "./components/tabs/Investimentos";
import { Categorias } from "./components/tabs/Categorias";

type SubAba = { id: Aba; label: string };

/* sub-abas da aba Importação, organizadas por etapa do fluxo:
   trazer dados → categorizar → conferir → cruzar/validar Open Finance */
const SUB_IMPORT: SubAba[] = [
  { id: "adicionar", label: "Adicionar" },
  { id: "classificar", label: "Classificar" },
  { id: "lanc", label: "Lançamentos" },
  { id: "openbanking", label: "Open Banking" },
];
/* sub-abas analíticas — no desktop moram no menu superior; no mobile viram uma
   barra segmentada dentro do conteúdo (a navegação principal é a barra inferior). */
const ANALISE_SUB: SubAba[] = [
  { id: "geral", label: "Visão Geral" },
  { id: "mensal", label: "Mensal" },
  { id: "diario", label: "Diário" },
  { id: "investimentos", label: "Investimentos" },
];
/* navegação agrupada: Análise · Planejar · Importação.
   As abas com `subs` agrupam sub-abas internas (renderizadas no conteúdo). */
type TopAba = SubAba | { grupo: "importacao"; label: string; subs: SubAba[] };
const GRUPOS: TopAba[][] = [
  [
    { id: "inicio", label: "Início" },
    { id: "geral", label: "Visão Geral" },
    { id: "mensal", label: "Mensal" },
    { id: "diario", label: "Diário" },
    { id: "investimentos", label: "Investimentos" },
  ],
  [{ id: "planejamento", label: "Planejamento" }],
  [{ grupo: "importacao", label: "Importação", subs: SUB_IMPORT }],
  [{ id: "categorias", label: "Categorias" }],
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

/* ===== barra de navegação inferior (mobile, < md) =====
   5 destinos principais em alvos grandes, alcançáveis com o polegar. Cada item
   ativa quando a aba atual pertence ao seu conjunto (`match`). */
const NAV_ICON = {
  inicio: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" /><path d="M9.5 21v-6h5v6" /></svg>
  ),
  analise: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20V4" /><path d="M4 20h16" /><path d="M8 16l3.5-4 3 2.5L20 8" /></svg>
  ),
  importar: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><path d="m8 11 4 4 4-4" /><path d="M5 21h14" /></svg>
  ),
  planejar: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="3.5" y="4.5" width="17" height="16" rx="2.5" /><path d="M3.5 9h17M8 3v3M16 3v3M7.5 13h3M7.5 16.5h6" /></svg>
  ),
  categorias: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6.5h13M3 12h18M3 17.5h9" /><circle cx="19.5" cy="6.5" r="1.6" fill="currentColor" stroke="none" /><circle cx="16.5" cy="17.5" r="1.6" fill="currentColor" stroke="none" /></svg>
  ),
};
type NavItem = { key: string; label: string; icon: JSX.Element; target: Aba | "last-analise" | "last-import"; match: Set<Aba>; dot?: boolean };

export default function App() {
  const { logado, erro, demo, entrarGoogle, entrarTeste, sair } = useAuth();
  const { allDados, status, reload, loading, patchLocal, mutate, enqueue } = useLancamentos(!!logado);
  const saving = useSaving();
  const { pref, cycle } = useTheme();
  const [visao, setVisao] = useState<Visao>("pessoal");
  const [aba, setAba] = useState<Aba>("inicio");
  const [modal, setModal] = useState<ModalData | null>(null);
  const [paletaAberta, setPaletaAberta] = useState(false);
  // método ativo da aba Adicionar (arquivo manual × banco via Open Finance)
  const [addMetodo, setAddMetodo] = useState<MetodoAdd>("arquivo");

  // lembra a última sub-aba visitada de cada grupo com sub-abas.
  // Classificar é a aba inicial do menu Importação: garantir que todo movimento
  // passe pela classificação é o fluxo principal ao abrir Importação.
  const lastImport = useRef<Aba>("classificar");
  const lastAnalise = useRef<Aba>("geral");
  const navTo = useCallback((id: Aba) => {
    if (SUB_IMPORT.some((s) => s.id === id)) lastImport.current = id;
    if (ANALISE_SUB.some((s) => s.id === id)) lastAnalise.current = id;
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
    () => allDados.reduce((s, d) => s + (precisaClassificar(d) ? 1 : 0), 0),
    [allDados]
  );

  // comandos da paleta (Cmd/Ctrl+K): navegação + ações rápidas
  const comandos = useMemo<Cmd[]>(() => [
    { id: "inicio", label: "Início", grupo: "Análise", keywords: "home resumo", run: () => navTo("inicio") },
    { id: "geral", label: "Visão Geral", grupo: "Análise", keywords: "evolucao mensal receitas despesas", run: () => navTo("geral") },
    { id: "mensal", label: "Resumo Mensal", grupo: "Análise", keywords: "categorias rosca pizza", run: () => navTo("mensal") },
    { id: "diario", label: "Evolução Diária", grupo: "Análise", keywords: "acumulado dia", run: () => navTo("diario") },
    { id: "investimentos", label: "Investimentos", grupo: "Análise", keywords: "investimento patrimonio caixa saldo contas banco renda fixa fundos acoes etf previdencia pluggy open finance carteira", run: () => navTo("investimentos") },
    { id: "planejamento", label: "Planejamento", grupo: "Planejar", keywords: "orcamento projecao metas parcelas", run: () => navTo("planejamento") },
    { id: "categorias", label: "Categorias", grupo: "Ações", keywords: "categoria adicionar apagar editar ordem cor gerenciar", run: () => navTo("categorias") },
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
  if (!logado) return <Login onGoogle={entrarGoogle} onTeste={entrarTeste} erro={erro} />;

  const tabProps = { dados, allDados, months, openModal, patchLocal, mutate, enqueue };
  const iconBtn = "tap w-[28px] h-[28px] rounded-full border border-line bg-transparent text-muted cursor-pointer flex items-center justify-center transition-all shrink-0";

  // grupos de sub-abas: Importação aparece em todos os tamanhos; Análise só no
  // mobile (no desktop essas abas moram na navegação superior).
  const subImportAtivo = SUB_IMPORT.some((s) => s.id === aba);
  const subAnaliseAtivo = ANALISE_SUB.some((s) => s.id === aba);

  // barra segmentada de sub-abas (reutilizada por Importação e Análise)
  const subTabBar = (subs: SubAba[], extraCls = "") => (
    <div className={`inline-flex gap-[2px] bg-soft p-[3px] rounded-[10px] flex-wrap mb-[18px] ${extraCls}`}>
      {subs.map((s) => {
        const on = aba === s.id;
        return (
          <button
            key={s.id}
            onClick={() => navTo(s.id)}
            aria-current={on ? "page" : undefined}
            className={`relative whitespace-nowrap border-0 px-[13px] py-[9px] text-[13px] cursor-pointer rounded-[8px] transition-all ${
              on ? "bg-card text-accent font-bold shadow-card" : "bg-transparent text-muted hover:text-txt font-medium"
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
  );

  // itens da barra inferior (mobile)
  const navItems: NavItem[] = [
    { key: "inicio", label: "Início", icon: NAV_ICON.inicio, target: "inicio", match: new Set<Aba>(["inicio"]) },
    { key: "analise", label: "Análise", icon: NAV_ICON.analise, target: "last-analise", match: new Set<Aba>(ANALISE_SUB.map((s) => s.id)) },
    { key: "importar", label: "Importar", icon: NAV_ICON.importar, target: "last-import", match: new Set<Aba>(SUB_IMPORT.map((s) => s.id)), dot: pendClass > 0 },
    { key: "planejar", label: "Planejar", icon: NAV_ICON.planejar, target: "planejamento", match: new Set<Aba>(["planejamento"]) },
    { key: "categorias", label: "Categorias", icon: NAV_ICON.categorias, target: "categorias", match: new Set<Aba>(["categorias"]) },
  ];
  const goNav = (it: NavItem) =>
    navTo(it.target === "last-analise" ? lastAnalise.current : it.target === "last-import" ? lastImport.current : it.target);

  return (
    <div>
      <header className="sticky top-0 z-20 bg-bg/80 backdrop-blur-[14px] border-b border-line">
        <div className="max-w-[1380px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-[10px] pt-[7px]">
            <Logo size={30} radius={9} className="shrink-0 select-none" />
            <h1 className="font-display text-[15px] font-bold tracking-tight whitespace-nowrap hidden min-[420px]:block">
              Controle Financeiro
            </h1>
            {demo && (
              <span
                title="Você está no modo teste: os dados são fictícios e ficam só no seu navegador."
                className="inline-flex items-center gap-[5px] h-[20px] rounded-full bg-amber/15 text-amber border border-amber/30 px-[8px] text-[11px] font-semibold whitespace-nowrap shrink-0"
              >
                <span className="w-[5px] h-[5px] rounded-full bg-amber" />
                Modo teste
              </span>
            )}
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => setPaletaAberta(true)}
                title="Buscar e navegar (Ctrl/⌘K)"
                aria-label="Buscar e navegar"
                className="hidden sm:inline-flex items-center gap-2 h-[28px] rounded-full border border-line bg-transparent text-muted hover:text-txt hover:border-accent cursor-pointer pl-[10px] pr-[8px] transition-colors shrink-0"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" strokeLinecap="round" /></svg>
                <span className="text-[12.5px]">Buscar</span>
                <kbd className="kbd">⌘K</kbd>
              </button>
              <button onClick={() => setPaletaAberta(true)} title="Buscar e navegar" aria-label="Buscar e navegar" className={`sm:hidden ${iconBtn} hover:text-txt hover:border-accent`}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" strokeLinecap="round" /></svg>
              </button>
              <button
                onClick={cycleVisao}
                title={`Visão: ${VISAO_LABEL[visao]} — clique para alternar`}
                aria-label={`Visão: ${VISAO_LABEL[visao]} (clique para alternar)`}
                className="inline-flex items-center gap-[6px] h-[28px] rounded-full border border-line bg-transparent text-muted hover:text-txt hover:border-accent cursor-pointer pl-[10px] pr-[12px] text-[12.5px] font-medium transition-colors shrink-0"
              >
                <span className={`w-[7px] h-[7px] rounded-full shrink-0 ${visao === "pessoal" ? "bg-accent" : visao === "corporativo" ? "bg-amber" : "bg-muted"}`} />
                {VISAO_LABEL[visao]}
              </button>
              <button onClick={cycle} title={TEMA_TITLE[pref]} aria-label={TEMA_TITLE[pref]} className={`${iconBtn} hover:text-accent hover:border-accent hover:-rotate-12`}>
                <ThemeIcon pref={pref} />
              </button>
              <button onClick={sair} title="Sair" aria-label="Sair" className={`${iconBtn} hover:text-red hover:border-red`}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <path d="M16 17l5-5-5-5M21 12H9" />
                </svg>
              </button>
            </div>
          </div>

          <nav className="hidden md:flex items-center overflow-x-auto no-scrollbar mt-[1px]">
            {GRUPOS.map((grupo, gi) => (
              <Fragment key={gi}>
                {gi > 0 && <span className="w-px h-[13px] bg-line mx-[7px] shrink-0" aria-hidden />}
                {grupo.map((a) => {
                  const isParent = "subs" in a;
                  const ativo = isParent ? a.subs.some((s) => s.id === aba) : aba === a.id;
                  const onClick = isParent
                    ? () => navTo(lastImport.current)
                    : () => navTo(a.id);
                  // pontinho de pendência: aba Classificar ou seu grupo pai (Importação)
                  const dot = isParent ? a.grupo === "importacao" && pendClass > 0 : a.id === "classificar" && pendClass > 0;
                  return (
                    <button
                      key={isParent ? a.grupo : a.id}
                      onClick={onClick}
                      aria-current={ativo ? "page" : undefined}
                      className={`relative whitespace-nowrap bg-transparent border-0 px-[10px] pt-[5px] pb-[8px] text-[13px] cursor-pointer transition-colors ${
                        ativo ? "text-accent font-bold" : "text-muted hover:text-txt font-medium"
                      }`}
                    >
                      {a.label}
                      {dot && (
                        <span className="absolute top-[7px] right-[2px] w-[5px] h-[5px] rounded-full bg-amber" title={`${pendClass} lançamentos a classificar`} />
                      )}
                      {ativo && <span className="absolute left-[10px] right-[10px] bottom-0 h-[2px] rounded-full bg-accent" />}
                    </button>
                  );
                })}
              </Fragment>
            ))}
          </nav>
        </div>
      </header>

      <main className="px-4 sm:px-6 lg:px-8 py-5 sm:py-6 max-w-[1380px] mx-auto pb-bottomnav">
        {status && !loading && (
          <div className="inline-flex items-center gap-2 text-muted text-[12.5px] mb-3 bg-fill rounded-full px-[10px] py-[4px]">
            <span className="w-[8px] h-[8px] rounded-full border-2 border-muted/40 border-t-muted animate-spin" />
            {status}
          </div>
        )}

        {/* indicador global de escritas em background (fila do banco): a UI já
            atualizou de forma otimista; isto só sinaliza que a persistência
            ainda está acontecendo, sem travar nada. */}
        {saving && !status && (
          <div className="fixed bottom-[76px] md:bottom-4 right-4 z-40 inline-flex items-center gap-2 text-muted text-[12.5px] bg-card border border-line shadow-card rounded-full px-[12px] py-[6px]">
            <span className="w-[8px] h-[8px] rounded-full border-2 border-muted/40 border-t-accent animate-spin" />
            salvando…
          </div>
        )}

        {subImportAtivo && subTabBar(SUB_IMPORT)}
        {subAnaliseAtivo && subTabBar(ANALISE_SUB, "md:hidden")}

        {loading && ABAS_DADOS.has(aba) ? (
          aba === "inicio" ? <SkInicio /> : <SkTabela />
        ) : (
        <div key={aba} className="fade-in">
          {aba === "inicio" && <Inicio {...tabProps} go={navTo} />}
          {aba === "geral" && <VisaoGeral {...tabProps} />}
          {aba === "mensal" && <ResumoMensal {...tabProps} />}
          {aba === "diario" && <EvolucaoDiaria {...tabProps} />}
          {aba === "planejamento" && <Planejamento lancamentos={dados} />}
          {aba === "classificar" && <Classificar dados={dados} allDados={allDados} openModal={openModal} reload={reload} patchLocal={patchLocal} mutate={mutate} enqueue={enqueue} />}
          {aba === "lanc" && <Lancamentos {...tabProps} reload={reload} />}
          {aba === "adicionar" && <Adicionar reload={reload} metodo={addMetodo} onMetodo={setAddMetodo} allDados={allDados} />}
          {aba === "openbanking" && <OpenBanking />}
          {aba === "investimentos" && <Investimentos />}
          {aba === "categorias" && <Categorias reload={reload} />}
        </div>
        )}
      </main>

      {/* ===== navegação inferior (mobile) ===== */}
      <nav
        aria-label="Navegação principal"
        className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-bg/90 backdrop-blur-[14px] border-t border-line pb-safe"
      >
        <div className="flex items-stretch justify-around max-w-[560px] mx-auto px-1">
          {navItems.map((it) => {
            const ativo = it.match.has(aba);
            return (
              <button
                key={it.key}
                onClick={() => goNav(it)}
                aria-current={ativo ? "page" : undefined}
                className={`relative flex-1 flex flex-col items-center justify-center gap-[3px] py-[8px] min-h-[58px] bg-transparent border-0 cursor-pointer transition-colors ${
                  ativo ? "text-accent" : "text-muted"
                }`}
              >
                <span className="relative">
                  {it.icon}
                  {it.dot && <span className="absolute -top-[2px] -right-[3px] w-[7px] h-[7px] rounded-full bg-amber ring-2 ring-bg" title={`${pendClass} a classificar`} />}
                </span>
                <span className={`text-[10.5px] leading-none tracking-tight ${ativo ? "font-bold" : "font-medium"}`}>{it.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      <Modal data={modal} onClose={() => setModal(null)} mutate={mutate} />
      <CommandPalette open={paletaAberta} onClose={() => setPaletaAberta(false)} commands={comandos} />
    </div>
  );
}
