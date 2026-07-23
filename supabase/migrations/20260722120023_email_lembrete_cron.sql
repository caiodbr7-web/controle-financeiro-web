-- ============================================================
--  Lembrete SEMANAL de classificação por e-mail (cron job)
--
--  Agenda o pg_cron para chamar a Edge Function `email-lembrete` toda
--  segunda-feira às 09:30 (Brasília) = 12:30 UTC. A função envia, para cada
--  usuário cadastrado COM pendências de classificação, um e-mail com:
--    • gasto do mês corrente vs esperado (média dos últimos 3 meses);
--    • os maiores lançamentos pendentes de classificação;
--    • botão que abre o app direto na aba Classificar.
--
--  REUSA a infraestrutura do sync automático (migração *_cron_sync.sql):
--    - a URL da função é derivada do segredo `pluggy_cron_url` do Vault
--      (troca "pluggy-cron" por "email-lembrete") — nada para editar aqui;
--    - a autorização usa o MESMO `pluggy_cron_secret` (header x-cron-secret).
--
--  PRÉ-REQUISITOS (uma vez, fora deste SQL):
--    1) Secrets da Edge Function (Project Settings -> Edge Functions -> Secrets):
--         BREVO_API_KEY    chave da API do Brevo (brevo.com; 300 e-mails/dia grátis,
--                          remetente único verificado — NÃO precisa de domínio)
--         EMAIL_FROM       o remetente verificado na conta do Brevo,
--                          ex.: "Controle Financeiro <voce@gmail.com>"
--         RESEND_API_KEY   (alternativa ao Brevo; exige domínio verificado
--                          p/ enviar a terceiros)
--         APP_URL          (opcional) URL do app, p/ o botão do e-mail
--       CRON_SECRET já existe (é o mesmo do pluggy-cron).
--    2) A função `email-lembrete` deploya sozinha no merge (functions.yml).
--
--  É seguro rodar mais de uma vez (idempotente): reagenda o mesmo job.
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('lembrete-classificacao-semanal')
where exists (select 1 from cron.job where jobname = 'lembrete-classificacao-semanal');

select cron.schedule(
  'lembrete-classificacao-semanal',
  '30 12 * * 1',  -- segunda-feira, 09:30 em Brasília (12:30 UTC)
  $$
  select net.http_post(
    url     := replace(
                 (select decrypted_secret from vault.decrypted_secrets where name = 'pluggy_cron_url'),
                 'pluggy-cron', 'email-lembrete'
               ),
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'pluggy_cron_secret')
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $$
);

-- ============================================================
--  Conferir (opcional):
--    select jobid, jobname, schedule, active from cron.job;
--    select * from cron.job_run_details order by start_time desc limit 10;
--  Testar sem esperar segunda (envia de verdade; use dryRun p/ só simular):
--    -- via curl:  POST {URL}/functions/v1/email-lembrete
--    --            header x-cron-secret: {CRON_SECRET}
--    --            body {"dryRun": true}
-- ============================================================
