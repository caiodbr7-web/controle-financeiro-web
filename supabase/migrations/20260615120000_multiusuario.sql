-- ============================================================
--  Multiusuário: cada pessoa enxerga/edita só os próprios dados
--  (isolamento por user_id + Row Level Security)
--
--  COMO RODAR:
--    Supabase  ->  SQL Editor  ->  New query  ->  cole TUDO  ->  Run
--
--  É seguro rodar mais de uma vez (idempotente).
--  Antes de rodar, confirme que o e-mail do DONO abaixo está certo.
-- ============================================================

-- E-mail do dono atual dos dados (você). Todos os registros que já
-- existem hoje serão atribuídos a este usuário.
--   -> se quiser conferir os usuários: select id, email from auth.users;

-- ------------------------------------------------------------
-- Função auxiliar: pega o id do dono pelo e-mail
-- ------------------------------------------------------------
-- (usada nos UPDATEs de backfill abaixo)

-- ============================================================
-- 1) lancamentos
-- ============================================================
alter table public.lancamentos
  add column if not exists user_id uuid references auth.users(id) default auth.uid();

update public.lancamentos
  set user_id = (select id from auth.users where email = 'caio.dbr7@gmail.com')
  where user_id is null;

alter table public.lancamentos alter column user_id set not null;
alter table public.lancamentos enable row level security;

drop policy if exists "proprios dados" on public.lancamentos;
create policy "proprios dados" on public.lancamentos
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ============================================================
-- 2) orcamento_itens
-- ============================================================
alter table public.orcamento_itens
  add column if not exists user_id uuid references auth.users(id) default auth.uid();

update public.orcamento_itens
  set user_id = (select id from auth.users where email = 'caio.dbr7@gmail.com')
  where user_id is null;

alter table public.orcamento_itens alter column user_id set not null;
alter table public.orcamento_itens enable row level security;

drop policy if exists "proprios dados" on public.orcamento_itens;
create policy "proprios dados" on public.orcamento_itens
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ============================================================
-- 3) orcamento_mensal
-- ============================================================
alter table public.orcamento_mensal
  add column if not exists user_id uuid references auth.users(id) default auth.uid();

update public.orcamento_mensal
  set user_id = (select id from auth.users where email = 'caio.dbr7@gmail.com')
  where user_id is null;

alter table public.orcamento_mensal alter column user_id set not null;
alter table public.orcamento_mensal enable row level security;

drop policy if exists "proprios dados" on public.orcamento_mensal;
create policy "proprios dados" on public.orcamento_mensal
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ============================================================
-- 4) regras
--    A unicidade precisa passar de (padrao) para (user_id, padrao),
--    senão você e a Sofia não poderiam ter uma regra com o mesmo nome.
-- ============================================================
alter table public.regras
  add column if not exists user_id uuid references auth.users(id) default auth.uid();

update public.regras
  set user_id = (select id from auth.users where email = 'caio.dbr7@gmail.com')
  where user_id is null;

alter table public.regras alter column user_id set not null;

-- remove qualquer PK/unique antiga da tabela regras (ex.: unique em "padrao")
do $$
declare r record;
begin
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.regras'::regclass
      and contype in ('p', 'u')
  loop
    execute format('alter table public.regras drop constraint %I', r.conname);
  end loop;
end $$;

-- nova unicidade: (user_id, padrao)  -> casa com o upsert onConflict do app
create unique index if not exists regras_user_padrao_uidx
  on public.regras (user_id, padrao);

alter table public.regras enable row level security;

drop policy if exists "proprios dados" on public.regras;
create policy "proprios dados" on public.regras
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ============================================================
--  Pronto. A partir daqui:
--   - você continua vendo só os seus dados;
--   - a Sofia, ao logar com a conta dela, começa com a base vazia
--     e tudo que ela cadastrar fica isolado na conta dela.
-- ============================================================
