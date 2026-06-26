-- ============================================================================
-- 2026-06-27 — Fonte única de gasto/receita: TRADUÇÃO estendida + BACKFILL
-- ----------------------------------------------------------------------------
-- Frente W1 do trabalho de centralizar TODOS os dashboards na tabela
-- `lancamentos`. Esta migração é a LÓGICA que preenche as colunas de schema
-- criadas pela migração do W0 (2026-06-26-fonte-unica-lancamentos-schema.sql:
--   interna, par_hash, subtipo, classe_manual, interna_manual).
--
-- Ela re-declara a função única escritora das linhas Pluggy
--   public.pluggy_traduzir_lancamentos(uuid)
-- partindo do baseline (docs/baseline/pluggy_traduzir_lancamentos.sql) e
-- ESTENDE com (ver docs/fonte-unica-lancamentos.md §3 e §5):
--
--   1) COMPETÊNCIA DE PARCELA (req. 2):
--      Linhas de CARTÃO (eh_cartao) cuja descrição termina em "NN/MM"
--      (parcela NN de MM) passam a contar no mês em que a parcela CAI, derivado
--      do ÍNDICE — não do data_mov. competencia(NN) = âncora + (NN-1) meses,
--      onde a âncora é a competência da parcela 01 do GRUPO (mesmo cartão +
--      estabelecimento normalizado + total MM + valor aproximado). Se a 01 não
--      existir, infere-se por  mês(dt_br) - (NN-1)  usando o MÍNIMO do grupo.
--      Exigimos MM plausível p/ evitar falso-positivo (ex.: "8/10" da Under
--      Armour é parcela; algo que termina em "N/M" sem ser parcela não conta).
--
--   2) CLASSES NOVAS (req. 4 e 5):
--      - subtipo Investimento na SAÍDA (aporte, valor<0) -> classe 'Aporte',
--        interna=true.
--      - subtipo Investimento/Cofrinho na ENTRADA (resgate, valor>0) ->
--        'Transferencia/Pagamento', interna=true, subtipo 'Resgate'
--        (é principal de volta — não é receita).
--      - subtipo Rendimentos (provento/dividendo recebido) E rendimento de
--        aplicação recebido em conta (RENDIMENTO_APLIC_FINANCEIRA crédito) ->
--        classe 'Receita Investimento'.
--
--   3) interna + par_hash (req. 1 e 3):
--      interna=true p/ Pagamento de fatura, Entre contas proprias, aporte/
--      resgate. par_hash casa as DUAS pernas opostas do MESMO usuário
--      (abs(valor) igual, sinais opostos, contas diferentes, janela ~3 dias) e
--      grava a MESMA id nas duas linhas -> pega o pagamento de fatura
--      (débito conta <-> crédito cartão). Transferência genérica
--      (P60 Transfers/PIX/TED) SEM perna própria casada é reclassificada para
--      Receita/Gasto conforme o sinal (ex.: restituição da Receita Federal vira
--      Receita, não transferência neutra).
--
--   4) subtipo na COLUNA `subtipo`; categoria_auto volta a ser a categoria
--      REAL do Pluggy (a que alimenta o classificador).
--
--   5) OVERRIDES MANUAIS: efetivo = coalesce(classe_manual, regra) e
--      coalesce(interna_manual, regra). O ON CONFLICT NÃO sobrescreve
--      classe_manual / interna_manual / categoria_manual.
--
-- Mais abaixo há uma seção de BACKFILL idempotente que reaplica a
-- classificação/competência ao histórico já gravado (Pluggy via a própria
-- função; PDF por descrição/categoria, sem inventar onde não dá).
--
-- COMO RODAR:
--   1) rode antes a migração de schema do W0
--      (2026-06-26-fonte-unica-lancamentos-schema.sql);
--   2) Supabase -> SQL Editor -> New query -> cole TUDO -> Run;
--   3) re-sync (clique "Sincronizar" ou aguarde o cron) — a função re-traduz e
--      o backfill abaixo já deixou o histórico consistente.
--
-- Idempotente (pode rodar de novo), seguro re-rodar, NÃO apaga dados.
-- ============================================================================


