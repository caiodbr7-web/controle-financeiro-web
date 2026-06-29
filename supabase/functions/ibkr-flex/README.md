# Edge Function: `ibkr-flex`

Importa as **posições da sua conta IBKR** (Interactive Brokers) via **Flex Web
Service** (somente leitura — **não** precisa de TWS/IB Gateway rodando) para a
tabela `public.pluggy_investments` com `fonte = 'ibkr'`, junto da carteira do
Open Finance. Assim a IBKR entra nos KPIs, na composição e no histórico.

## Como funciona

1. **SendRequest** → recebe um `ReferenceCode`.
2. **GetStatement** (com polling enquanto o relatório é gerado) → XML com as
   `OpenPosition`.
3. Para cada posição: `saldo`/`valor_aplicado` são gravados **em BRL** — o valor
   nativo (`quantidade × preço`, na moeda do ativo) é convertido pelo câmbio do
   dia (open.er-api.com, com reserva no frankfurter.app/BCE — grátis, sem chave).
   A linha da aba *Investimentos* mostra o valor em US$ com o R$ equivalente no
   hover.
4. Faz `upsert` por posição (id estável `ibkr-<conta>-<conid>`) e remove as que
   foram fechadas. As suas reclassificações (`tipo_manual`, liquidez) são
   **preservadas** entre importações.

Dois modos de chamada:

- **Usuário** (`Authorization: Bearer <jwt>`): importa a conta do próprio
  usuário — usado pelo botão **Importar IBKR**.
- **Cron** (`x-cron-secret: <CRON_SECRET>`): percorre todos os usuários com
  credencial IBKR — agendado junto do sync da Pluggy.

## Pré-requisitos

1. **Migration** (uma vez, Supabase → SQL Editor):
   ```
   db/migrations/2026-06-28-ibkr-flex.sql
   ```
   Cria a coluna `fonte`, a tabela `ibkr_flex` (credenciais por usuário, RLS) e
   agenda a importação automática no mesmo horário do cron da Pluggy.

2. **Secrets**: nenhum novo. Usa os já existentes do projeto: `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY` e `CRON_SECRET` (o mesmo do `pluggy-cron`).
   O **token e o query id da IBKR** ficam por usuário na tabela `ibkr_flex`.

## Deploy

```bash
supabase functions deploy ibkr-flex --no-verify-jwt
```
> `--no-verify-jwt` porque a função valida **ela mesma** o JWT do usuário **ou**
> o `x-cron-secret` (o cron não manda JWT).

## O que você precisa fazer na IBKR (uma vez)

No **Client Portal** → **Performance & Reports** → **Flex Queries**:

1. Em **Activity Flex Query**, clique no **+**, dê um nome e em **Sections**
   ative **Open Positions** (marque ao menos: `symbol`, `conid`, `position`,
   `markPrice`, `positionValue`, `currency`, `costBasisMoney`, `assetCategory`,
   `fxRateToBase`). Em **Delivery Configuration**, Format = **XML**, Period =
   **Last Business Day**. Salve.
2. Clique no **ⓘ** ao lado da query salva e copie o **Query ID** (número).
3. Em **Flex Web Service Configuration**, **ative** o serviço e clique em
   **Generate New Token** (escolha a validade — até 1 ano). Copie o **token**.

Cole **token** e **Query ID** na aba *Investimentos* → botão **IBKR** →
**Conectar**. Pronto: o app importa na hora e, depois, sozinho 2×/dia.

## Contrato

`POST /functions/v1/ibkr-flex`

- Usuário: `Authorization: Bearer <jwt>`, body `{}`. Resposta `{ ok, posicoes, accountId }`.
- Cron: header `x-cron-secret`. Resposta `{ ok, usuarios, importados, erros }`.

## Notas

- O Flex é um retrato de **fim de dia** (não tempo real) — ideal para patrimônio.
- Limite prático: poucas chamadas por dia por token (o cron roda 2×/dia).
- Token expira conforme a validade escolhida; ao expirar, gere outro e reconecte.
