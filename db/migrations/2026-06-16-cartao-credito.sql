-- ============================================================
--  Planejamento: marcar itens pagos no cartão de crédito.
--
--  Adiciona a coluna `no_cartao` em `planos`. Itens marcados entram
--  no subtotal "💳 No cartão de crédito" da aba Planejamento — que é
--  só um detalhamento dos gastos já contados, então NÃO soma em dobro.
--
--  COMO RODAR:
--    Supabase  ->  SQL Editor  ->  New query  ->  cole TUDO  ->  Run
--
--  É segura: idempotente (pode rodar de novo).
-- ============================================================

alter table public.planos
  add column if not exists no_cartao boolean not null default false;

-- ============================================================
--  Pronto. Na aba "Planejamento", cada gasto ganha um botão 💳
--  para marcar que cai no cartão; uma linha extra soma o total no
--  cartão por mês (sem contar duas vezes).
-- ============================================================