-- ============================================================================
-- HELPER 1 — normaliza estabelecimento (p/ agrupar parcelas do mesmo lugar)
-- ----------------------------------------------------------------------------
-- Remove acento, baixa caixa, tira o sufixo de parcela "NN/MM", colapsa
-- espaços e descarta dígitos/pontuação solta. Estável e IMMUTABLE.
-- ============================================================================
create or replace function public._fonte_unica_norm_estab(p text)
returns text language sql immutable as $func$
  select nullif(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          lower(translate(coalesce(p, ''),
            'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
            'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')),
          '\s+\d{1,2}\s*/\s*\d{1,2}\s*$', '', 'g'),  -- tira sufixo "NN/MM" do fim
        '[^a-z ]+', ' ', 'g'),                       -- só letras e espaço
      '\s+', ' ', 'g'),                              -- colapsa espaços
    ' ')
$func$;


-- ============================================================================
-- HELPER 2 — extrai (NN, MM) de uma descrição de cartão, ou (NULL, NULL)
-- ----------------------------------------------------------------------------
-- Regras p/ evitar falso-positivo (algo que termina em N/M sem ser parcela):
--   * o "NN/MM" tem de estar NO FIM da descrição;
--   * MM (total de parcelas) plausível: 2..72;
--   * NN (índice) entre 1 e MM;
--   * NÃO casa quando parece DATA (ex.: "01/12" com NN<=12 e MM=12 ainda casa,
--     mas pedimos eh_cartao no chamador — extratos de cartão raramente trazem
--     datas dd/mm no fim da descrição; e MM<=72 já corta "dd/aaaa").
-- Retorna jsonb {nn, mm} ou NULL.
-- ============================================================================
create or replace function public._fonte_unica_parcela(p text)
returns jsonb language sql immutable as $func$
  with m as (
    select (regexp_match(coalesce(p, ''), '(\d{1,2})\s*/\s*(\d{1,2})\s*$')) as g
  )
  select case
    when g is null then null
    when g[2]::int between 2 and 72
     and g[1]::int between 1 and g[2]::int
      then jsonb_build_object('nn', g[1]::int, 'mm', g[2]::int)
    else null
  end
  from m;
$func$;


-- ============================================================================
-- FUNÇÃO PRINCIPAL — pluggy_traduzir_lancamentos (estendida)
-- ============================================================================
create or replace function public.pluggy_traduzir_lancamentos(p_user_id uuid default auth.uid())
 returns integer
 language plpgsql
