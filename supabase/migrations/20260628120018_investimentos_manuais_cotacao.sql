-- ============================================================
--  Investimentos: posições MANUAIS + cotação de mercado (ticker)
--
--  Permite registrar investimentos que NÃO vêm do Open Finance/Pluggy
--  (ex.: ETF da Vanguard "VT" comprado numa corretora no exterior) na mesma
--  tabela public.pluggy_investments, para que entrem nos KPIs, na composição e
--  no histórico junto com o resto da carteira.
--
--  Colunas novas:
--    manual          -> true para linhas criadas à mão (a sync da Pluggy não as toca)
--    ticker          -> símbolo de mercado p/ cotação ao vivo (ex.: 'VT')
--    moeda_cotacao   -> moeda do preço do ticker (ex.: 'USD'); NULL = em R$
--    preco_unitario  -> último preço unitário (na moeda_cotacao)
--    preco_em        -> quando o preço foi capturado
--
--  IMPORTANTE: `saldo` e `valor_aplicado` continuam sempre em BRL (para os
--  totais e o histórico baterem). Para um ativo em US$, o valor de mercado nativo
--  é quantidade × preco_unitario (em moeda_cotacao); o app converte para BRL com
--  o câmbio ao vivo e grava em `saldo`. A linha da tabela mostra o valor nativo
--  (US$) e o R$ equivalente no hover.
--
--  COMO RODAR:
--    Supabase  ->  SQL Editor  ->  New query  ->  cole TUDO  ->  Run
--  É idempotente e não apaga dados.
-- ============================================================

alter table public.pluggy_investments
  add column if not exists manual         boolean not null default false,
  add column if not exists ticker         text,
  add column if not exists moeda_cotacao  text,
  add column if not exists preco_unitario numeric,
  add column if not exists preco_em       timestamptz;

comment on column public.pluggy_investments.manual is
  'Posição criada manualmente (fora do Open Finance). A sync da Pluggy não a sobrescreve.';
comment on column public.pluggy_investments.ticker is
  'Símbolo de mercado para cotação ao vivo (ex.: VT). NULL = sem cotação automática.';
comment on column public.pluggy_investments.moeda_cotacao is
  'Moeda do preço do ticker (ex.: USD). NULL = preço/valor em BRL.';
comment on column public.pluggy_investments.preco_unitario is
  'Último preço unitário capturado, na moeda_cotacao.';

-- ============================================================
--  Conferir (opcional):
--    select nome, ticker, moeda_cotacao, preco_unitario, saldo
--    from public.pluggy_investments where manual;
-- ============================================================
