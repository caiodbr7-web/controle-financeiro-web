-- ============================================================================
-- 2026-06-26 (2) — Corrige o banco POR CONTA em conexões agregadoras (MeuPluggy)
-- ----------------------------------------------------------------------------
-- CAUSA: o conector "MeuPluggy" (connector_id 200) é um AGREGADOR — numa única
-- conexão vêm contas de bancos diferentes (XP, Nubank, PicPay, Itaú…). O banco
-- real NÃO está no conector (que é sempre "MeuPluggy"), e sim no nome de CADA
-- conta (pluggy_contas_raw.name / marketing_name). Como a tradução derivava o
-- banco do connector_name da conexão, todos os lançamentos ficavam como
-- banco = "MeuPluggy" / origem = "Conta MeuPluggy".
--
-- A migração anterior (2026-06-26-corrigir-banco-cartao-banco) só tratava o
-- genérico "Banco" e resolvia no nível do item — não pegava o caso "MeuPluggy"
-- nem separava banco por conta. Esta resolve o banco de cada CONTA pelo nome
-- dela e reescreve as camadas cruas + os lançamentos.
--
-- CORREÇÃO NA ORIGEM: as Edge Functions passam a resolver o banco por conta
-- (resolverBancoDaConta) — ver supabase/functions/_shared/pluggy.ts e pluggy-cron.
--
-- Idempotente e conservadora: só mexe em linhas com conector agregador/genérico
-- ("%pluggy%" ou "Banco") e apenas quando o nome da conta revela um banco
-- conhecido. O que não der para identificar (ex.: cartões "platinum",
-- "PERSON MULTIPLO BLACK PONTOS") permanece como está.
-- ============================================================================

-- normaliza p/ comparação: minúsculas + sem acento
create or replace function public._norm_banco_tmp(p text)
returns text language sql immutable as $func$
  select lower(translate(coalesce(p, ''),
    'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
    'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc'));
$func$;

-- resolvedor de banco canônico (espelha bancoCanonico de src/lib/bancos.ts).
-- Recebe o nome/marketing da conta. Retorna o nome canônico ou NULL.
create or replace function public._banco_canon_tmp(p_blob text)
returns text language sql immutable as $func$
  select case
    when s like '%nubank%' or s like '%nu pagamentos%' or s like '%nu financeira%' then 'Nubank'
    when s like '%itau%' then 'Itau'
    when s like '%picpay%' or s like '%pic pay%' then 'PicPay'
    when s like '%rico%' then 'Rico'
    when s ~ '(^|[^a-z])xp([^a-z]|$)' then 'XP'
    when s like '%bradesco%' then 'Bradesco'
    when s like '%santander%' then 'Santander'
    when s like '%banco do brasil%' then 'Banco do Brasil'
    when s like '%caixa%' then 'Caixa'
    when s like '%inter%' then 'Inter'
    when s like '%c6%' then 'C6'
    when s like '%btg%' then 'BTG'
    when s like '%mercado pago%' or s like '%mercadopago%' then 'Mercado Pago'
    when s like '%pagbank%' or s like '%pagseguro%' then 'PagBank'
    when s like '%safra%' then 'Safra'
    when s like '%neon%' then 'Neon'
    when s like '%sicoob%' then 'Sicoob'
    when s like '%sicredi%' then 'Sicredi'
    when s like '%original%' then 'Original'
    else null
  end
  from (select public._norm_banco_tmp(p_blob) as s) n;
$func$;

-- 1) CONTAS cruas: resolve o banco de cada conta pelo NOME dela (name + marketing)
update public.pluggy_contas_raw c
set connector_name = novo.banco
from (
  select account_id,
         public._banco_canon_tmp(concat_ws(' ', name, marketing_name)) as banco
  from public.pluggy_contas_raw
  where connector_name ilike '%pluggy%'
     or coalesce(connector_name, '') in ('', 'Banco')
) novo
where c.account_id = novo.account_id
  and novo.banco is not null;

-- 2) TRANSAÇÕES cruas: herdam o banco já resolvido da conta
update public.pluggy_transacoes_raw t
set connector_name = c.connector_name
from public.pluggy_contas_raw c
where t.account_id = c.account_id
  and (t.connector_name ilike '%pluggy%' or coalesce(t.connector_name, '') in ('', 'Banco'))
  and c.connector_name is not null
  and c.connector_name not ilike '%pluggy%'
  and c.connector_name <> 'Banco';

-- 3) LANÇAMENTOS: reescreve banco e origem com o banco da conta (preserva o
--    prefixo Cartao/Conta e troca só o sufixo)
update public.lancamentos l
set banco = c.connector_name,
    origem = case
      when l.origem like 'Cartao %' then 'Cartao ' || c.connector_name
      when l.origem like 'Conta %'  then 'Conta ' || c.connector_name
      else c.connector_name
    end
from public.pluggy_contas_raw c
where l.pluggy_account_id = c.account_id
  and (l.banco ilike '%pluggy%' or l.banco = 'Banco')
  and c.connector_name is not null
  and c.connector_name not ilike '%pluggy%'
  and c.connector_name <> 'Banco';

-- limpeza dos helpers temporários
drop function if exists public._banco_canon_tmp(text);
drop function if exists public._norm_banco_tmp(text);
