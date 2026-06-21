-- ============================================================
--  Planejamento: Receita prevista (orçamento de receita).
--
--  Espelha `eh_cartao_total` / `eh_conta_total`: uma linha especial em
--  `planos` passa a guardar a RECEITA PREVISTA mensal no campo `valor`
--  (o valor-base que se repete todo mês). A flag abaixo identifica essa
--  linha para que ela não apareça como um item comum.
--
--  - `valor`  na linha especial   = receita prevista por mês (valor-base).
--  - `plano_mensal.valor_real`     = ajuste por mês (override), feito na
--                                    aba Projeção com duplo clique.
--
--  Assim o "previsto" da receita é UMA fonte de dados só: editar na visão
--  Mês (↑ prever) ou na Projeção (duplo clique) mexe no mesmo lugar, e os
--  dois lados ficam sempre conectados.
--
--  COMO RODAR:
--    Supabase  ->  SQL Editor  ->  New query  ->  cole TUDO  ->  Run
--
--  É segura: idempotente (pode rodar de novo).
-- ============================================================

alter table public.planos
  add column if not exists eh_receita_total boolean not null default false;

-- Garante NO MÁXIMO uma linha de receita prevista por usuário (evita linha-fantasma
-- por corrida na criação). Índice único parcial por user_id.
create unique index if not exists planos_receita_total_uniq
  on public.planos(user_id) where eh_receita_total;

-- ============================================================
--  Pronto. Na aba "Planejamento", a linha 💰 Receita prevista vira
--  editável: defina o valor-base na visão Mês e ajuste mês a mês na
--  Projeção; o Saldo do mês passa a considerar a receita planejada.
-- ============================================================
