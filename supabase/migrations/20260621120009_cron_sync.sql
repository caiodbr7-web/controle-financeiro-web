-- ============================================================
--  Sincronização AUTOMÁTICA das conexões Pluggy (cron job)
--
--  Faz o Supabase chamar sozinho a Edge Function `pluggy-cron` em horários
--  fixos, que por sua vez atualiza, para todos os usuários:
--    • transações + saldos  (via pluggy-sync)
--    • investimentos        (via pluggy-investments)
--
--  Assim você NÃO precisa mais clicar em "Sincronizar": a base se mantém
--  atualizada sozinha.
--
--  PRÉ-REQUISITOS (uma vez):
--    1) Faça o deploy da função (terminal):
--         supabase functions deploy pluggy-cron --no-verify-jwt
--    2) Configure os secrets da função (Project Settings -> Edge Functions):
--         CRON_SECRET          uma string forte qualquer (você escolhe)
--         SUPABASE_JWT_SECRET  o "JWT Secret" do projeto (Project Settings -> API)
--       (PLUGGY_CLIENT_ID / PLUGGY_CLIENT_SECRET já devem existir)
--
--  COMO RODAR ESTE SQL:
--    Supabase -> SQL Editor -> New query -> cole TUDO -> Run.
--    Antes, ajuste os dois INSERTs do Vault abaixo (URL do projeto e CRON_SECRET).
--
--  É seguro rodar mais de uma vez (idempotente): reagenda o mesmo job.
-- ============================================================

-- 1) Extensões necessárias --------------------------------------------------
create extension if not exists pg_cron;   -- agendador
create extension if not exists pg_net;    -- requisições HTTP a partir do banco

-- 2) Segredos no Vault (não ficam em texto puro no agendamento) --------------
--    >>> EDITE os dois valores abaixo antes de rodar <<<
--    - troque SEU-PROJETO pelo ref do seu projeto Supabase
--    - troque COLOQUE-O-MESMO-CRON_SECRET pelo MESMO valor do secret CRON_SECRET
--    Reexecutar este bloco atualiza o valor (não duplica).
do $$
begin
  -- URL da função
  if exists (select 1 from vault.secrets where name = 'pluggy_cron_url') then
    perform vault.update_secret(
      (select id from vault.secrets where name = 'pluggy_cron_url'),
      'https://SEU-PROJETO.supabase.co/functions/v1/pluggy-cron'
    );
  else
    perform vault.create_secret(
      'https://SEU-PROJETO.supabase.co/functions/v1/pluggy-cron',
      'pluggy_cron_url'
    );
  end if;

  -- segredo do cron (= CRON_SECRET configurado na função)
  if exists (select 1 from vault.secrets where name = 'pluggy_cron_secret') then
    perform vault.update_secret(
      (select id from vault.secrets where name = 'pluggy_cron_secret'),
      'COLOQUE-O-MESMO-CRON_SECRET'
    );
  else
    perform vault.create_secret('COLOQUE-O-MESMO-CRON_SECRET', 'pluggy_cron_secret');
  end if;
end $$;

-- 3) Agendamento ------------------------------------------------------------
--    Duas vezes por dia: 09:00 e 21:00 UTC  ==  06:00 e 18:00 (horário de Brasília).
--    Para mudar a frequência, altere a expressão cron abaixo
--    (ex.: '0 9 * * *' = só de manhã;  '0 */6 * * *' = de 6 em 6 horas).
--    Remove um agendamento anterior com o mesmo nome antes de recriar.
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
--  Conferir (opcional):
--    select jobid, jobname, schedule, active from cron.job;
--    -- histórico de execuções (sucesso/erro):
--    select * from cron.job_run_details order by start_time desc limit 10;
-- ============================================================
