-- ============================================================
--  Integração IBKR (Interactive Brokers) via Flex Web Service
--
--  Importa as POSIÇÕES da sua conta IBKR (somente leitura, via "Flex Query")
--  para a mesma tabela public.pluggy_investments, junto da carteira do Open
--  Finance. Assim a IBKR entra nos KPIs, na composição e no histórico.
--
--  Este SQL faz 3 coisas:
--    1) adiciona a coluna `fonte` em pluggy_investments (pluggy/manual/ibkr);
--    2) cria public.ibkr_flex (token + query id por usuário, com RLS);
--    3) agenda a importação automática no MESMO horário do sync da Pluggy.
--
--  COMO RODAR:
--    Supabase -> SQL Editor -> New query -> cole TUDO -> Run.
--  É idempotente e não apaga dados.
-- ============================================================

-- 1) Marca a ORIGEM de cada posição -----------------------------------------
--    'pluggy' (Open Finance), 'manual' (você digitou), 'ibkr' (Flex Web Service).
--    O upsert da Pluggy NÃO inclui `fonte`, então a origem é preservada.
alter table public.pluggy_investments
  add column if not exists fonte text not null default 'pluggy';

-- backfill: posições manuais já existentes passam a 'manual'
update public.pluggy_investments set fonte = 'manual' where manual = true and fonte = 'pluggy';

create index if not exists pluggy_investments_fonte_idx on public.pluggy_investments (user_id, fonte);

comment on column public.pluggy_investments.fonte is
  'Origem da posição: pluggy (Open Finance), manual (digitada) ou ibkr (Flex Web Service).';

-- 2) Credenciais da IBKR por usuário (Flex Web Service) ----------------------
--    Uma conexão por usuário. O token é sensível: fica protegido por RLS (só o
--    dono lê/escreve) e nunca aparece no front fora deste fluxo.
create table if not exists public.ibkr_flex (
  user_id        uuid primary key references auth.users(id) default auth.uid(),
  flex_token     text not null,             -- token do Flex Web Service
  flex_query_id  text not null,             -- id da Activity Flex Query (Open Positions)
  account_id     text,                      -- preenchido após a 1ª importação
  status         text,                      -- 'OK' / mensagem de erro da última importação
  last_result    jsonb,                     -- detalhes da última importação
  last_synced_at timestamptz,               -- quando importou pela última vez
  criado_em      timestamptz default now(),
  atualizado_em  timestamptz default now()
);

alter table public.ibkr_flex enable row level security;

drop policy if exists "proprios dados" on public.ibkr_flex;
create policy "proprios dados" on public.ibkr_flex
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 3) Importação AUTOMÁTICA no mesmo horário do sync da Pluggy ----------------
--    PRÉ-REQUISITO: o cron da Pluggy (db/migrations/2026-06-21-cron-sync.sql)
--    já deve estar configurado — reusamos os MESMOS segredos do Vault
--    (pluggy_cron_url e pluggy_cron_secret) e a função compartilha o
--    CRON_SECRET já existente. A URL da função `ibkr-flex` é derivada da URL
--    do `pluggy-cron` trocando o nome (mesmo projeto).
--
--    Rode o deploy antes:  supabase functions deploy ibkr-flex --no-verify-jwt
--    Mesma frequência: 09:00 e 21:00 UTC (06:00 e 18:00 de Brasília).

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('ibkr-sync-automatico')
where exists (select 1 from cron.job where jobname = 'ibkr-sync-automatico');

select cron.schedule(
  'ibkr-sync-automatico',
  '0 9,21 * * *',
  $$
  select net.http_post(
    url     := replace(
                 (select decrypted_secret from vault.decrypted_secrets where name = 'pluggy_cron_url'),
                 'pluggy-cron', 'ibkr-flex'
               ),
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'pluggy_cron_secret')
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 600000
  );
  $$
);

-- ============================================================
--  Conferir (opcional):
--    select jobname, schedule, active from cron.job where jobname like '%-sync-automatico';
--    select user_id, status, last_synced_at from public.ibkr_flex;
--    select nome, ticker, moeda_cotacao, saldo from public.pluggy_investments where fonte = 'ibkr';
-- ============================================================
