-- ============================================================================
-- 2026-06-26 — Corrige transações do Open Finance gravadas como "Cartao Banco"
-- ----------------------------------------------------------------------------
-- CAUSA: quando a Pluggy não devolvia `item.connector.name`, as Edge Functions
-- (pluggy-sync / pluggy-cron) gravavam o literal "Banco" em `connector_name`.
-- A tradução CRU -> lancamentos então não reconhecia a instituição e o
-- lançamento ficava com  banco = "Banco"  e  origem = "Cartao Banco"
-- (ou "Conta Banco"), sem dizer de qual banco era.
--
-- CORREÇÃO DEFINITIVA (na origem): as Edge Functions passam a resolver o banco
-- pelos nomes (name / marketingName) das contas antes de gravar — ver
-- supabase/functions/_shared/pluggy.ts (resolverBancoDoItem) e pluggy-cron.
--
-- ESTA MIGRAÇÃO conserta os dados JÁ gravados:
--   1) re-resolve `connector_name` nas camadas cruas (contas e transações)
--      a partir dos nomes das contas — para que futuras traduções fiquem certas;
--   2) reescreve `banco` e `origem` dos lançamentos já importados.
--
-- Idempotente e conservadora: só toca em linhas presas em "Banco" e apenas
-- quando o banco real PODE ser identificado pelos nomes das contas. O que não
-- der para resolver permanece como está (nada piora).
-- ============================================================================

-- normaliza p/ comparação: minúsculas + sem acento (espelha semAcento do app)
create or replace function public._norm_banco_tmp(p text)
returns text language sql immutable as $func$
  select lower(translate(coalesce(p, ''),
    'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
    'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc'));
$func$;

-- resolvedor de banco canônico (espelha bancoCanonico de src/lib/bancos.ts).
-- Retorna o nome canônico ou NULL quando não dá para reconhecer.
create or replace function public._banco_canon_tmp(p_blob text)
returns text language sql immutable as $func$
  select case
    when s like '%nubank%' or s like '%nu pagamentos%' or s like '%nu financeira%' then 'Nubank'
    when s like '%itau%' then 'Itau'
    when s like '%picpay%' then 'PicPay'
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

-- 1) CONTAS cruas presas em "Banco": re-resolve pelo blob conector + nomes
update public.pluggy_contas_raw c
set connector_name = novo.banco
from (
  select account_id,
         public._banco_canon_tmp(concat_ws(' ', connector_name, name, marketing_name)) as banco
  from public.pluggy_contas_raw
  where coalesce(connector_name, '') in ('', 'Banco')
) novo
where c.account_id = novo.account_id
  and novo.banco is not null;

-- 2) TRANSAÇÕES cruas: herdam o connector_name já corrigido da conta
update public.pluggy_transacoes_raw t
set connector_name = c.connector_name
from public.pluggy_contas_raw c
where t.account_id = c.account_id
  and coalesce(t.connector_name, '') in ('', 'Banco')
  and c.connector_name is not null
  and c.connector_name <> 'Banco';

-- 3) LANÇAMENTOS já importados: reescreve banco e origem usando o banco corrigido
--    da conta. origem preserva o prefixo (Cartao/Conta) e troca só o sufixo.
update public.lancamentos l
set banco = c.connector_name,
    origem = case
      when l.origem like 'Cartao %' then 'Cartao ' || c.connector_name
      when l.origem like 'Conta %'  then 'Conta ' || c.connector_name
      else c.connector_name
    end
from public.pluggy_contas_raw c
where l.pluggy_account_id = c.account_id
  and (l.banco = 'Banco' or l.origem in ('Cartao Banco', 'Conta Banco'))
  and c.connector_name is not null
  and c.connector_name <> 'Banco';

-- limpeza dos helpers temporários
drop function if exists public._banco_canon_tmp(text);
drop function if exists public._norm_banco_tmp(text);
