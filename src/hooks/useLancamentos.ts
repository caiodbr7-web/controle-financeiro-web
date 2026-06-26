import { useState, useCallback, useEffect } from "react";
import { sb } from "../lib/supabase";
import { mesAtual } from "../lib/projecao";
import { dvDataReal } from "../lib/finance";
import type { Lancamento } from "../types";

// ---------------------------------------------------------------------------
// Fonte por período — evita DUPLA CONTAGEM entre PDF e Open Banking.
// As duas fontes cobrem meses sobrepostos (cada transação aparece nas duas);
// por isso cada mês deve vir de UMA fonte só. Regra (por competência "YYYY-MM"):
//     competência <  CORTE                    ->  PDF (histórico curado)
//     CORTE <= competência <= mês atual        ->  Open Banking (Pluggy)
//     competência >  mês atual                 ->  só conta se a COMPRA já aconteceu
//                                                  (data real <= mês atual): recupera
//                                                  compras passadas que o Pluggy já
//                                                  adiantou para uma fatura futura.
//                                                  Parcelas cujo gasto ainda não
//                                                  ocorreu (data real no futuro) ficam
//                                                  ocultas (ver Planejamento).
// Para voltar a só-PDF, use um corte no futuro distante (ex.: "9999-99");
// para tudo via Open Banking, use "0000-00".
// As abas Conciliação e Open Banking NÃO usam este hook (têm query própria),
// então continuam vendo as duas fontes (e os meses futuros) para validação.
// ---------------------------------------------------------------------------
const CORTE_OPEN_BANKING = "2026-06"; // Open Banking assume deste mês em diante

const compKey = (d: Lancamento) => String(d.competencia || "").slice(0, 7);
/** Um lançamento é visível nos dashboards se está do lado certo do corte. */
export function lancVisivel(d: Lancamento): boolean {
  const m = compKey(d);
  if (d.fonte_dados === "pluggy") {
    if (m < CORTE_OPEN_BANKING) return false;   // antes do corte: vem do PDF
    if (m <= mesAtual()) return true;           // até o mês atual: sempre visível
    // competência futura: conta só se a compra já aconteceu (data real <= mês atual).
    // Assim recuperamos compras passadas adiantadas para uma fatura futura, sem
    // contar parcelas futuras (data real ainda no futuro).
    const r = dvDataReal(d);
    return !!r && r.k <= mesAtual();
  }
  return m < CORTE_OPEN_BANKING; // PDF (fonte nula/pdf): antes do corte
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
