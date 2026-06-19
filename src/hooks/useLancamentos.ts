import { useState, useCallback, useEffect } from "react";
import { sb } from "../lib/supabase";
import type { Lancamento } from "../types";

// ---------------------------------------------------------------------------
// Fonte por período — evita DUPLA CONTAGEM entre PDF e Open Banking.
// As duas fontes cobrem meses sobrepostos (cada transação aparece nas duas);
// por isso cada mês deve vir de UMA fonte só. Regra (corte EXCLUSIVO por
// competência "YYYY-MM"):
//     competência <  CORTE  ->  PDF (histórico curado por fatura/extrato)
//     competência >= CORTE  ->  Open Banking (Pluggy)
// Para voltar a só-PDF, use um corte no futuro distante (ex.: "9999-99");
// para tudo via Open Banking, use "0000-00".
// As abas Conciliação e Open Banking NÃO usam este hook (têm query própria),
// então continuam vendo as duas fontes para validação/cruzamento.
// ---------------------------------------------------------------------------
const CORTE_OPEN_BANKING = "2026-06"; // Open Banking assume deste mês em diante

const compKey = (d: Lancamento) => String(d.competencia || "").slice(0, 7);
/** Um lançamento é visível nos dashboards se está do lado certo do corte. */
export function lancVisivel(d: Lancamento): boolean {
  return d.fonte_dados === "pluggy"
    ? compKey(d) >= CORTE_OPEN_BANKING // Open Banking: do corte em diante
    : compKey(d) < CORTE_OPEN_BANKING; // PDF (fonte nula/pdf): antes do corte
}

/** Carrega todos os lançamentos (paginado) e aplica o corte de fonte por período. */
export function useLancamentos(ativo: boolean) {
  const [allDados, setAllDados] = useState<Lancamento[]>([]);
  const [status, setStatus] = useState("");
  const [carregou, setCarregou] = useState(false); // já completou a 1ª carga?

  const reload = useCallback(async () => {
    setStatus("atualizando…");
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
    setAllDados(todos.filter(lancVisivel));
    setStatus("");
    setCarregou(true);
  }, []);

  useEffect(() => { if (ativo) reload(); }, [ativo, reload]);

  // loading = primeira carga ainda não concluída (para mostrar skeleton)
  return { allDados, status, reload, loading: ativo && !carregou };
}
