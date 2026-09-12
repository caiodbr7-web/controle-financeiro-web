-- ============================================================
--  Conserta o agendamento da sincronização automática (pluggy-cron)
--
--  O QUE DEU ERRADO
--  A migration 20260621120009_cron_sync.sql nasceu como um script para rodar
--  À MÃO no SQL Editor: ela traz DOIS PLACEHOLDERS que o autor deveria editar
--  antes de executar —
--      'https://SEU-PROJETO.supabase.co/functions/v1/pluggy-cron'
--      'COLOQUE-O-MESMO-CRON_SECRET'
--  Quando a automação de migrações entrou (#75), esse arquivo passou a ser
--  aplicado SOZINHO pelo workflow, com os placeholders intactos. Resultado: os
--  segredos do Vault foram sobrescritos pelos textos de exemplo e o pg_cron
--  passou a disparar, duas vezes por dia, um POST para um domínio que não
--  existe. O job continua "ativo" e no horário certo — ele só nunca chega na
--  Edge Function. Por isso a sincronização parou sem nenhum erro visível.
--
--  O QUE ESTA MIGRATION FAZ
--    1) grava a URL REAL da função (o ref do projeto é público — já aparece no
--       netlify.toml e nos workflows);
--    2) NÃO encosta no segredo se ele já existir — só cria um marcador quando
--       está faltando. Era exatamente o "update cego" que destruiu o valor bom;
--    3) reagenda o job com o mesmo horário de sempre: 09:00 e 21:00 UTC, ou
--       06:00 e 18:00 de Brasília.
--
--  FALTA UM PASSO MANUAL (uma vez só)
--  O CRON_SECRET é um segredo: não pode morar no repositório. Se o valor no
--  Vault ainda for o placeholder, rode no SQL Editor, trocando pelo mesmo valor
--  que está em Project Settings -> Edge Functions -> Secrets -> CRON_SECRET:
--
--      select vault.update_secret(
--        (select id from vault.secrets where name = 'pluggy_cron_secret'),
--        'o-valor-real-do-CRON_SECRET'
--      );
--
--  Idempotente de verdade: rodar de novo não destrói nada.
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 1) URL real da função -----------------------------------------------------
do $$
declare
  v_url text := 'https://qjotxjunuurfezqgtugr.supabase.co/functions/v1/pluggy-cron';
begin
  if exists (select 1 from vault.secrets where name = 'pluggy_cron_url') then
    perform vault.update_secret(
      (select id from vault.secrets where name = 'pluggy_cron_url'), v_url);
  else
    perform vault.create_secret(v_url, 'pluggy_cron_url');
  end if;
end $$;

-- 2) Segredo do cron: cria se faltar, JAMAIS sobrescreve -------------------
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'pluggy_cron_secret') then
    perform vault.create_secret('DEFINIR-NO-SQL-EDITOR', 'pluggy_cron_secret');
  end if;
end $$;

-- 3) Reagendamento ----------------------------------------------------------
--    '0 9,21 * * *' = 06:00 e 18:00 de Brasília (o banco roda em UTC).
select cron.unschedule('pluggy-sync-automatico')
where exists (select 1 from cron.job where jobname = 'pluggy-sync-automatico');

select cron.schedule(
  'pluggy-sync-automatico',
  '0 9,21 * * *',
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'pluggy_cron_url'),
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
--  DIAGNÓSTICO (cole no SQL Editor quando quiser conferir)
--
--  -- o job existe e está ativo?
--  select jobid, jobname, schedule, active from cron.job
--   where jobname = 'pluggy-sync-automatico';
--
--  -- a URL está certa e o segredo já foi definido?
--  select name,
--         case when name = 'pluggy_cron_secret'
--              then case when decrypted_secret in ('DEFINIR-NO-SQL-EDITOR',
--                                                  'COLOQUE-O-MESMO-CRON_SECRET')
--                        then '*** AINDA E PLACEHOLDER — precisa definir ***'
--                        else 'ok (definido)' end
--              else decrypted_secret end as valor
--    from vault.decrypted_secrets
--   where name in ('pluggy_cron_url', 'pluggy_cron_secret');
--
--  -- as últimas execuções deram certo?
--  select status, return_message, start_time
--    from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'pluggy-sync-automatico')
--   order by start_time desc limit 10;
--
--  -- a resposta HTTP da Edge Function (200 = ok, 401 = segredo errado)
--  select status_code, content, created
--    from net._http_response order by created desc limit 10;
-- ============================================================
