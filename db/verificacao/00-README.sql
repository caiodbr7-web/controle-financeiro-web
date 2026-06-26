-- ============================================================================
-- db/verificacao/ — Auditoria de NÃO-DUPLA-CONTAGEM (frente W2)
-- ----------------------------------------------------------------------------
-- Conjunto de queries de CONFERÊNCIA (somente SELECT, idempotentes, sem efeito
-- colateral) para rodar no SQL Editor do Supabase. Servem para auditar que a
-- centralização em `lancamentos` não conta nada em dobro, que o netting de
-- pernas (interna / par_hash) fecha, e para comparar totais antes/depois de
-- aplicar a função do W1.
--
-- COMO USAR
--   Supabase -> SQL Editor -> New query -> cole UM arquivo por vez -> Run.
--   Nada aqui escreve no banco. Pode rodar quantas vezes quiser.
--
-- CONTEXTO (ver docs/fonte-unica-lancamentos.md e docs/reconciliacao.md)
--   * Fonte do dado:  fonte_dados = 'pluggy'  -> Open Finance (Pluggy)
--                     fonte_dados IS NULL / <> 'pluggy'  -> PDF (extrato curado)
--   * hash_natural:   'pluggy:<txId>'  (Pluggy)   /   'imp_...'  (import de arquivo)
--   * Corte do hook (src/hooks/useLancamentos.ts):
--       competência <  '2026-06'           -> PDF
--       '2026-06' <= competência <= mês atual -> Pluggy
--       competência >  mês atual            -> oculto
--     OBS: o corte é por `competencia` (string 'YYYY-MM ...'), que NÃO é o mesmo
--     eixo do "mês real" (data da compra). Para cartão, a competência do PDF é o
--     mês da FATURA e a do Pluggy é o mês da TRANSAÇÃO (dt_br) -> é exatamente na
--     fronteira do corte que mora o risco de dupla contagem (ver 02-...).
--
-- ORDEM SUGERIDA
--   01  duplicatas de hash_natural (colisão dura)
--   02  mesma transação nas DUAS fontes no mesmo mês real (dupla contagem)
--   03  netting: interna sem par_hash, e pares que não somam ~zero
--   04  totais mensais por fonte (placar antes/depois — espelha totaisPorMes)
--   05  sanidade do corte por competência (o que cada fonte expõe no hook)
--
-- PARÂMETRO GLOBAL: o "corte" aparece como literal '2026-06' em cada arquivo.
-- Se mudar CORTE_OPEN_BANKING no hook, ajuste o literal nas queries 02 e 05.
-- ============================================================================

-- Visão geral rápida: quantas linhas por fonte e faixa de competência.
select
  case when fonte_dados = 'pluggy' then 'pluggy' else 'pdf' end as fonte,
  count(*)                                  as linhas,
  min(left(competencia, 7))                 as comp_min,
  max(left(competencia, 7))                 as comp_max,
  count(*) filter (where interna)           as internas,
  count(*) filter (where par_hash is not null) as com_par
from public.lancamentos
where user_id = auth.uid()
group by 1
order by 1;
