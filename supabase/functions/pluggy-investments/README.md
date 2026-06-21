# Edge Function: `pluggy-investments`

Sincroniza as **posições de investimento** (endpoint `/investments` da Pluggy) das
conexões (`pluggy_items`) do usuário logado e grava em `public.pluggy_investments`.

É uma função **nova e independente** da `pluggy-sync` (que cuida das transações):
investimentos são um produto à parte da Pluggy e são sincronizados sob demanda,
pelo botão **Sincronizar investimentos** na aba *Investimentos* do app.

## Pré-requisitos

1. **Rodar a migration** que cria a tabela (uma vez, no Supabase → SQL Editor):

   ```
   db/migrations/2026-06-21-investimentos.sql
   ```

2. **Secrets** da função (Supabase → Project Settings → Edge Functions → Secrets).
   Use as **mesmas credenciais** já configuradas para `pluggy-sync`:

   ```
   PLUGGY_CLIENT_ID=...
   PLUGGY_CLIENT_SECRET=...
   ```

   > A função também aceita os nomes `CLIENT_ID` / `CLIENT_SECRET` como fallback,
   > caso seja assim que as suas funções existentes nomeiam os secrets.
   > `SUPABASE_URL` e `SUPABASE_ANON_KEY` já são injetadas automaticamente.

3. A conexão do banco/corretora precisa **suportar o produto `INVESTMENTS`** na
   Pluggy. Se uma conexão antiga não trouxer investimentos, reconecte-a pela aba
   *Conectar*.

## Deploy

Com a [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
supabase functions deploy pluggy-investments
```

## Contrato

`POST /functions/v1/pluggy-investments`

- Header: `Authorization: Bearer <jwt do usuário>`
- Body (opcional): `{ "itemId": "..." }` — sincroniza só essa conexão; sem body,
  sincroniza todas as conexões do usuário.
- Resposta: `{ ok, itens, investimentos, inseridos, por_item }`

O RLS garante que cada usuário só lê/grava as próprias posições.
