-- ============================================================================
-- 05 — Sanidade do corte por competência (o que o hook expõe)
-- ----------------------------------------------------------------------------
-- Reproduz, em SQL, o filtro lancVisivel() de src/hooks/useLancamentos.ts para
-- conferir, mês a mês, QUE FONTE alimenta os dashboards e detectar buracos:
--   * mês SEM nenhuma fonte visível (gasto/receita "somem" daquele mês)
--   * mês com AS DUAS fontes visíveis (não deveria acontecer -> dupla contagem)
--   * linhas Pluggy "no futuro" (competência > mês atual) que o hook oculta
--
-- CORTE = '2026-06' (CORTE_OPEN_BANKING). Ajuste o literal se mudar no hook.
-- O "mês atual" aqui é to_char(now() at sao_paulo,'YYYY-MM'); o hook usa o relógio
-- do navegador (mesAtual()) — em geral coincidem.
--
-- Somente SELECT. Idempotente.
-- ============================================================================

-- 5.1 — Por competência: quantas linhas/qto valor de cada fonte e se ESTÃO
-- VISÍVEIS pelo corte do hook. As colunas *_vis são o que de fato vai pro total.
with cfg as (
  select '2026-06'::text                                        as corte,
         to_char((now() at time zone 'America/Sao_Paulo'), 'YYYY-MM') as mes_atual
),
b as (
  select
    left(l.competencia, 7) as comp,
    case when l.fonte_dados = 'pluggy' then 'pluggy' else 'pdf' end as fonte,
    l.valor, l.classe
  from public.lancamentos l, cfg
  where l.user_id = auth.uid()
)
select
  b.comp,
  cfg.corte, cfg.mes_atual,
  -- visibilidade pelo corte do hook
  count(*) filter (where fonte = 'pdf'    and b.comp <  cfg.corte)                              as pdf_vis,
  count(*) filter (where fonte = 'pdf'    and b.comp >= cfg.corte)                              as pdf_oculto,
  count(*) filter (where fonte = 'pluggy' and b.comp >= cfg.corte and b.comp <= cfg.mes_atual)  as of_vis,
  count(*) filter (where fonte = 'pluggy' and (b.comp < cfg.corte or b.comp > cfg.mes_atual))   as of_oculto,
  -- alerta: nenhuma fonte visível neste mês?
  (count(*) filter (where (fonte='pdf' and b.comp < cfg.corte)
                       or (fonte='pluggy' and b.comp >= cfg.corte and b.comp <= cfg.mes_atual)) = 0)
                                                                                                as mes_sem_fonte,
  -- alerta: as DUAS fontes visíveis no mesmo mês? (não deveria ocorrer)
  (count(*) filter (where fonte='pdf' and b.comp < cfg.corte) > 0
   and count(*) filter (where fonte='pluggy' and b.comp >= cfg.corte and b.comp <= cfg.mes_atual) > 0)
                                                                                                as duas_fontes_visiveis
from b, cfg
group by b.comp, cfg.corte, cfg.mes_atual
order by b.comp desc;

-- ----------------------------------------------------------------------------
-- 5.2 — Buraco do corte: PDF que some (competência >= corte) sem Pluggy cobrindo
-- aquele mês. Se o PDF tem competências >= '2026-06' e não há Pluggy no mesmo
-- mês, esses gastos ficam INVISÍVEIS (o corte mandou para o Pluggy, que não tem).
-- ----------------------------------------------------------------------------
with comp_pdf as (
  select distinct left(competencia, 7) as comp
  from public.lancamentos
  where user_id = auth.uid()
    and (fonte_dados is null or fonte_dados <> 'pluggy')
    and left(competencia, 7) >= '2026-06'
),
comp_of as (
  select distinct left(competencia, 7) as comp
  from public.lancamentos
  where user_id = auth.uid()
    and fonte_dados = 'pluggy'
)
select p.comp as competencia_pdf_perdida
from comp_pdf p
left join comp_of o using (comp)
where o.comp is null
order by p.comp;

-- ----------------------------------------------------------------------------
-- 5.3 — Buraco simétrico: Pluggy que some (competência < corte) sem PDF cobrindo.
-- Pluggy com competência anterior ao corte fica oculto; se o PDF não cobre o mês,
-- esses lançamentos somem. Em geral o histórico é só-PDF, então a lista deveria
-- ser vazia — qualquer mês aqui é um buraco real.
-- ----------------------------------------------------------------------------
with comp_of as (
  select distinct left(competencia, 7) as comp
  from public.lancamentos
  where user_id = auth.uid()
    and fonte_dados = 'pluggy'
    and left(competencia, 7) < '2026-06'
),
comp_pdf as (
  select distinct left(competencia, 7) as comp
  from public.lancamentos
  where user_id = auth.uid()
    and (fonte_dados is null or fonte_dados <> 'pluggy')
)
select o.comp as competencia_pluggy_perdida
from comp_of o
left join comp_pdf p using (comp)
where p.comp is null
order by o.comp;

-- ----------------------------------------------------------------------------
-- 5.4 — Pluggy no futuro: competência > mês atual (faturas adiantadas que o hook
-- oculta de propósito; ver Planejamento). Conferência de quanto está sendo
-- escondido — não é erro, mas é bom dimensionar.
-- ----------------------------------------------------------------------------
select
  left(competencia, 7)               as competencia_futura,
  count(*)                           as linhas,
  round(sum(abs(valor)) filter (where classe = 'Gasto'), 2) as gasto_adiantado
from public.lancamentos, lateral (select to_char((now() at time zone 'America/Sao_Paulo'), 'YYYY-MM') as ma) c
where user_id = auth.uid()
  and fonte_dados = 'pluggy'
  and left(competencia, 7) > c.ma
group by 1
order by 1;
