-- ============================================================
--  GARANTIR ISOLAMENTO POR USUÁRIO EM TODAS AS TABELAS (RLS)
--
--  Reforça, de uma vez, em cada tabela do produto:
--    - coluna user_id (com default auth.uid())
--    - Row Level Security LIGADA
--    - política "proprios dados": cada um só lê/escreve as próprias linhas
--
--  É idempotente e seguro: pode rodar quantas vezes quiser.
--  Depois de rodar, NENHUM usuário consegue ver dados de outro.
--
--  COMO RODAR: Supabase -> SQL Editor -> New query -> cole TUDO -> Run
-- ============================================================

do $$
declare t text;
begin
  foreach t in array array[
    'lancamentos',
    'orcamento_itens',
    'orcamento_mensal',
    'regras',
    'planos',
    'plano_mensal'
  ] loop
    if to_regclass('public.' || t) is not null then
      -- coluna de dono (não falha se já existir)
      execute format(
        'alter table public.%I add column if not exists user_id uuid references auth.users(id) default auth.uid()', t);
      -- RLS ligada
      execute format('alter table public.%I enable row level security', t);
      -- política única e canônica de isolamento
      execute format('drop policy if exists "proprios dados" on public.%I', t);
      execute format(
        'create policy "proprios dados" on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------
--  DIAGNÓSTICO (rode em queries separadas para investigar)
-- ------------------------------------------------------------
-- 1) Usuários cadastrados:
--    select id, email from auth.users order by email;
--
-- 2) RLS está ligada em todas as tabelas? (rls_ativo deve ser true)
--    select tablename, rowsecurity as rls_ativo
--    from pg_tables where schemaname = 'public' order by tablename;
--
-- 3) Políticas existentes:
--    select tablename, policyname, cmd, qual
--    from pg_policies where schemaname = 'public' order by tablename;
--
-- 4) Distribuição de dono por tabela (revela dados misturados / sem dono):
--    select 'lancamentos' tbl, user_id, count(*) from public.lancamentos group by user_id
--    union all select 'planos',       user_id, count(*) from public.planos       group by user_id
--    union all select 'plano_mensal', user_id, count(*) from public.plano_mensal group by user_id
--    union all select 'regras',       user_id, count(*) from public.regras       group by user_id
--    order by tbl, count desc;
-- ============================================================
