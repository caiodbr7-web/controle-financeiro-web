-- ============================================================
--  Separar de vez: Orçamento + Planejamento (e o resto) por login
--
--  Objetivo: você e a Sofia entram com e-mails diferentes e NÃO
--  enxergam nada um do outro — orçamento, planejamento, lançamentos,
--  regras: tudo apartado, sem nada em comum.
--
--  Por que rodar isto se já existe RLS? Porque "ver os dados um do
--  outro" quase sempre vem de uma destas duas causas no banco:
--    1) o Row Level Security ficou DESLIGADO em alguma tabela; ou
--    2) sobrou uma política PERMISSIVA (ex.: "Enable read access for
--       all users", criada sem querer no painel do Supabase) que deixa
--       todo mundo ler tudo, furando o isolamento.
--  Este script trata as duas: apaga QUALQUER política existente e
--  deixa só a regra estrita "cada um vê o seu", com o RLS ligado.
--
--  Dono dos dados que já existem: TODOS os registros sem dono passam a
--  ser SEUS (caio.dbr7@gmail.com). A Sofia começa com a base vazia e
--  tudo que ela cadastrar fica isolado na conta dela.
--
--  COMO RODAR:
--    Supabase -> SQL Editor -> New query -> cole TUDO -> Run
--
--  É seguro: idempotente (pode rodar quantas vezes quiser) e NÃO apaga
--  nenhuma tabela nem nenhum dado — só ajusta dono + RLS + políticas.
-- ============================================================

-- ------------------------------------------------------------
-- Parte 1 — Blindar cada tabela: dono obrigatório + RLS estrito
-- ------------------------------------------------------------
do $$
declare
  dono uuid := (select id from auth.users where email = 'caio.dbr7@gmail.com');
  t    text;
  pol  record;
  -- foco do pedido vem primeiro (orçamento + planejamento);
  -- as demais entram para garantir que NADA fique em comum.
  tabelas text[] := array[
    'planos',            -- itens de orçamento/planejamento (fonte única)
    'plano_mensal',      -- realizado/pago por mês
    'orcamento_itens',   -- orçamento antigo (backup)
    'orcamento_mensal',  -- orçamento antigo (backup)
    'lancamentos',       -- transações
    'regras'             -- regras de classificação
  ];
begin
  if dono is null then
    raise exception
      'Não encontrei o usuário caio.dbr7@gmail.com em auth.users. Confira o e-mail antes de rodar.';
  end if;

  foreach t in array tabelas loop
    -- pula tabela que não existe (ex.: backup já removido)
    if to_regclass('public.' || t) is null then
      raise notice 'tabela "%" não existe — pulando', t;
      continue;
    end if;

    -- 1) coluna user_id com default = usuário logado (idempotente)
    execute format(
      'alter table public.%I add column if not exists user_id uuid '
      'references auth.users(id) default auth.uid()', t);

    -- 2) registros antigos sem dono passam a ser SEUS (não toca nos que
    --    já têm dono — então itens da Sofia, se houver, ficam com ela)
    execute format(
      'update public.%I set user_id = %L where user_id is null', t, dono);

    -- 3) dono obrigatório daqui pra frente
    execute format(
      'alter table public.%I alter column user_id set not null', t);

    -- 4) liga o Row Level Security
    execute format(
      'alter table public.%I enable row level security', t);

    -- 5) remove QUALQUER política existente (inclusive as permissivas
    --    criadas pelo painel) para não sobrar brecha
    for pol in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy %I on public.%I', pol.policyname, t);
    end loop;

    -- 6) a ÚNICA política: cada um só enxerga/edita os próprios dados
    execute format(
      'create policy "proprios dados" on public.%I '
      'for all using (user_id = auth.uid()) '
      'with check (user_id = auth.uid())', t);

    raise notice 'isolado com sucesso: %', t;
  end loop;
end $$;

-- ------------------------------------------------------------
-- Parte 2 — Unicidade por usuário (não atrapalha o isolamento, mas
-- evita que uma regra sua e uma da Sofia colidam pelo mesmo nome)
-- ------------------------------------------------------------
do $$
begin
  if to_regclass('public.regras') is not null then
    -- remove PK/unique antigas que sejam só por "padrao"
    -- (mantém a unicidade correta: por usuário + padrão)
    if not exists (
      select 1 from pg_indexes
      where schemaname = 'public' and indexname = 'regras_user_padrao_uidx'
    ) then
      create unique index regras_user_padrao_uidx
        on public.regras (user_id, padrao);
    end if;
  end if;
end $$;

-- ============================================================
--  PRONTO. Daqui pra frente:
--   - você continua vendo só os SEUS dados;
--   - a Sofia, na conta dela, vê só os dela (começando do zero).
--
--  ----------------------------------------------------------
--  CONFERIR (opcional): rode os 3 SELECTs abaixo e verifique.
--  ----------------------------------------------------------

-- A) O RLS está ligado? Espera-se rowsecurity = true em todas.
-- select tablename, rowsecurity
-- from pg_tables
-- where schemaname = 'public'
--   and tablename in ('planos','plano_mensal','orcamento_itens',
--                     'orcamento_mensal','lancamentos','regras')
-- order by tablename;

-- B) Sobrou só a política certa? Espera-se apenas "proprios dados"
--    com qual = (user_id = auth.uid()).
-- select tablename, policyname, cmd, qual, with_check
-- from pg_policies
-- where schemaname = 'public'
--   and tablename in ('planos','plano_mensal','orcamento_itens',
--                     'orcamento_mensal','lancamentos','regras')
-- order by tablename, policyname;

-- C) De quem é cada linha? Espera-se tudo no SEU e-mail; Sofia zerada.
-- select 'planos'       as tabela, u.email, count(*) from public.planos       p join auth.users u on u.id = p.user_id group by u.email
-- union all
-- select 'plano_mensal',          u.email, count(*) from public.plano_mensal  x join auth.users u on u.id = x.user_id group by u.email
-- union all
-- select 'lancamentos',           u.email, count(*) from public.lancamentos   x join auth.users u on u.id = x.user_id group by u.email
-- order by 1, 2;
-- ============================================================
