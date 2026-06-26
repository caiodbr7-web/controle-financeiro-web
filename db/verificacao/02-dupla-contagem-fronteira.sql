-- ============================================================================
-- 02 — Mesma transação nas DUAS fontes no mesmo MÊS REAL (risco de dupla contagem)
-- ----------------------------------------------------------------------------
-- O corte do hook é por `competencia`. Mas a competência NÃO é o mesmo eixo nas
-- duas fontes:
--   * PDF de cartão:  competencia = mês da FATURA   (compra de mai cai na fatura jun)
--   * Pluggy:         competencia = mês da TRANSAÇÃO (dt_br) — compra de mai = mai
-- Logo, uma MESMA compra pode ter competência diferente em cada fonte e cair em
-- lados opostos do corte '2026-06' -> aparece DUAS VEZES no total agregado.
--
-- Esta auditoria reconstrói o "mês real" (data da compra), igual a mesReal()/
-- dvDataReal() de src/lib/finance.ts, e procura a MESMA transação (valor + mês
-- real próximos) presente nas duas fontes — priorizando a fronteira do corte.
--
-- mesReal (SQL): data_mov='DD/MM'; ano = ano(competencia) - (1 se MM>mês(competencia)
--                senão 0); cai no mês da competência quando data_mov é inválida.
--
-- Somente SELECT. Idempotente. Nada é apagado: a leitura é diagnóstica.
-- ============================================================================

-- View lógica reutilizável: cada lançamento com seu mês real (YYYY-MM) e fonte.
with base as (
  select
    l.*,
    case when fonte_dados = 'pluggy' then 'pluggy' else 'pdf' end as fonte,
    -- parse de data_mov 'DD/MM'
    nullif(split_part(data_mov, '/', 1), '')::int as dd,
    nullif(split_part(data_mov, '/', 2), '')::int as mm,
    left(competencia, 4)::int                     as comp_ano,
    substring(competencia from 6 for 2)::int      as comp_mes
  from public.lancamentos l
  where l.user_id = auth.uid()
),
mr as (
  select
    *,
    case
      when dd between 1 and 31 and mm between 1 and 12 then
        to_char(
          make_date(case when mm > comp_mes then comp_ano - 1 else comp_ano end, mm, 1),
          'YYYY-MM')
      else left(competencia, 7)         -- data_mov inválida -> mês da competência
    end as mes_real
  from base
)

-- 2.1 — PAR provável entre fontes: mesmo |valor| (centavos) e mesmo mês real,
-- existindo em PDF E em pluggy. Casar por valor+mês não é prova absoluta (pode
-- coincidir), mas no MESMO mês real é forte indício de a mesma compra estar
-- contada duas vezes. Marca se o par cruza a fronteira do corte '2026-06'.
select
  p.mes_real,
  round(p.valor, 2)                              as valor,
  p.descricao                                    as desc_pdf,
  o.descricao                                    as desc_pluggy,
  p.competencia                                  as comp_pdf,
  o.competencia                                  as comp_pluggy,
  -- a fronteira: se as competências caem em lados opostos do corte, o corte do
  -- hook NÃO desduplicou esta transação (uma some, a outra fica) -> dupla
  -- contagem efetiva quando ambas estão visíveis em algum recorte.
  (left(p.competencia, 7) < '2026-06') <> (left(o.competencia, 7) < '2026-06')
                                                 as cruza_corte
from mr p
join mr o
  on o.fonte = 'pluggy' and p.fonte = 'pdf'
 and round(o.valor, 2) = round(p.valor, 2)
 and o.mes_real = p.mes_real
where p.classe in ('Gasto', 'Receita')           -- só o que entra em total
order by cruza_corte desc, p.mes_real desc, abs(p.valor) desc;

-- ----------------------------------------------------------------------------
-- 2.2 — Resumo da sobreposição: por mês real, quantas linhas/qto valor cada
-- fonte tem. Onde AS DUAS fontes têm volume no mesmo mês real, há janela de
-- sobreposição -> o corte por competência precisa estar separando corretamente.
-- ----------------------------------------------------------------------------
with base as (
  select
    l.*,
    case when fonte_dados = 'pluggy' then 'pluggy' else 'pdf' end as fonte,
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
  count(*) filter (where fonte = 'pdf')                                   as n_pdf,
  count(*) filter (where fonte = 'pluggy')                                as n_pluggy,
  round(sum(abs(valor)) filter (where fonte = 'pdf'    and classe = 'Gasto'), 2) as gasto_pdf,
  round(sum(abs(valor)) filter (where fonte = 'pluggy' and classe = 'Gasto'), 2) as gasto_pluggy
from mr
group by mes_real
having count(*) filter (where fonte = 'pdf') > 0
   and count(*) filter (where fonte = 'pluggy') > 0
order by mes_real desc;

-- ----------------------------------------------------------------------------
-- 2.3 — Cartão na fronteira do corte: compras cuja COMPETÊNCIA (fatura) e MÊS
-- REAL (compra) caem em lados diferentes do corte. São as linhas mais propensas
-- a escapar do dedup por competência. Lista as do PDF perto do corte.
-- ----------------------------------------------------------------------------
with base as (
  select
    l.*,
    nullif(split_part(data_mov, '/', 1), '')::int as dd,
    nullif(split_part(data_mov, '/', 2), '')::int as mm,
    left(competencia, 4)::int                     as comp_ano,
    substring(competencia from 6 for 2)::int      as comp_mes
  from public.lancamentos l
  where l.user_id = auth.uid()
    and (fonte_dados is null or fonte_dados <> 'pluggy')   -- PDF
    and origem like 'Cartao %'
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
select competencia, mes_real, origem, data_mov, round(valor, 2) as valor, descricao
from mr
where left(competencia, 7) >= '2026-05'           -- ao redor do corte
  and mes_real <> left(competencia, 7)             -- compra cai em mês != fatura
order by competencia, mes_real, valor;
