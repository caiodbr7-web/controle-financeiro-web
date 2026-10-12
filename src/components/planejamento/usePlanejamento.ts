import { useCallback, useEffect, useMemo, useState } from "react";
import { sb } from "../../lib/supabase";
import { dvAddMes } from "../../lib/finance";
import { type Plano, mesAtual } from "../../lib/projecao";
import type { Mensal, MensalMap } from "../../lib/agenda";

/** colunas novas da migração *_planejamento_lembretes.sql (planos) */
export const COLS_NOVAS = ["favorecido", "dia_venc", "forma_pagamento", "dados_pagamento", "lembrar_dias", "observacoes", "variavel"] as const;
export const MSG_MIGRACAO_LEMBRETES =
  "Para salvar vencimento, favorecido, forma de pagamento, lembrete e observações, aplique a migração supabase/migrations/*_planejamento_lembretes.sql (aplicada automaticamente no merge para main; ou rode o SQL no Supabase → SQL Editor).";

/** janela de meses carregada do plano_mensal: 13 meses para trás, 24 para frente */
export const JANELA = (() => {
  const a = dvAddMes(mesAtual(), -13);
  return Array.from({ length: 38 }, (_, i) => dvAddMes(a, i));
})();

const ehEspecial = (p: any) => !!(p.eh_cartao_total || p.eh_conta_total || p.eh_receita_total);

export function usePlanejamento() {
  const [todos, setTodos] = useState<Plano[]>([]);
  const [mensal, setMensal] = useState<MensalMap>({});
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");
  const [semTabela, setSemTabela] = useState(false);
  const [temNovas, setTemNovas] = useState(true); // colunas novas em planos existem?
  const [temNota, setTemNota] = useState(true);   // coluna nota em plano_mensal existe?

  const carregar = useCallback(async () => {
    setLoading(true); setErro("");
    const { data, error } = await sb.from("planos").select("*").order("ordem").order("id");
    if (error) {
      if (/does not exist|schema cache|relation|could not find/i.test(error.message)) setSemTabela(true);
      else setErro(error.message);
      setLoading(false);
      return;
    }
    const rows = (data || []) as Plano[];
    setTodos(rows);
    if (rows.length) setTemNovas("dia_venc" in (rows[0] as object));
    else setTemNovas(!(await sb.from("planos").select("dia_venc").limit(1)).error);

    const m = await sb.from("plano_mensal").select("*").in("competencia", JANELA);
    if (!m.error) {
      const by: MensalMap = {};
      (m.data || []).forEach((r: any) => {
        (by[r.competencia] ||= {})[r.plano_id] = { valor_real: r.valor_real, pago: !!r.pago, nota: r.nota ?? null };
      });
      setMensal(by);
      if (m.data?.length) setTemNota("nota" in (m.data[0] as object));
      else setTemNota(!(await sb.from("plano_mensal").select("nota").limit(1)).error);
    }
    setLoading(false);
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  // itens comuns × linhas especiais (orçamento do cartão/conta e receita prevista da visão clássica)
  const planos = useMemo(() => todos.filter((p) => !ehEspecial(p)), [todos]);
  const receitaPlano = useMemo(() => todos.find((p: any) => p.eh_receita_total) || null, [todos]);

  /** grava o registro do mês (upsert por plano+competência) com atualização otimista */
  const salvarMensal = useCallback(async (planoId: number, k: string, patch: Partial<Mensal>) => {
    const atual = mensal[k]?.[planoId] || { valor_real: null, pago: false, nota: null };
    const novo: Mensal = { ...atual, ...patch };
    setMensal((v) => ({ ...v, [k]: { ...(v[k] || {}), [planoId]: novo } }));
    const row: Record<string, unknown> = { plano_id: planoId, competencia: k, valor_real: novo.valor_real, pago: novo.pago };
    if (temNota) row.nota = novo.nota || null;
    const { error } = await sb.from("plano_mensal").upsert(row, { onConflict: "plano_id,competencia" });
    if (error) {
      setMensal((v) => ({ ...v, [k]: { ...(v[k] || {}), [planoId]: atual } }));
      throw error;
    }
  }, [mensal, temNota]);

  /** cria ou atualiza um item; sem a migração, salva só os campos antigos */
  const salvarPlano = useCallback(async (payload: Record<string, unknown>, id?: number) => {
    const body = { ...payload };
    if (!temNovas) COLS_NOVAS.forEach((c) => delete body[c]);
    const { error } = id
      ? await sb.from("planos").update(body).eq("id", id)
      : await sb.from("planos").insert(body);
    if (error) throw error;
    await carregar();
  }, [temNovas, carregar]);

  const removerPlano = useCallback(async (id: number) => {
    const { error } = await sb.from("planos").delete().eq("id", id);
    if (error) throw error;
    setTodos((arr) => arr.filter((p) => p.id !== id));
  }, []);

  const alternarAtivo = useCallback(async (p: Plano) => {
    const { error } = await sb.from("planos").update({ ativo: !p.ativo }).eq("id", p.id);
    if (error) throw error;
    setTodos((arr) => arr.map((x) => (x.id === p.id ? { ...x, ativo: !x.ativo } : x)));
  }, []);

  return {
    planos, receitaPlano, mensal, loading, erro, semTabela, temNovas, temNota,
    carregar, salvarMensal, salvarPlano, removerPlano, alternarAtivo,
  };
}

export type PlanejamentoApi = ReturnType<typeof usePlanejamento>;
