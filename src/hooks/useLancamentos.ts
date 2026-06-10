import { useState, useCallback, useEffect } from "react";
import { sb } from "../lib/supabase";
import type { Lancamento } from "../types";

/** Carrega todos os lançamentos (paginado; o Supabase limita ~1.000/linha). */
export function useLancamentos(ativo: boolean) {
  const [allDados, setAllDados] = useState<Lancamento[]>([]);
  const [status, setStatus] = useState("");

  const reload = useCallback(async () => {
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

  useEffect(() => { if (ativo) reload(); }, [ativo, reload]);

  return { allDados, status, reload };
}
