-- ============================================================
--  Investimentos: histórico diário do patrimônio POR CATEGORIA
--
--  Cria public.pluggy_investments_hist_tipo: um retrato DIÁRIO do patrimônio
--  investido quebrado por tipo EFETIVO (a sua classificação `tipo_manual`
--  vence a `tipo` da Pluggy; sem nenhuma, cai em 'OUTROS'). Uma linha por
--  (user_id, dia, tipo), gravada a cada sincronização.
--
--  Por quê: a tabela pluggy_investments_hist guarda só o TOTAL por dia. Para o
--  gráfico de "evolução por categoria" (área stackada dia-a-dia) precisamos do
--  valor de cada categoria em cada dia. A série passa a crescer a partir de
--  agora — cada dia sincronizado vira um ponto por categoria. Antes de haver
--  dois dias aqui, o front estima a quebra pela composição atual.
--
--  COMO RODAR:
--    Supabase  ->  SQL Editor  ->  New query  ->  cole TUDO  ->  Run
--  É idempotente e não apaga dados.
-- ============================================================

create table if not exists public.pluggy_investments_hist_tipo (
  user_id        uuid not null references auth.users(id) default auth.uid(),
  dia            date not null,                 -- "YYYY-MM-DD" (snapshot do dia)
  tipo           text not null,                 -- tipo efetivo (tipo_manual ?? tipo ?? 'OUTROS')
  valor_total    numeric,                       -- soma dos saldos da categoria no dia
  valor_aplicado numeric,                       -- soma dos aportes da categoria no dia
  posicoes       integer,                       -- nº de posições da categoria no dia
  atualizado_em  timestamptz default now(),
  primary key (user_id, dia, tipo)
);

create index if not exists pluggy_investments_hist_tipo_user_idx
  on public.pluggy_investments_hist_tipo (user_id, dia);

-- isolamento por usuário (mesmo padrão das outras tabelas)
alter table public.pluggy_investments_hist_tipo enable row level security;

drop policy if exists "proprios dados" on public.pluggy_investments_hist_tipo;
create policy "proprios dados" on public.pluggy_investments_hist_tipo
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ============================================================
--  Conferir (opcional): rode depois de uma sincronização
--    select dia, tipo, valor_total
--    from public.pluggy_investments_hist_tipo
--    order by dia desc, valor_total desc;
-- ============================================================
