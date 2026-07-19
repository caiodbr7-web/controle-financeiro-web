-- ============================================================================
-- 2026-06-26 — Fonte única de gasto/receita: colunas de classificação unificada
-- ----------------------------------------------------------------------------
-- Parte do trabalho de centralizar TODOS os dashboards na tabela `lancamentos`
-- (cada linha = um gasto/receita classificado, com a competência efetiva).
--
-- Esta migração SÓ ADICIONA COLUNAS (sem lógica) — é o "contrato de schema" que a
-- função de tradução (public.pluggy_traduzir_lancamentos, frente W1) e os
-- dashboards (frente W3) passam a preencher/consumir. Lógica e backfill vêm na
-- migração do W1. Ver docs/fonte-unica-lancamentos.md.
--
--   interna         -> movimento entre contas próprias (transferência interna,
--                      pagamento de fatura, aporte/resgate). Os dashboards de
--                      gasto/receita SEMPRE excluem  interna = true.
--   par_hash        -> liga as DUAS PERNAS casadas de uma transferência (mesma id
--                      nas duas linhas) p/ netting e verificação.
--   subtipo         -> rótulo legível do movimento (Pagamento de fatura, Entre
--                      contas proprias, Aporte, Resgate, Rendimentos, Salario...).
--                      Hoje vive em categoria_auto; a função do W1 passa a gravá-lo
--                      aqui e devolve categoria_auto à categoria real do Pluggy.
--   classe_manual   -> override do usuário p/ `classe`  (a re-tradução respeita).
--   interna_manual  -> override do usuário p/ `interna` (a re-tradução respeita).
--
-- COMO RODAR:
--   Supabase -> SQL Editor -> New query -> cole TUDO -> Run
-- Idempotente (pode rodar de novo) e NÃO apaga dados.
-- ============================================================================

alter table public.lancamentos
  add column if not exists interna        boolean not null default false,
  add column if not exists par_hash       text,
  add column if not exists subtipo        text,
  add column if not exists classe_manual  text,
  add column if not exists interna_manual boolean;

-- índices úteis para os dashboards (filtra por classe/interna) e para o
-- casamento de pernas (par_hash).
create index if not exists lancamentos_interna_idx
  on public.lancamentos (user_id, interna);
create index if not exists lancamentos_classe_idx
  on public.lancamentos (user_id, classe);
create index if not exists lancamentos_par_hash_idx
  on public.lancamentos (par_hash) where par_hash is not null;

-- ============================================================================
-- Conferir (opcional): as colunas devem aparecer e o default de interna ser false
--   select column_name, data_type, column_default, is_nullable
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'lancamentos'
--     and column_name in ('interna','par_hash','subtipo','classe_manual','interna_manual')
--   order by column_name;
-- ============================================================================
