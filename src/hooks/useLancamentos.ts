import { useState, useCallback, useEffect } from "react";
import { sb } from "../lib/supabase";
import type { Lancamento } from "../types";

// Por enquanto os dashboards mostram SÓ o que veio de arquivo (PDF).
// Os lançamentos importados via Open Banking (fonte_dados = 'pluggy') ficam
// no banco mas NÃO entram em nenhuma análise. Para passar a exibi-los no
// futuro, basta mudar esta flag para true.
const MOSTRAR_OPEN_BANKING = false;

/** Carrega todos os lançamentos (paginado; o Supabase limita ~1.000/linha). */
export function useLancamentos(ativo: boolean) {
  const [allDados, setAllDados] = useState<Lancamento[]>([]);
  const [status, setStatus] = useState("");

  const reload = useCallback(async () => {
    setStatus("carregando lançamentos...");
    const PAGINA = 1000;
    let todos: Lancamento[] = [], de = 0;
    while (true) {
      let q = sb.from("lancamentos").select("*");
      // exclui Open Banking do display (mantém linhas com fonte nula/pdf)
      if (!MOSTRAR_OPEN_BANKING) q = q.or("fonte_dados.is.null,fonte_dados.neq.pluggy");
      const { data, error } = await q
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

  useEffect(() => { if (ativo) reload(); }, [ativo, reload]);

  return { allDados, status, reload };
}
