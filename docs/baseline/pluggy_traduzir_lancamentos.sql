-- ============================================================================
-- BASELINE (somente referência) — definição ATUAL da função de tradução
-- CRU -> lancamentos, extraída do banco em 2026-06-26 via
--   select pg_get_functiondef('public.pluggy_traduzir_lancamentos'::regproc);
--
-- NÃO RODE este arquivo como migração. Ele existe só para versionar/revisar o
-- comportamento atual. A frente W1 parte daqui e cria a migração real (função
-- estendida + backfill) em db/migrations/. Ver docs/fonte-unica-lancamentos.md §5.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.pluggy_traduzir_lancamentos(p_user_id uuid DEFAULT auth.uid())
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare
  v_count integer;
  v_sem_conv integer;
  uid uuid := coalesce(p_user_id, auth.uid());
begin
  if uid is null then
    raise exception 'pluggy_traduzir_lancamentos: user_id nao informado (passe p_user_id ou rode autenticado)';
  end if;

  with item_info as (
    -- 1 linha por item: conector + todos os nomes de conta concatenados
    select c.item_id,
           max(c.connector_name)                 as connector,
           string_agg(coalesce(c.name, ''), ' ') as contas_blob
    from public.pluggy_contas_raw c
    where c.user_id = uid
    group by c.item_id
  ),
  src as (
    select
      t.*,
      (t.account_type = 'CREDIT') as eh_cartao,
      -- banco canônico POR ITEM (conector + nomes das contas); fallback nunca Sandbox
      coalesce(
        public.pluggy_banco_canonico(
          coalesce(t.connector_name, '') || ' ' || coalesce(ii.contas_blob, '')
        ),
        case when t.connector_name is not null and lower(t.connector_name) not like '%pluggy%'
             then t.connector_name end,
        'Banco'
      ) as banco,
      (t.data_mov at time zone 'America/Sao_Paulo') as dt_br,
      -- moeda ISO da transacao: payload tem prioridade; cai p/ coluna moeda; default BRL
      upper(coalesce(nullif(t.payload->>'currencyCode',''), nullif(t.moeda,''), 'BRL')) as moeda_tx,
      -- valor convertido p/ a moeda da conta (BRL), quando internacional
      nullif(t.payload->>'amountInAccountCurrency','')::numeric as amt_conta
    from public.pluggy_transacoes_raw t
    left join item_info ii on ii.item_id = t.item_id
    where t.user_id = uid
  ),
  norm as (
    select
      *,
      (moeda_tx <> 'BRL') as eh_estrangeira,
      (case
         when moeda_tx = 'BRL'      then valor
         when amt_conta is not null then amt_conta
         else valor
       end) as valor_conta
    from src
  ),
  fin as (
    select
      *,
      (case when eh_estrangeira and amt_conta is null then moeda_tx else 'BRL' end) as moeda_out,
      (case when eh_cartao then -valor_conta else valor_conta end) as valor_norm,
      (case when eh_estrangeira then (case when eh_cartao then -valor else valor end) end) as valor_origem_norm
    from norm
  ),
  cls as (
    -- ====== CLASSIFICAÇÃO: não-consumo por sinal estruturado, depois fallback ======
    -- A ORDEM dos WHEN é a PRIORIDADE. Princípios (validados contra os dados reais):
    --  * SALÁRIO (operation_type) vira Receita ANTES de tudo — o Pluggy rotula
    --    portabilidade de salário como categoria='Transfers', e sem este override
    --    a maior fonte de renda sumiria da Receita.
    --  * 'Credit card payment' é a ÚNICA regra de não-consumo que vale no CARTÃO:
    --    é a 2ª perna do pagamento de fatura (crédito no cartão), que precisa ser
    --    neutralizada. As demais regras exigem `not eh_cartao` — no cartão, fora a
    --    fatura, tudo é compra (Gasto) ou estorno real (Estorno/Credito). Sem isso,
    --    compras de cartão mal-rotuladas como 'Transfers' sumiriam do gasto.
    --  * SINAL importa: proventos/renda variável só viram Receita na ENTRADA;
    --    quando são SAÍDA (aporte/compra de ativo, ex.: "Compra de criptomoedas"),
    --    viram aporte (Transferencia) — nunca Receita negativa.
    select
      *,
      case
        -- P05: salário/folha (entrada real) — override; só BANK (op é NULL no cartão)
        when operation_type in ('PORTABILIDADE_SALARIO','FOLHA_PAGAMENTO') and valor_norm > 0
          then 'Receita'
        -- P10: pagamento de fatura (perna CONTA = débito; perna CARTÃO = crédito) -> neutro
        when categoria = 'Credit card payment'
          then 'Transferencia/Pagamento'
        -- P20: resgate/rendimento de aplicação (operation_type; só conta BANK)
        when not eh_cartao and operation_type in ('RESGATE_APLIC_FINANCEIRA','RENDIMENTO_APLIC_FINANCEIRA')
          then 'Transferencia/Pagamento'
        -- P30: investimento/renda fixa/cofrinho (cofrinho vem como Investments)
        when not eh_cartao and categoria in ('Investments','Fixed income')
          then 'Transferencia/Pagamento'
        -- P40a: aporte/compra de ativo (SAÍDA) rotulado como renda var./provento -> neutro
        when not eh_cartao and valor_norm < 0 and categoria in ('Proceeds interests and dividends','Variable income')
          then 'Transferencia/Pagamento'
        -- P40b: resgate de cofrinho/carteira rotulado como provento -> neutro (alinha c/ PDF)
        when not eh_cartao and categoria in ('Proceeds interests and dividends','Variable income')
             and (lower(coalesce(descricao,'')) like '%cofrinho%' or lower(coalesce(descricao,'')) like '%resgate na carteira%')
          then 'Transferencia/Pagamento'
        -- P40c: provento/dividendo/juro RECEBIDO (entrada real) -> Receita
        when not eh_cartao and categoria in ('Proceeds interests and dividends','Variable income')
          then 'Receita'
        -- P50: transferência entre contas próprias (mesma pessoa) — neutraliza 2 pernas
        when not eh_cartao and categoria = 'Same person transfer'
          then 'Transferencia/Pagamento'
        -- P60: transferência genérica / PIX-TED-boleto de transferência (só conta)
        when not eh_cartao and categoria in ('Transfers','Transfer - PIX','Transfer - TED','Transfer - Bank Slip')
          then 'Transferencia/Pagamento'
        -- ===== fallback por sinal (consumo / entrada / estorno real) =====
        when valor_norm < 0 then 'Gasto'
        when eh_cartao      then 'Estorno/Credito'
        else 'Receita'
      end as classe_out,
      case
        when operation_type in ('PORTABILIDADE_SALARIO','FOLHA_PAGAMENTO') and valor_norm > 0
          then 'Salario'
        when categoria = 'Credit card payment'
          then 'Pagamento de fatura'
        when not eh_cartao and operation_type in ('RESGATE_APLIC_FINANCEIRA','RENDIMENTO_APLIC_FINANCEIRA')
          then 'Investimento'
        when not eh_cartao and categoria in ('Investments','Fixed income')
          then 'Investimento'
        when not eh_cartao and valor_norm < 0 and categoria in ('Proceeds interests and dividends','Variable income')
          then 'Investimento'
        when not eh_cartao and categoria in ('Proceeds interests and dividends','Variable income')
             and (lower(coalesce(descricao,'')) like '%cofrinho%' or lower(coalesce(descricao,'')) like '%resgate na carteira%')
          then 'Cofrinho'
        when not eh_cartao and categoria in ('Proceeds interests and dividends','Variable income')
          then 'Rendimentos'
        when not eh_cartao and categoria = 'Same person transfer'
          then 'Entre contas proprias'
        when not eh_cartao and categoria in ('Transfers','Transfer - PIX','Transfer - TED','Transfer - Bank Slip')
          then 'Transferencia'
        -- consumo / entrada comum: mantém a categoria do Pluggy (se houver)
        else nullif(categoria, '')
      end as subtipo_out
    from fin
  )
  insert into public.lancamentos as l (
    hash_natural, competencia, ano, mes, banco, origem, data_mov,
    descricao, detalhe, classe, categoria_auto, valor, natureza,
    moeda, valor_origem, moeda_origem,
    fonte_dados, pluggy_tx_id, pluggy_account_id, pluggy_item_id, user_id
  )
  select
    'pluggy:' || n.tx_id,
    to_char(n.dt_br, 'YYYY-MM') || ' ('
      || (array['Jan','Fev','Mar','Abr','Mai','Jun',
                'Jul','Ago','Set','Out','Nov','Dez'])[extract(month from n.dt_br)::int]
      || '/' || to_char(n.dt_br, 'YY') || ')',
    extract(year  from n.dt_br)::int,
    extract(month from n.dt_br)::int,
    n.banco,
    (case when n.eh_cartao then 'Cartao ' else 'Conta ' end) || n.banco,
    to_char(n.dt_br, 'DD/MM'),
    coalesce(nullif(n.descricao,''), nullif(n.descricao_raw,''), '(sem descricao)'),
    n.operation_type,
    n.classe_out,                                         -- classe (ruleset acima)
    n.subtipo_out,                                        -- categoria_auto (subtipo legível / categoria Pluggy)
    round(n.valor_norm, 2),
    'Pessoal',
    n.moeda_out,                                          -- moeda do `valor`
    round(n.valor_origem_norm, 2),                        -- valor estrangeiro original
    case when n.eh_estrangeira then n.moeda_tx end,       -- moeda estrangeira original
    'pluggy',
    n.tx_id,
    n.account_id,
    n.item_id,
    uid
  from cls n
  on conflict (hash_natural) do update set
    competencia       = excluded.competencia,
    ano               = excluded.ano,
    mes               = excluded.mes,
    banco             = excluded.banco,
    origem            = excluded.origem,
    data_mov          = excluded.data_mov,
    descricao         = excluded.descricao,
    detalhe           = excluded.detalhe,
    classe            = excluded.classe,
    categoria_auto    = excluded.categoria_auto,
    valor             = excluded.valor,
    natureza          = excluded.natureza,
    moeda             = excluded.moeda,
    valor_origem      = excluded.valor_origem,
    moeda_origem      = excluded.moeda_origem,
    fonte_dados       = excluded.fonte_dados,
    pluggy_tx_id      = excluded.pluggy_tx_id,
    pluggy_account_id = excluded.pluggy_account_id,
    pluggy_item_id    = excluded.pluggy_item_id,
    user_id           = excluded.user_id;
    -- categoria_manual NAO entra no UPDATE -> preserva o que voce editou no front

  get diagnostics v_count = row_count;

  select count(*) into v_sem_conv
    from public.pluggy_transacoes_raw t
   where t.user_id = uid
     and upper(coalesce(nullif(t.payload->>'currencyCode',''), nullif(t.moeda,''), 'BRL')) <> 'BRL'
     and nullif(t.payload->>'amountInAccountCurrency','') is null;

  if v_sem_conv > 0 then
    raise notice 'pluggy_traduzir_lancamentos: % transacao(oes) em moeda estrangeira SEM conversao do Pluggy -> mantidas na moeda original.', v_sem_conv;
  end if;

  return v_count;
end;
$function$;
