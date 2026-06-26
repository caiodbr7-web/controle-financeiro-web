# Edge Function: `pluggy-cron`

Sincronização **automática (agendada)** de todas as conexões Pluggy. É o "robô"
que mantém sua base atualizada sozinha — você não precisa mais clicar em
**Sincronizar**.

A cada execução ela atualiza, para **todos os usuários**:

- **transações + saldos** (Pluggy → camada crua → RPCs `pluggy_traduzir_lancamentos`
  e `pluggy_reconstruir_saldos_diarios`);
- **investimentos** (`/investments` → `pluggy_investments` + histórico diário).

## Como é segura e à prova de futuro

A função é **autossuficiente** e roda com **service role**. Ela replica
internamente a mesma lógica das funções manuais (`pluggy-sync` e
`pluggy-investments`), então:

- **não depende de JWT de usuário** → imune à migração de chaves JWT do projeto
  (chaves assimétricas / legacy secret);
- **não altera** `pluggy-sync` nem `pluggy-investments` → a sincronização manual
  que você já usa continua intacta;
- quem autoriza a chamada é o header **`x-cron-secret`** (igual ao `CRON_SECRET`),
  não um token.

## Pré-requisitos

Secrets da função (Supabase → Project Settings → Edge Functions → Secrets):

```
CRON_SECRET=...            # uma string forte qualquer (você escolhe)
PLUGGY_CLIENT_ID=...       # já deve existir (usado pelas outras funções)
PLUGGY_CLIENT_SECRET=...   # já deve existir
```

> `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` são injetadas automaticamente.
> **Não** é necessário `SUPABASE_JWT_SECRET`.

## Deploy

Quem autoriza é o `CRON_SECRET` (não um JWT), então deploy **sem verificação de JWT**:

```bash
supabase functions deploy pluggy-cron --no-verify-jwt
```

> Pelo painel: crie a função, cole o `index.ts`, faça o Deploy e **desative
> "Verify JWT"** nas configurações da função.

## Agendamento

Rode a migration que cria o cron job (Supabase → SQL Editor):

```
db/migrations/2026-06-21-cron-sync.sql
```

Usa `pg_cron` + `pg_net` para chamar esta função **2x por dia** (06:00 e 18:00 de
Brasília). Frequência configurável na própria migration.

## Contrato

`POST /functions/v1/pluggy-cron`

- Header: `x-cron-secret: <CRON_SECRET>` (obrigatório).
- Body (opcional): `{ "userId": "...", "itemId": "..." }` limita o escopo — útil
  para testar uma conexão só. Sem body, sincroniza tudo.
- Resposta: `{ ok, usuarios, conexoes, erros, resumo }`.

## Testar manualmente

```bash
curl -X POST 'https://SEU-PROJETO.supabase.co/functions/v1/pluggy-cron' \
  -H 'x-cron-secret: SEU_CRON_SECRET' \
  -H 'Content-Type: application/json' -d '{}'
```
