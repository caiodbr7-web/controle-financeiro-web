-- ============================================================================
-- 04 — Totais mensais de gasto/receita por fonte (placar antes/depois)
-- ----------------------------------------------------------------------------
-- Espelha o `totaisPorMes` de src/lib/conciliacao.ts: agrega por MÊS REAL (data
-- da compra, não competência) e separa PDF × Pluggy. É o "placar" para comparar
-- as duas fontes no mesmo eixo e para validar antes/depois do W1:
--   * gasto = soma |valor| de classe 'Gasto'
--   * receita = soma |valor| de classe 'Receita'
--   * só BRL entra na soma (moeda estrangeira não é comparável em real)
-- A versão 04.2 acrescenta as classes novas (Aporte / Receita Investimento) e o
-- recorte por `interna`, refletindo o contrato dos dashboards (§3.4).
--
-- Somente SELECT. Idempotente. Guarde o resultado ANTES de aplicar o W1 e rode
-- de novo DEPOIS para conferir que gasto/receita reais não mudaram (só mudou a
-- separação de interna/aporte/rendimento).
-- ============================================================================

-- helper de mês real, inline (igual a mesReal() de finance.ts)
-- 4.1 — PLACAR clássico (espelha totaisPorMes): gasto/receita por mês real × fonte.
with base as (
  select
    l.*,
    case when fonte_dados = 'pluggy' then 'pluggy' else 'pdf' end as fonte,
    coalesce(upper(nullif(moeda, '')), 'BRL')     as moeda_eff,
    nullif(split_part(data_mov, '/', 1), '')::int as dd,
    nullif(split_part(data_mov, '/', 2), '')::int as mm,
    left(competencia, 4)::int                     as comp_ano,
    substring(competencia from 6 for 2)::int      as comp_mes
  from public.lancamentos l
  where l.user_id = auth.uid()
),
mr as (
  select *,
    case
      when dd between 1 and 31 and mm between 1 and 12 then
        to_char(make_date(case when mm > comp_mes then comp_ano - 1 else comp_ano end, mm, 1), 'YYYY-MM')
      else left(competencia, 7)
    end as mes_real
  from base
)
select
  mes_real,
  -- PDF
  round(sum(abs(valor)) filter (where fonte='pdf'    and classe='Gasto'   and moeda_eff='BRL'), 2) as gas_pdf,
  round(sum(abs(valor)) filter (where fonte='pdf'    and classe='Receita' and moeda_eff='BRL'), 2) as rec_pdf,
  count(*) filter (where fonte='pdf'    and classe='Gasto'   and moeda_eff='BRL')                  as n_gas_pdf,
  count(*) filter (where fonte='pdf'    and classe='Receita' and moeda_eff='BRL')                  as n_rec_pdf,
  -- Pluggy (Open Finance)
  round(sum(abs(valor)) filter (where fonte='pluggy' and classe='Gasto'   and moeda_eff='BRL'), 2) as gas_of,
  round(sum(abs(valor)) filter (where fonte='pluggy' and classe='Receita' and moeda_eff='BRL'), 2) as rec_of,
  count(*) filter (where fonte='pluggy' and classe='Gasto'   and moeda_eff='BRL')                  as n_gas_of,
  count(*) filter (where fonte='pluggy' and classe='Receita' and moeda_eff='BRL')                  as n_rec_of,
  -- linhas em moeda estrangeira ignoradas na soma (contadas à parte)
  count(*) filter (where moeda_eff <> 'BRL')                                                       as estrangeiras
from mr
group by mes_real
order by mes_real desc;

-- ----------------------------------------------------------------------------
-- 4.2 — Placar pelo CONTRATO dos dashboards (eixo competência, exclui interna,
-- aparta Aporte e Receita Investimento). É a visão que o hook expõe DEPOIS do
-- corte: para cada competência, qual fonte deveria estar visível e os totais
-- líquidos (gasto = Gasto - Estorno, ambos !interna).
-- ----------------------------------------------------------------------------
select
  left(competencia, 7)                            as competencia,
  case when fonte_dados = 'pluggy' then 'pluggy' else 'pdf' end as fonte,
  -- gasto líquido do contrato: Gasto(+) menos Estorno/Credito(-), excl. interna
  round(sum(
    case when interna then 0
         when classe = 'Gasto' then abs(valor)
         when classe = 'Estorno/Credito' then -abs(valor)
         else 0 end), 2)                          as gasto_liq,
  round(sum(case when not interna and classe = 'Receita'              then abs(valor) else 0 end), 2) as receita,
  round(sum(case when classe = 'Aporte'                                then abs(valor) else 0 end), 2) as aportado,
  round(sum(case when classe = 'Receita Investimento'                  then abs(valor) else 0 end), 2) as rend_invest,
  round(sum(case when interna                                          then abs(valor) else 0 end), 2) as internas_excluidas,
  count(*)                                        as linhas
from public.lancamentos
where user_id = auth.uid()
group by 1, 2
order by 1 desc, 2;