as $function$
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
  base as (
    -- acopla descrição efetiva + a parcela (nn,mm) extraída, e o mês "cru" de dt_br
    select
      f.*,
      coalesce(nullif(f.descricao,''), nullif(f.descricao_raw,''), '(sem descricao)') as descricao_eff,
      -- só consideramos parcela em CARTÃO (eh_cartao) — extratos de conta não parcelam
      (case when f.eh_cartao
            then public._fonte_unica_parcela(coalesce(f.descricao, f.descricao_raw))
            else null end) as parc_json,
      -- mês "cru" como date truncado (1º dia do mês de dt_br) — base p/ competência
      date_trunc('month', f.dt_br)::date as mes_cru
    from fin f
  ),
  parcela as (
    -- explode a parcela (nn,mm) em colunas e calcula o "mês inferido da 01"
    --   mes_01_inferido = mês(dt_br) - (nn-1)  -> onde a parcela 01 teria caído
    select
      b.*,
      (b.parc_json->>'nn')::int as parc_nn,
      (b.parc_json->>'mm')::int as parc_mm,
      (case when b.parc_json is not null
            then (date_trunc('month', b.dt_br)
                   - ((b.parc_json->>'nn')::int - 1) * interval '1 month')::date
            end) as mes_01_inferido,
      -- chave do GRUPO de parcelas: cartão/origem + estabelecimento normalizado
      -- + total MM + valor aproximado (em módulo, arredondado p/ casar oscilação)
      (case when b.parc_json is not null
            then b.account_id
                 || '|' || public._fonte_unica_norm_estab(coalesce(b.descricao, b.descricao_raw))
                 || '|' || (b.parc_json->>'mm')
                 || '|' || to_char(round(abs(b.valor_norm)), 'FM999999999')
            end) as grupo_parc
    from base b
  ),
  grupos as (
    -- por GRUPO: a competência da parcela 01 (se existir) e o mês mínimo inferido
    select
      grupo_parc,
      min(case when parc_nn = 1 then mes_cru end)  as mes_ancora_01,  -- 01 real, se houver
      min(mes_01_inferido)                          as mes_ancora_inf  -- fallback (mín. do grupo)
    from parcela
    where grupo_parc is not null
    group by grupo_parc
  ),
  comp as (
    -- competência EFETIVA (1º dia do mês) por linha:
    --   * parcela: âncora (01 real, senão mínimo inferido) + (nn-1) meses
    --   * sem parcela: mês de dt_br
    select
      p.*,
      (case
         when p.parc_json is not null then
           (coalesce(g.mes_ancora_01, g.mes_ancora_inf, p.mes_01_inferido)
             + (p.parc_nn - 1) * interval '1 month')::date
         else p.mes_cru
       end) as comp_mes
    from parcela p
    left join grupos g on g.grupo_parc = p.grupo_parc
  ),
  cls as (
    -- ====== CLASSIFICAÇÃO: subtipo legível -> classe + interna ======
    -- A ORDEM dos WHEN é a PRIORIDADE (idêntica ao baseline; ver os princípios
    -- documentados lá). Primeiro derivamos o SUBTIPO; depois mapeamos
    -- subtipo -> classe efetiva + flag interna (regra automática, antes do
    -- override manual e antes do casamento de pernas).
    select
      *,
      -- ---- subtipo (rótulo legível) ----
      case
        when operation_type in ('PORTABILIDADE_SALARIO','FOLHA_PAGAMENTO') and valor_norm > 0
          then 'Salario'
        when categoria = 'Credit card payment'
          then 'Pagamento de fatura'
        -- resgate de aplicação (saída de aplicação = volta p/ conta, crédito)
        when not eh_cartao and operation_type = 'RESGATE_APLIC_FINANCEIRA'
          then 'Resgate'
        -- rendimento de aplicação CREDITADO em conta (entrada) -> renda de invest.
        when not eh_cartao and operation_type = 'RENDIMENTO_APLIC_FINANCEIRA' and valor_norm > 0
          then 'Rendimentos'
        -- rendimento de aplicação que aparece como saída (raro) -> trata como investimento
        when not eh_cartao and operation_type = 'RENDIMENTO_APLIC_FINANCEIRA'
          then 'Investimento'
        -- investimento / renda fixa / cofrinho (cofrinho vem como Investments)
        when not eh_cartao and categoria in ('Investments','Fixed income')
          then (case when valor_norm > 0 then 'Resgate' else 'Investimento' end)
        -- aporte/compra de ativo (SAÍDA) rotulado como renda var./provento
        when not eh_cartao and valor_norm < 0 and categoria in ('Proceeds interests and dividends','Variable income')
          then 'Investimento'
        -- resgate de cofrinho/carteira rotulado como provento (ENTRADA) -> Resgate
        when not eh_cartao and categoria in ('Proceeds interests and dividends','Variable income')
             and (lower(coalesce(descricao,'')) like '%cofrinho%' or lower(coalesce(descricao,'')) like '%resgate na carteira%')
          then 'Resgate'
        -- provento/dividendo/juro RECEBIDO (entrada real) -> renda de investimento
        when not eh_cartao and categoria in ('Proceeds interests and dividends','Variable income')
          then 'Rendimentos'
        -- transferência entre contas próprias (mesma pessoa)
        when not eh_cartao and categoria = 'Same person transfer'
          then 'Entre contas proprias'
        -- transferência genérica / PIX-TED-boleto de transferência (só conta)
        when not eh_cartao and categoria in ('Transfers','Transfer - PIX','Transfer - TED','Transfer - Bank Slip')
          then 'Transferencia'
        else null   -- consumo / entrada comum: sem subtipo especial
      end as subtipo_out,
      -- categoria REAL do Pluggy (alimenta o classificador) — vai p/ categoria_auto
      nullif(categoria, '') as categoria_pluggy
    from comp
  ),
  ruleset as (
    -- ---- classe + interna AUTOMÁTICAS a partir do subtipo ----
    -- (a reclassificação de Transferência genérica sem perna casada acontece
    --  DEPOIS, no passo de par_hash, quando já sabemos se houve casamento.)
    select
      *,
      case subtipo_out
        when 'Salario'               then 'Receita'
        when 'Pagamento de fatura'   then 'Transferencia/Pagamento'
        when 'Resgate'               then 'Transferencia/Pagamento'
        when 'Investimento'          then 'Aporte'                 -- aporte (saída)
        when 'Rendimentos'           then 'Receita Investimento'   -- renda de invest. (entrada)
        when 'Entre contas proprias' then 'Transferencia/Pagamento'
        when 'Transferencia'         then 'Transferencia/Pagamento'
        else
          case
            when valor_norm < 0 then 'Gasto'
            when eh_cartao      then 'Estorno/Credito'
            else 'Receita'
          end
      end as classe_auto,
      -- interna automática (movimento entre contas próprias)
      (subtipo_out in ('Pagamento de fatura','Resgate','Investimento','Entre contas proprias')) as interna_auto,
      -- candidato a ser uma PERNA de transferência casável (p/ par_hash):
      -- pagamento de fatura, entre contas próprias, aporte/resgate e transf. genérica
      (subtipo_out in ('Pagamento de fatura','Resgate','Investimento','Entre contas proprias','Transferencia')) as eh_perna
    from cls
  ),
  pernas as (
    -- ====== CASAMENTO DE PERNAS (par_hash) ======
    -- Casa a perna de DÉBITO (valor_norm<0) com a de CRÉDITO (valor_norm>0) do
    -- MESMO usuário, mesmo |valor| (arredondado a 2 casas), contas diferentes e
    -- dentro de uma janela de ~3 dias. Cada débito casa com NO MÁXIMO um crédito
    -- (o mais próximo no tempo) e vice-versa, escolhido de forma DETERMINÍSTICA.
    --
    -- Implementação: gera todos os pares candidatos (débito x crédito), ranqueia
    -- por proximidade temporal e desempata por tx_id; depois mantém só o 1º par
    -- por débito e por crédito (greedy estável).
    -- distância temporal em SEGUNDOS (abs sobre interval não existe no Postgres;
    -- usamos extract(epoch ...) que devolve numeric).
    select
      d.tx_id  as deb_tx,
      c.tx_id  as cre_tx,
      abs(extract(epoch from (d.dt_br - c.dt_br)))        as dist,
      row_number() over (
        partition by d.tx_id
        order by abs(extract(epoch from (d.dt_br - c.dt_br))), c.tx_id
      ) as rn_deb,
      row_number() over (
        partition by c.tx_id
        order by abs(extract(epoch from (d.dt_br - c.dt_br))), d.tx_id
      ) as rn_cre
    from ruleset d
    join ruleset c
      on c.eh_perna
     and c.valor_norm > 0
     and c.account_id <> d.account_id
     and round(abs(c.valor_norm), 2) = round(abs(d.valor_norm), 2)
     and round(abs(c.valor_norm), 2) > 0
     and c.dt_br between d.dt_br - interval '3 days' and d.dt_br + interval '3 days'
    where d.eh_perna
      and d.valor_norm < 0
  ),
  pares as (
    -- mantém só o par escolhido (1º por débito e por crédito) e gera a par_hash
    -- determinística (ordenada pelos dois tx_id) compartilhada pelas duas pernas
    select deb_tx, cre_tx,
           'par:' || least(deb_tx, cre_tx) || '|' || greatest(deb_tx, cre_tx) as ph
    from pernas
    where rn_deb = 1 and rn_cre = 1
  ),
  par_map as (
    -- mapa tx_id -> par_hash (uma linha por perna casada)
    select deb_tx as tx_id, ph from pares
    union all
    select cre_tx as tx_id, ph from pares
  ),
  final as (
    -- aplica par_hash e a RECLASSIFICAÇÃO da transferência genérica:
    --   * 'Transferencia' (P60) SEM perna própria casada -> não é interna;
    --     vira Receita (entrada) ou Gasto (saída) conforme o sinal.
    --   * 'Transferencia' COM perna casada -> permanece neutra e interna=true.
    select
      r.*,
      pm.ph as par_hash_out,
      -- subtipo final (libera o rótulo de transferência reclassificada)
      (case
         when r.subtipo_out = 'Transferencia' and pm.ph is null then null
         else r.subtipo_out
       end) as subtipo_final,
      -- classe automática final
      (case
         when r.subtipo_out = 'Transferencia' and pm.ph is null
           then (case when r.valor_norm < 0 then 'Gasto' else 'Receita' end)
         else r.classe_auto
       end) as classe_auto_final,
      -- interna automática final
      (case
         when r.subtipo_out = 'Transferencia'
           then (pm.ph is not null)           -- só interna se casou perna própria
         else r.interna_auto
       end) as interna_auto_final
    from ruleset r
    left join par_map pm on pm.tx_id = r.tx_id
  )
  insert into public.lancamentos as l (
    hash_natural, competencia, ano, mes, banco, origem, data_mov,
    descricao, detalhe, classe, categoria_auto, subtipo, interna, par_hash,
    valor, natureza,
    moeda, valor_origem, moeda_origem,
    fonte_dados, pluggy_tx_id, pluggy_account_id, pluggy_item_id, user_id
  )
  select
    'pluggy:' || n.tx_id,
    -- competência EFETIVA: rótulo "YYYY-MM (Mes/AA)" a partir de comp_mes
    to_char(n.comp_mes, 'YYYY-MM') || ' ('
      || (array['Jan','Fev','Mar','Abr','Mai','Jun',
                'Jul','Ago','Set','Out','Nov','Dez'])[extract(month from n.comp_mes)::int]
      || '/' || to_char(n.comp_mes, 'YY') || ')',
    extract(year  from n.comp_mes)::int,
    extract(month from n.comp_mes)::int,
    n.banco,
    (case when n.eh_cartao then 'Cartao ' else 'Conta ' end) || n.banco,
    to_char(n.dt_br, 'DD/MM'),                            -- data real (curva diária)
    n.descricao_eff,
    n.operation_type,
    -- classe efetiva = override manual, senão regra automática
    n.classe_auto_final,                                  -- classe (regra; override no UPDATE)
    n.categoria_pluggy,                                   -- categoria_auto = categoria REAL Pluggy
    n.subtipo_final,                                      -- subtipo legível
    n.interna_auto_final,                                 -- interna (regra; override no UPDATE)
    n.par_hash_out,                                       -- par_hash (pernas casadas)
    round(n.valor_norm, 2),
    'Pessoal',
    n.moeda_out,
    round(n.valor_origem_norm, 2),
    case when n.eh_estrangeira then n.moeda_tx end,
    'pluggy',
    n.tx_id,
    n.account_id,
    n.item_id,
    uid
  from final n
  on conflict (hash_natural) do update set
    competencia       = excluded.competencia,
    ano               = excluded.ano,
    mes               = excluded.mes,
    banco             = excluded.banco,
    origem            = excluded.origem,
    data_mov          = excluded.data_mov,
    descricao         = excluded.descricao,
    detalhe           = excluded.detalhe,
    -- classe/interna EFETIVOS = override manual, senão a regra recém-calculada
    classe            = coalesce(l.classe_manual, excluded.classe),
    categoria_auto    = excluded.categoria_auto,
    subtipo           = excluded.subtipo,
    interna           = coalesce(l.interna_manual, excluded.interna),
    par_hash          = excluded.par_hash,
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
    -- NÃO entram no UPDATE (preservam o que você editou no front):
    --   categoria_manual, classe_manual, interna_manual.

  -- nº de linhas inseridas/atualizadas (mantém a semântica do baseline)
  get diagnostics v_count = row_count;

  -- Defensivo: garante classe/interna EFETIVOS = override manual mesmo que a UI
  -- tenha gravado um _manual sem disparar re-tradução. O ON CONFLICT acima já
  -- aplica o coalesce em toda re-tradução; este passo cobre o caso-limite e é
  -- idempotente (só toca linhas onde o efetivo ainda diverge do override).
  update public.lancamentos l
  set classe  = coalesce(l.classe_manual, l.classe),
      interna = coalesce(l.interna_manual, l.interna)
  where l.user_id = uid
    and l.fonte_dados = 'pluggy'
    and ( (l.classe_manual  is not null and l.classe  is distinct from l.classe_manual)
       or (l.interna_manual is not null and l.interna is distinct from l.interna_manual) );

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


