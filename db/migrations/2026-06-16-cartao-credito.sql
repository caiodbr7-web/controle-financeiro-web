-- ============================================================
--  Planejamento: cartão de crédito (itens marcados + total digitado).
--
--  1) `no_cartao`        marca um item como "cai no cartão de crédito".
--  2) `eh_cartao_total`  identifica a linha especial que guarda o TOTAL
--                        do cartão por mês (o orçamento que você digita).
--                        O `valor` dessa linha é o orçamento mensal e o
--                        realizado de cada mês vai em `plano_mensal`.
--
--  Na aba Planejamento os gastos viram três linhas de resumo: 🏦 conta,
--  💳 cartão e Σ gerais — os itens marcados já estão dentro do total do
--  cartão, então NÃO somam em dobro.
--
--  COMO RODAR:
--    Supabase  ->  SQL Editor  ->  New query  ->  cole TUDO  ->  Run
--
--  É segura: idempotente (pode rodar de novo).
-- ============================================================

alter table public.planos
  add column if not exists no_cartao boolean not null default false;

alter table public.planos
  add column if not exists eh_cartao_total boolean not null default false;

-- ============================================================
--  Pronto. Na aba "Planejamento", cada gasto ganha um botão 💳 para
--  marcar que cai no cartão; um total do cartão pode ser digitado mês a
--  mês; e o rodapé mostra conta, cartão e gerais (sem contar duas vezes).
-- ============================================================
