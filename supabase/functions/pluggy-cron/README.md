# Edge Function: `pluggy-cron`

Sincronização **automática (agendada)** de todas as conexões Pluggy. É o "robô"
que mantém sua base atualizada sozinha — você não precisa mais clicar em
**Sincronizar**.

A cada execução ela atualiza, para **todos os usuários**:

- **transações + saldos** → chamando `pluggy-sync` (uma vez por conexão);
- **investimentos** → chamando `pluggy-investments` (uma vez por usuário).

Em vez de reimplementar a lógica financeira, ela **reaproveita as funções já
testadas**. Para isso, roda com a *service role* (enxerga as conexões de todos os
donos) e, para cada usuário, gera um **JWT curto** assinado com o *JWT secret* do
projeto — assim a RLS continua isolando cada usuário, exatamente como quando ele
mesmo sincroniza pelo app.

## Pré-requisitos

1. **Secrets** da função (Supabase → Project Settings → Edge Functions → Secrets):

   ```
   CRON_SECRET=...            # uma string forte qualquer (você escolhe)
   SUPABASE_JWT_SECRET=...    # o "JWT Secret" do projeto (Project Settings → API)
   PLUGGY_CLIENT_ID=...       # já deve existir (usado por pluggy-sync)
   PLUGGY_CLIENT_SECRET=...   # já deve existir
   ```

   > `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` são
   > injetadas automaticamente.

2. As funções `pluggy-sync` e `pluggy-investments` precisam estar **deployadas**.

## Deploy

Quem autoriza a função é o `CRON_SECRET` (não um JWT de usuário), então faça o
deploy **sem verificação de JWT**:

```bash
supabase functions deploy pluggy-cron --no-verify-jwt
```

## Agendamento

Rode a migration que cria o cron job (Supabase → SQL Editor):

```
db/migrations/2026-06-21-cron-sync.sql
```

Ela usa `pg_cron` + `pg_net` para chamar esta função **2x por dia** (09:00 e
21:00 UTC = 06:00 e 18:00 de Brasília). A frequência é configurável na própria
migration (expressão cron).

## Contrato

`POST /functions/v1/pluggy-cron`

- Header: `x-cron-secret: <CRON_SECRET>` (obrigatório).
- Body: `{}`.
- Resposta: `{ ok, usuarios, conexoes, sync: { ok, erro }, investimentos: { ok, erro }, resumo }`.

## Testar manualmente

```bash
curl -X POST 'https://SEU-PROJETO.supabase.co/functions/v1/pluggy-cron' \
  -H 'x-cron-secret: SEU_CRON_SECRET' \
  -H 'Content-Type: application/json' -d '{}'
```
