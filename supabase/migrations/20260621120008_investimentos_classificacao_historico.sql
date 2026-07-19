-- ============================================================
--  Investimentos: classificação manual + histórico de patrimônio
--
--  1) Adiciona `tipo_manual` em pluggy_investments — uma classificação SUA do
--     ativo (sobrepõe o `tipo` que vem da Pluggy só para a sua visualização).
--     A sincronização NÃO sobrescreve esta coluna (o upsert da função só toca
--     as colunas que ela envia).
--
--  2) Cria pluggy_investments_hist: um retrato DIÁRIO do patrimônio investido
--     (total, aplicado, lucro, nº de posições), gravado a cada sincronização.
--     Permite o gráfico de evolução histórica. A série passa a crescer a partir
--     de agora (cada dia sincronizado vira um ponto).
--
--  COMO RODAR:
--    Supabase  ->  SQL Editor  ->  New query  ->  cole TUDO  ->  Run
--  É idempotente e não apaga dados.
-- ============================================================

-- 1) classificação manual do ativo ------------------------------------------
alter table public.pluggy_investments
  add column if not exists tipo_manual text;

-- 2) histórico diário do patrimônio ------------------------------------------
create table if not exists public.pluggy_investments_hist (
  user_id        uuid not null references auth.users(id) default auth.uid(),
  dia            date not null,                 -- "YYYY-MM-DD" (snapshot do dia)
  valor_total    numeric,                       -- soma dos saldos (valor atual)
  valor_aplicado numeric,                       -- soma dos aportes
  lucro          numeric,                       -- soma do lucro
  posicoes       integer,                       -- nº de posições no dia
  atualizado_em  timestamptz default now(),
  primary key (user_id, dia)
);

create index if not exists pluggy_investments_hist_user_idx
  on public.pluggy_investments_hist (user_id, dia);

-- isolamento por usuário (mesmo padrão das outras tabelas)
alter table public.pluggy_investments_hist enable row level security;

drop policy if exists "proprios dados" on public.pluggy_investments_hist;
create policy "proprios dados" on public.pluggy_investments_hist
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
