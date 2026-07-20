-- ============================================================
--  Blindagem de segurança (revisão 2026-07)
--
--  1) RLS nas tabelas RAW do Pluggy — criadas à mão no painel, elas nunca
--     passaram por nenhuma migração de RLS: sem isso, QUALQUER usuário
--     autenticado leria/alteraria as transações brutas de todos.
--  2) Todas as policies passam a valer só para o papel `authenticated`
--     (antes valiam para public/anon e dependiam de auth.uid() ser NULL).
--  3) `anon` perde qualquer grant nas tabelas de dados (defesa em camada:
--     o app nunca consulta dados sem login).
--  4) Funções ganham `search_path` fixo (linter function_search_path_mutable).
--
--  Idempotente e tolerante: tabelas ausentes são puladas (base nova).
-- ============================================================

do $$
declare
  t text;
  dono uuid;
  pendentes bigint;
  tabelas text[] := array[
    -- já tinham RLS: reforço com TO authenticated + revoke anon
    'lancamentos', 'orcamento_itens', 'orcamento_mensal', 'regras',
    'planos', 'plano_mensal',
    'pluggy_investments', 'pluggy_investments_hist', 'pluggy_investments_hist_tipo',
    'ibkr_flex', 'categorias', 'subcategorias',
    -- NUNCA tiveram RLS em migração (criadas no painel) — correção principal
    'pluggy_items', 'pluggy_contas_raw', 'pluggy_transacoes_raw', 'pluggy_saldos'
  ];
begin
  -- dono da base original (mesmo padrão do backfill de 20260615120000)
  select id into dono from auth.users where email = 'caio.dbr7@gmail.com';

  foreach t in array tabelas loop
    if to_regclass('public.' || t) is null then
      continue; -- tabela não existe nesta base
    end if;

    -- garante a coluna user_id (no-op onde já existe)
    execute format(
      'alter table public.%I add column if not exists user_id uuid references auth.users(id) default auth.uid()', t);

    -- backfill de linhas antigas sem dono
    if dono is not null then
      execute format('update public.%I set user_id = $1 where user_id is null', t) using dono;
    end if;

    -- NOT NULL só quando não restar linha órfã (nunca falha a migração)
    execute format('select count(*) from public.%I where user_id is null', t) into pendentes;
    if pendentes = 0 then
      execute format('alter table public.%I alter column user_id set not null', t);
    else
      raise notice 'tabela %: % linhas sem user_id — NOT NULL adiado (RLS já as esconde)', t, pendentes;
    end if;

    -- RLS + policy por usuário, restrita ao papel authenticated
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "proprios dados" on public.%I', t);
    execute format(
      'create policy "proprios dados" on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);

    -- anon não tem por que tocar em dados (auth acontece antes de qualquer query)
    execute format('revoke all on table public.%I from anon', t);
  end loop;
end $$;

-- ------------------------------------------------------------
-- search_path fixo nas funções persistentes (evita sombreamento de objetos
-- caso algum papel consiga criar schemas; refs internas já são qualificadas)
-- ------------------------------------------------------------
do $$
begin
  if to_regprocedure('public._fonte_unica_norm_estab(text)') is not null then
    alter function public._fonte_unica_norm_estab(text) set search_path = public, pg_temp;
  end if;
  if to_regprocedure('public._fonte_unica_parcela(text)') is not null then
    alter function public._fonte_unica_parcela(text) set search_path = public, pg_temp;
  end if;
  if to_regprocedure('public.pluggy_traduzir_lancamentos(uuid)') is not null then
    alter function public.pluggy_traduzir_lancamentos(uuid) set search_path = public, pg_temp;
  end if;
end $$;

-- ------------------------------------------------------------
-- Verificação (rode à mão depois de aplicar):
--   select tablename, rowsecurity from pg_tables where schemaname = 'public' order by 1;
--   -> todas as tabelas de dados devem estar com rowsecurity = true
-- ------------------------------------------------------------
