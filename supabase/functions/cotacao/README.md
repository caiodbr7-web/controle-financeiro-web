# Edge Function: `cotacao`

Cotação de mercado de **tickers** (ex.: o ETF `VT`) + **câmbio USD→BRL**, de
fontes **gratuitas e sem API key**:

- **Preço dos ativos:** [Yahoo Finance](https://finance.yahoo.com) (`/v8/finance/chart`).
- **Câmbio p/ BRL:** [open.er-api.com](https://www.exchangerate-api.com/docs/free)
  (principal) + [frankfurter.app](https://www.frankfurter.app) / BCE (reserva).

Serve para precificar as **posições manuais** (fora do Open Finance) que têm um
`ticker`: o front (aba *Investimentos*) chama esta função, recebe o preço e o
câmbio, e calcula o valor atual de cada posição.

Existe como Edge Function porque o navegador **não pode** chamar provedores de
cotação direto (CORS). A função roda no servidor e devolve com CORS liberado.

## Pré-requisitos

1. **Rodar a migration** (uma vez, no Supabase → SQL Editor):

   ```
   db/migrations/2026-06-28-investimentos-manuais-cotacao.sql
   ```

2. **Secrets**: nenhum. As fontes são públicas. A função só exige o **JWT do
   usuário logado** (`Authorization: Bearer …`), para não virar um proxy aberto.
   `SUPABASE_URL` e `SUPABASE_ANON_KEY` já são injetadas automaticamente.

## Deploy

```bash
supabase functions deploy cotacao
```

## Contrato

`POST /functions/v1/cotacao`

- Header: `Authorization: Bearer <jwt do usuário>`
- Body: `{ "tickers": ["VT", "BND"] }` (lista pode ser vazia — devolve só o câmbio)
- Resposta:

  ```json
  {
    "ok": true,
    "fonte": "yahoo",
    "usdbrl": 5.43,
    "quotes": { "VT": { "price": 118.34, "currency": "USD" } }
  }
  ```

## Notas

- Tickers dos EUA são usados como estão (`VT`); outras bolsas usam o sufixo do
  Yahoo (ex.: `PETR4.SA`).
- O preço do Yahoo é o `regularMarketPrice` (perto do tempo real durante o
  pregão; o último de fechamento fora dele).
- Se um ticker não existir / estiver sem dado, ele simplesmente não aparece em
  `quotes` (o front mantém o último preço conhecido da posição).
