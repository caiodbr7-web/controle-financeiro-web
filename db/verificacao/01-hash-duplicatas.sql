-- ============================================================================
-- 01 — Colisões / duplicatas de hash_natural
-- ----------------------------------------------------------------------------
-- O hash_natural é a CHAVE de dedup (ON CONFLICT na função do Pluggy; filtro de
-- import em src/lib/import.ts). Se houver mais de uma linha com o mesmo
-- hash_natural, ou o dedup falhou, ou dois fatos diferentes colidiram no mesmo
-- hash (colisão dura) — qualquer um dos dois infla o gasto/receita.
--
-- Espera-se: 0 linhas em TODAS as queries abaixo.
-- Somente SELECT. Idempotente.
-- ============================================================================

-- 1.1 — hash_natural repetido (a chave deveria ser única por usuário).
-- Mostra o hash, quantas vezes aparece, e se mistura fontes/valores (sinal de
-- colisão de fatos distintos vs. simples re-inserção do mesmo fato).
select
  hash_natural,
  count(*)                                    as ocorrencias,
  count(distinct fonte_dados)                 as fontes_distintas,
  count(distinct round(valor, 2))             as valores_distintos,
  count(distinct left(competencia, 7))        as competencias_distintas,
  min(left(competencia, 7))                   as comp_min,
  max(left(competencia, 7))                   as comp_max,
  string_agg(distinct coalesce(descricao, ''), ' | ' order by coalesce(descricao, '')) as descricoes
from public.lancamentos
where user_id = auth.uid()
group by hash_natural
having count(*) > 1
order by ocorrencias desc, hash_natural;

-- 1.2 — colisão DURA: mesmo hash_natural com valores OU descrições diferentes.
-- Pior caso: o hash uniu duas transações reais distintas -> uma some do total.
-- (Se 1.1 já vier vazia, esta também vem.)
with dup as (
  select hash_natural
  from public.lancamentos
  where user_id = auth.uid()
  group by hash_natural
  having count(distinct round(valor, 2)) > 1
      or count(distinct lower(coalesce(descricao, ''))) > 1
)
select l.hash_natural, l.fonte_dados, l.competencia, l.data_mov,
       l.origem, l.valor, l.descricao
from public.lancamentos l
join dup using (hash_natural)
where l.user_id = auth.uid()
order by l.hash_natural, l.valor;

-- 1.3 — sanidade do prefixo do hash por fonte.
-- Pluggy deve ser 'pluggy:%'; PDF/import deve ser 'imp_%'. Linhas fora do padrão
-- (ex.: pluggy com hash 'imp_', ou import marcado como pluggy) denunciam um
-- pipeline cruzado que pode escapar do dedup.
select
  case when fonte_dados = 'pluggy' then 'pluggy' else 'pdf/import' end as fonte,
  case
    when hash_natural like 'pluggy:%' then 'pluggy:*'
    when hash_natural like 'imp\_%'   then 'imp_*'
    else 'OUTRO'
  end                                         as prefixo_hash,
  count(*)                                    as linhas
from public.lancamentos
where user_id = auth.uid()
group by 1, 2
order by 1, 2;

-- 1.4 — Pluggy: mesmo pluggy_tx_id em mais de uma linha (tx_id é único na origem).
-- Se aparecer, a tradução gerou linhas duplicadas para a mesma transação Pluggy.
select pluggy_tx_id, count(*) as linhas,
       string_agg(distinct left(competencia, 7), ', ') as competencias
from public.lancamentos
where user_id = auth.uid()
  and fonte_dados = 'pluggy'
  and pluggy_tx_id is not null
group by pluggy_tx_id
having count(*) > 1
order by linhas desc;
