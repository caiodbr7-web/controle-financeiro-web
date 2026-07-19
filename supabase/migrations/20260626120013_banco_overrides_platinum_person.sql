-- ============================================================================
-- 2026-06-26 (3) — Atribui banco a cartões do agregador cujo nome não cita o banco
-- ----------------------------------------------------------------------------
-- Sobraram contas no agregador "MeuPluggy" cujo NOME do produto não revela a
-- instituição, então a resolução por nome (migração anterior) não conseguiu
-- identificá-las. O dono das contas confirmou a quem pertencem:
--     "platinum"                     -> Nubank
--     "PERSON MULTIPLO BLACK PONTOS" -> Itau
--
-- Espelha o OVERRIDE_CONTA das Edge Functions (match EXATO no nome normalizado).
-- Conservadora: só toca nessas contas específicas e quando o banco ainda diverge.
-- ============================================================================

create or replace function public._norm_banco_tmp(p text)
returns text language sql immutable as $func$
  select trim(regexp_replace(
    lower(translate(coalesce(p, ''),
      'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
      'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')),
    '\s+', ' ', 'g'));
$func$;

-- 1) CONTAS cruas: aplica o override pelo nome exato do produto
update public.pluggy_contas_raw c
set connector_name = m.banco
from (values
  ('platinum', 'Nubank'),
  ('person multiplo black pontos', 'Itau')
) as m(nome, banco)
where public._norm_banco_tmp(c.name) = m.nome
  and c.connector_name is distinct from m.banco;

-- 2) TRANSAÇÕES cruas: herdam o banco corrigido da conta
update public.pluggy_transacoes_raw t
set connector_name = c.connector_name
from public.pluggy_contas_raw c
where t.account_id = c.account_id
  and public._norm_banco_tmp(c.name) in ('platinum', 'person multiplo black pontos')
  and c.connector_name in ('Nubank', 'Itau')
  and t.connector_name is distinct from c.connector_name;

-- 3) LANÇAMENTOS: reescreve banco e origem (preserva o prefixo Cartao/Conta)
update public.lancamentos l
set banco = c.connector_name,
    origem = case
      when l.origem like 'Cartao %' then 'Cartao ' || c.connector_name
      when l.origem like 'Conta %'  then 'Conta ' || c.connector_name
      else c.connector_name
    end
from public.pluggy_contas_raw c
where l.pluggy_account_id = c.account_id
  and public._norm_banco_tmp(c.name) in ('platinum', 'person multiplo black pontos')
  and c.connector_name in ('Nubank', 'Itau')
  and l.banco is distinct from c.connector_name;

drop function if exists public._norm_banco_tmp(text);
