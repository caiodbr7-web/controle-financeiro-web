# Edge Function: `cotacao`

Cotação de mercado de **tickers** (ex.: o ETF `VT`) + **câmbio USD→BRL**, lidos do
[Stooq](https://stooq.com) — fonte **gratuita e sem API key**.

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

2. **Secrets**: nenhum. O Stooq é público. A função só exige o **JWT do usuário
   logado** (`Authorization: Bearer …`), para não virar um proxy aberto.
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
    "fonte": "stooq",
    "usdbrl": 5.43,
    "quotes": { "VT": { "price": 118.34, "currency": "USD" } }
  }
  ```

## Notas

- Símbolos sem sufixo assumem bolsa dos EUA (`VT` → `vt.us`). Para outras bolsas,
  informe o sufixo do Stooq no próprio ticker (ex.: `PETR4.SA`).
- O preço do Stooq é o **último fechamento** (atrasado, não tempo real) — ótimo
  para acompanhar patrimônio, não para day-trade.
- Se um ticker não existir / estiver sem dado, ele simplesmente não aparece em
  `quotes` (o front mantém o último preço conhecido da posição).
