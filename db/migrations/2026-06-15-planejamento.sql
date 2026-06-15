-- ============================================================
--  Planejamento: projeção de gastos futuros
--  (gastos fixos, parcelamentos, pagamentos futuros, metas/caixinhas
--   e receitas previstas) — isolado por usuário com Row Level Security.
--
--  COMO RODAR:
--    Supabase  ->  SQL Editor  ->  New query  ->  cole TUDO  ->  Run
--
--  É seguro rodar mais de uma vez (idempotente).
-- ============================================================

create table if not exists public.planos (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) default auth.uid(),
  tipo        text not null check (tipo in ('fixo','parcelamento','pagamento','meta','receita')),
  nome        text not null,
  categoria   text,
  valor       numeric not null default 0,
  mes_inicio  text not null,            -- 'AAAA-MM'
  mes_fim     text,                     -- 'AAAA-MM' (opcional)
  parcelas    integer,                  -- só parcelamento: nº de parcelas
  ativo       boolean not null default true,
  ordem       integer not null default 0,
  criado_em   timestamptz not null default now()
);

create index if not exists planos_user_idx on public.planos (user_id);

alter table public.planos enable row level security;

drop policy if exists "proprios dados" on public.planos;
create policy "proprios dados" on public.planos
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ============================================================
--  Pronto. A aba "Planejamento" no app já passa a funcionar:
--  cada usuário vê/edita só os próprios itens de planejamento.
-- ============================================================
