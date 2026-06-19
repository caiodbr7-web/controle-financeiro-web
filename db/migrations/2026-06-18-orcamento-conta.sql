-- Orçamento da "conta variável" (gastos fora dos recorrentes e fora do cartão).
--
-- Espelha `eh_cartao_total`: uma linha especial em `planos` passa a guardar o
-- orçamento mensal previsto da conta variável no campo `valor`. A flag abaixo
-- identifica essa linha para que ela não apareça como um item comum.
--
-- Rode uma vez só em Supabase → SQL Editor → New query → Run.

alter table public.planos
  add column if not exists eh_conta_total boolean not null default false;
