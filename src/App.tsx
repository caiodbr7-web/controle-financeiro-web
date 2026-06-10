import { useEffect, useMemo, useState, useCallback } from "react";
import { sb } from "./lib/supabase";
import type { Lancamento, Visao } from "./types";
import { Login } from "./components/Login";
import { Modal, type ModalData } from "./components/Modal";
import { Select } from "./components/ui";
import { VisaoGeral } from "./components/tabs/VisaoGeral";
import { EvolucaoDiaria } from "./components/tabs/EvolucaoDiaria";
import { ResumoMensal } from "./components/tabs/ResumoMensal";
import { Arquivos } from "./components/tabs/Arquivos";
import { Lancamentos } from "./components/tabs/Lancamentos";

type Aba = "geral" | "diario" | "mesdet" | "arquivos" | "lanc";
const ABAS: { id: Aba; label: string }[] = [
  { id: "geral", label: "Visão Geral" },
  { id: "diario", label: "Evolução Diária" },
  { id: "mesdet", label: "Resumo Mensal" },
  { id: "arquivos", label: "Arquivos" },
  { id: "lanc", label: "Lançamentos" },
];

export default function App() {
  const [logado, setLogado] = useState<boolean | null>(null);
  const [erro, setErro] = useState("");
  const [status, setStatus] = useState("");
  const [allDados, setAllDados] = useState<Lancamento[]>([]);
  const [visao, setVisao] = useState<Visao>("pessoal");
  const [aba, setAba] = useState<Aba>("geral");
  const [modal, setModal] = useState<ModalData | null>(null);

  const openModal = useCallback((title: string, rows: Lancamento[]) => {
    if (rows.length) setModal({ title, rows });
  }, []);

  const carregar = useCallback(async () => {
    setStatus("carregando lançamentos...");
    const PAGINA = 1000;
    let todos: Lancamento[] = [], de = 0;
    while (true) {
      const { data, error } = await sb
        .from("lancamentos").select("*")
        .order("competencia", { ascending: false }).order("origem").order("id")
        .range(de, de + PAGINA - 1);
      if (error) { setStatus("erro: " + error.message); return; }
      todos = todos.concat((data || []) as Lancamento[]);
      if (!data || data.length < PAGINA) break;
      de += PAGINA;
    }
    setAllDados(todos);
    setStatus("");
  }, []);

  useEffect(() => {
    const { data: sub } = sb.auth.onAuthStateChange((_ev, session) => setLogado(!!session));
    sb.auth.getSession().then(({ data }) => setLogado(!!data.session));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => { if (logado) carregar(); }, [logado, carregar]);

  async function entrarGoogle() {
    setErro("");
    const { error } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: location.origin + location.pathname },
    });
    if (error) setErro("Falha no login Google: " + error.message);
  }
  async function entrarEmail(email: string, senha: string) {
    setErro("");
    const { error } = await sb.auth.signInWithPassword({ email, password: senha });
    if (error) setErro("Falha no login: " + error.message);
  }
  async function sair() { await sb.auth.signOut(); setAllDados([]); }

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
      <header className="sticky top-0 z-20 flex flex-wrap gap-[10px] items-center justify-between px-[clamp(14px,2.6vw,32px)] py-3 bg-bg/85 backdrop-blur-[14px] border-b border-line">
        <h1 className="text-[17px] font-semibold tracking-tight">Controle Financeiro</h1>
        <div className="flex gap-2 items-center">
          <label className="text-muted text-[13px]">Visão:</label>
          <Select value={visao} onChange={(v) => setVisao(v as Visao)}>
            <option value="ALL">Completo</option>
            <option value="pessoal">Pessoal</option>
            <option value="corporativo">Corporativo</option>
          </Select>
          <button onClick={sair} className="bg-transparent border border-line text-muted rounded-[10px] px-4 py-[10px] cursor-pointer hover:text-txt">Sair</button>
        </div>
      </header>

      <div className="p-[clamp(14px,2.6vw,32px)] max-w-[1380px] mx-auto">
        <div className="flex gap-[2px] bg-[#ececf0] p-1 rounded-[12px] mb-[22px] overflow-x-auto no-scrollbar">
          {ABAS.map((a) => (
            <button
              key={a.id}
              onClick={() => setAba(a.id)}
              className={`whitespace-nowrap border-0 px-4 py-2 text-sm cursor-pointer rounded-[9px] font-medium transition ${
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
        {aba === "arquivos" && <Arquivos {...tabProps} />}
        {aba === "lanc" && <Lancamentos {...tabProps} reload={carregar} />}
      </div>

      <Modal data={modal} onClose={() => setModal(null)} />
    </div>
  );
}