-- ============================================================================
-- BACKFILL — reaplica classificação/competência ao histórico já gravado
-- ----------------------------------------------------------------------------
-- Idempotente: pode rodar quantas vezes quiser. Roda em um bloco DO p/ iterar
-- por usuário (a função usa o user_id passado; aqui chamamos para todos os
-- usuários que têm transações cruas).
-- ============================================================================

-- (A) PLUGGY — re-traduz pela própria função, para TODOS os usuários com dados.
--     Isso recalcula competência de parcela, classe nova, subtipo, interna e
--     par_hash sobre tudo que já está gravado, respeitando overrides manuais.
do $backfill_pluggy$
declare
  r record;
  n integer;
begin
  for r in
    select distinct user_id
    from public.pluggy_transacoes_raw
    where user_id is not null
  loop
    n := public.pluggy_traduzir_lancamentos(r.user_id);
    raise notice 'backfill pluggy: user % -> % linha(s) tocadas', r.user_id, n;
  end loop;
end;
$backfill_pluggy$;


-- (B) PDF — reclassifica linhas curadas (fonte_dados <> 'pluggy') por
--     descrição/categoria, SEM inventar onde não dá. Conservador: só promove
--     classe/subtipo/interna quando o padrão é inequívoco e respeita overrides
--     manuais. NÃO mexe em competência do PDF (a curadoria do PDF já distribui
--     parcelas; mexer aqui poderia regredir dados confiáveis).
--
--     Heurísticas (todas exigem evidência forte no texto):
--       * Pagamento de fatura      -> Transferencia/Pagamento + interna
--       * Aporte / investimento    -> Aporte + interna
--       * Resgate                  -> Transferencia/Pagamento + interna + subtipo Resgate
--       * Rendimento/dividendo/juros recebido (entrada) -> Receita Investimento
--       * Transferência entre contas próprias -> Transferencia/Pagamento + interna
-- ----------------------------------------------------------------------------
with pdf as (
  select id, valor, classe, classe_manual, interna_manual,
         lower(translate(coalesce(descricao,'') || ' ' || coalesce(categoria_auto,'') || ' ' || coalesce(subtipo,''),
           'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
           'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')) as txt
  from public.lancamentos
  where coalesce(fonte_dados, 'pdf') <> 'pluggy'
),
classified as (
  select id, valor, classe_manual, interna_manual,
    case
      when txt ~ 'pagamento.*fatura|pagto.*fatura|pagamento de cartao'
        then 'Transferencia/Pagamento'
      -- aporte / aplicação / compra de ativo (SAÍDA)
      when valor < 0 and txt ~ 'aporte|aplicacao|aplicacoes|compra de cripto|compra de ativo|tesouro direto|cdb|investimento'
        then 'Aporte'
      -- resgate (ENTRADA): principal de volta
      when valor > 0 and txt ~ 'resgate|cofrinho'
        then 'Transferencia/Pagamento'
      -- rendimento / dividendo / juros recebido (ENTRADA)
      when valor > 0 and txt ~ 'rendimento|dividendo|jcp|juros sobre capital|provento'
        then 'Receita Investimento'
      -- transferência entre contas próprias
      when txt ~ 'entre contas|mesma titularidade|transferencia propria|contas proprias'
        then 'Transferencia/Pagamento'
      else null
    end as classe_nova,
    case
      when txt ~ 'pagamento.*fatura|pagto.*fatura|pagamento de cartao'
        then 'Pagamento de fatura'
      when valor < 0 and txt ~ 'aporte|aplicacao|aplicacoes|compra de cripto|compra de ativo|tesouro direto|cdb|investimento'
        then 'Investimento'
      when valor > 0 and txt ~ 'resgate|cofrinho'
        then 'Resgate'
      when valor > 0 and txt ~ 'rendimento|dividendo|jcp|juros sobre capital|provento'
        then 'Rendimentos'
      when txt ~ 'entre contas|mesma titularidade|transferencia propria|contas proprias'
        then 'Entre contas proprias'
      else null
    end as subtipo_novo
  from pdf
)
update public.lancamentos l
set classe  = coalesce(l.classe_manual, c.classe_nova),
    subtipo = c.subtipo_novo,
    interna = coalesce(l.interna_manual,
                       c.classe_nova in ('Transferencia/Pagamento','Aporte'))
from classified c
where l.id = c.id
  and c.classe_nova is not null
  -- só atualiza se mudou algo (mantém idempotência e não toca linha já correta)
  and ( l.classe  is distinct from coalesce(l.classe_manual, c.classe_nova)
     or l.subtipo is distinct from c.subtipo_novo
     or l.interna is distinct from coalesce(l.interna_manual,
                       c.classe_nova in ('Transferencia/Pagamento','Aporte')) );


-- ============================================================================
-- Conferir (opcional):
--   -- distribuição de classes/subtipos após backfill:
--   select fonte_dados, classe, subtipo, interna, count(*)
--     from public.lancamentos group by 1,2,3,4 order by 1,2,3;
--
--   -- pernas casadas (devem vir aos pares):
--   select par_hash, count(*), sum(valor)
--     from public.lancamentos where par_hash is not null
--    group by par_hash having count(*) <> 2;   -- idealmente 0 linhas
--
--   -- amostra de parcelas e suas competências:
--   select descricao, data_mov, competencia, valor
--     from public.lancamentos
--    where fonte_dados = 'pluggy' and descricao ~ '\d{1,2}\s*/\s*\d{1,2}\s*$'
--    order by descricao limit 50;
-- ============================================================================
