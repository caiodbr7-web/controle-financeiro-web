import { useState, useCallback, useEffect } from "react";
import { sb } from "../lib/supabase";
import { mesAtual } from "../lib/projecao";
import type { Lancamento } from "../types";

// ---------------------------------------------------------------------------
// Fonte por período — evita DUPLA CONTAGEM entre PDF e Open Banking.
// As duas fontes cobrem meses sobrepostos (cada transação aparece nas duas);
// por isso cada mês deve vir de UMA fonte só. Regra (por competência "YYYY-MM"):
//     competência <  CORTE                    ->  PDF (histórico curado)
//     CORTE <= competência <= mês atual        ->  Open Banking (Pluggy)
//     competência >  mês atual                 ->  OCULTO (faturas futuras que o Pluggy
//                                                  adianta — não são gasto realizado;
//                                                  ver Planejamento)
// Para voltar a só-PDF, use um corte no futuro distante (ex.: "9999-99");
// para tudo via Open Banking, use "0000-00".
// As abas Conciliação e Open Banking NÃO usam este hook (têm query própria),
// então continuam vendo as duas fontes (e os meses futuros) para validação.
// ---------------------------------------------------------------------------
const CORTE_OPEN_BANKING = "2026-05"; // Open Banking assume deste mês em diante.
// Movido de 2026-06 -> 2026-05: os lançamentos de maio vêm do Open Finance (pluggy)
// e ficavam ocultos do lado errado do corte, deixando maio vazio nos dashboards por
// competência. Agora maio sai do Open Finance; o PDF curado cobre só abril e antes.

// Corte por usuário: alguns acessos não têm histórico em PDF e sincronizam TUDO
// via Open Banking (desde sempre). Para esses, o corte vai para "0000-00", que é
// menor que qualquer competência válida — assim nenhuma linha de PDF aparece e
// todo o Open Finance (até o mês atual) entra. Demais usuários usam o corte padrão.
const CORTE_TUDO_OPEN_BANKING = "0000-00";
const CORTE_POR_USUARIO: Record<string, string> = {
  "sofiatcenci@gmail.com.br": CORTE_TUDO_OPEN_BANKING,
};
/** Corte de fonte aplicável ao usuário logado (e-mail), normalizado. */
function corteParaEmail(email?: string | null): string {
  const e = (email || "").trim().toLowerCase();
  return CORTE_POR_USUARIO[e] ?? CORTE_OPEN_BANKING;
}

const compKey = (d: Lancamento) => String(d.competencia || "").slice(0, 7);
// Uma competência só posiciona a linha no corte se for um "YYYY-MM" válido. Sem
// isso, "" (competência nula/corrompida) passaria em `"" < CORTE` e uma linha
// sem âncora de mês entraria nos dashboards do lado do PDF — contando num mês
// que não é o dela. Conservador: competência inválida = OCULTA (auditoria W2).
const COMP_RE = /^\d{4}-\d{2}$/;
/** Um lançamento é visível nos dashboards se está do lado certo do corte. */
export function lancVisivel(d: Lancamento, corte: string = CORTE_OPEN_BANKING): boolean {
  const m = compKey(d);
  if (!COMP_RE.test(m)) return false; // sem competência válida não há lado do corte
  return d.fonte_dados === "pluggy"
    ? m >= corte && m <= mesAtual() // OF: do corte até o mês atual (sem futuro)
    : m < corte; // PDF (fonte nula/pdf): antes do corte
}

/** Carrega todos os lançamentos (paginado) e aplica o corte de fonte por período. */
export function useLancamentos(ativo: boolean) {
  const [allDados, setAllDados] = useState<Lancamento[]>([]);
  const [status, setStatus] = useState("");
  const [carregou, setCarregou] = useState(false); // já completou a 1ª carga?

  const reload = useCallback(async () => {
    setStatus("atualizando…");
    // corte de fonte depende do usuário logado (alguns sincronizam tudo via OF)
    const { data: u } = await sb.auth.getUser();
    const corte = corteParaEmail(u.user?.email);
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
    // corte de fonte por período (PDF até o corte, Open Banking a partir dele)
    setAllDados(todos.filter((d) => lancVisivel(d, corte)));
    setStatus("");
    setCarregou(true);
  }, []);

  useEffect(() => { if (ativo) reload(); }, [ativo, reload]);

  // loading = primeira carga ainda não concluída (para mostrar skeleton)
  return { allDados, status, reload, loading: ativo && !carregou };
}
