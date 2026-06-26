-- ============================================================================
-- 03 — Netting de pernas (interna / par_hash)
-- ----------------------------------------------------------------------------
-- Movimentos entre contas próprias (transferência interna, pagamento de fatura,
-- aporte/resgate) NÃO são gasto/receita: têm DUAS pernas opostas que devem se
-- anular. O contrato (docs/fonte-unica-lancamentos.md §3.2) liga as pernas com
-- `par_hash` e marca `interna = true`. Esta auditoria verifica que o netting
-- fecha — perna solta ou par que não soma ~zero deixa resíduo num total.
--
-- Espera-se: 0 linhas em 3.2 e 3.3 (e idealmente em 3.1) após o W1 rodar.
-- Somente SELECT. Idempotente.
-- ============================================================================

-- 3.1 — Perna SOLTA: interna = true mas SEM par_hash (não casou com a 2ª perna).
-- Uma interna sem par não foi netada contra ninguém. Se a classe a exclui dos
-- totais (Transferencia/Pagamento, Aporte), tudo bem; mas se a outra perna
-- ficou de fora de `interna`, o par está meio-marcado -> conferir caso a caso.
select
  hash_natural, fonte_dados, competencia, data_mov, origem,
  classe, subtipo, round(valor, 2) as valor, descricao
from public.lancamentos
where user_id = auth.uid()
  and interna is true
  and par_hash is null
order by competencia desc, abs(valor) desc;

-- 3.2 — par_hash com contagem de pernas != 2.
-- Uma transferência interna tem EXATAMENTE 2 pernas. par_hash com 1 perna =
-- casamento quebrado (a outra perna ficou sem o id); com 3+ = casou demais.
select
  par_hash,
  count(*)                          as pernas,
  count(distinct origem)            as contas_distintas,
  round(sum(valor), 2)              as soma_valor,
  string_agg(distinct left(competencia, 7), ', ' order by left(competencia, 7)) as competencias,
  string_agg(round(valor, 2)::text, ' + ' order by valor) as valores
from public.lancamentos
where user_id = auth.uid()
  and par_hash is not null
group by par_hash
having count(*) <> 2
order by pernas desc, par_hash;

-- 3.3 — par_hash de 2 pernas cuja SOMA não é ~zero (não nettam).
-- Duas pernas opostas devem somar ~0 (tolerância p/ arredondamento/câmbio).
-- Soma longe de zero = pernas com valores diferentes casadas por engano, ou um
-- pagamento parcial -> deixa resíduo que vaza para gasto/receita se mal-classe.
select
  par_hash,
  round(sum(valor), 2)                                   as soma_valor,
  count(*) filter (where valor < 0)                      as pernas_negativas,
  count(*) filter (where valor > 0)                      as pernas_positivas,
  string_agg(distinct classe, ', ')                      as classes,
  string_agg(distinct origem, ' | ' order by origem)     as contas,
  string_agg(round(valor, 2)::text, ' + ' order by valor) as valores
from public.lancamentos
where user_id = auth.uid()
  and par_hash is not null
group by par_hash
having count(*) = 2
   and abs(sum(valor)) > 0.05          -- tolerância de R$0,05
order by abs(sum(valor)) desc;

-- 3.4 — Pernas DESPAREADAS de marcação: linha com par_hash mas interna=false
-- (ou vice-versa). As duas flags devem andar juntas para o par.
select
  par_hash, hash_natural, interna, classe, subtipo,
  competencia, origem, round(valor, 2) as valor, descricao
from public.lancamentos
where user_id = auth.uid()
  and par_hash is not null
  and interna is distinct from true
order by par_hash;

-- 3.5 — Candidatas a par NÃO casadas: linhas internas (ou classe transfer/fatura)
-- sem par_hash que TÊM uma contraparte plausível (mesmo |valor|, sinal oposto,
-- conta diferente, até 3 dias). Mostra netting que o W1 deveria ter pego.
-- Use para dimensionar quantas pernas ainda estão soltas.
with cand as (
  select hash_natural, origem, competencia, data_mov, classe, subtipo, valor,
         abs(round(valor, 2)) as v_abs,
         -- data aproximada a partir de competencia + data_mov
         case
           when data_mov ~ '^\d{1,2}/\d{1,2}$' then
             make_date(
               left(competencia, 4)::int
                 - (case when split_part(data_mov,'/',2)::int > substring(competencia from 6 for 2)::int then 1 else 0 end),
               split_part(data_mov, '/', 2)::int,
               least(split_part(data_mov, '/', 1)::int, 28))
           else null
         end as dt_aprox
  from public.lancamentos
  where user_id = auth.uid()
    and par_hash is null
    and (interna is true
         or classe = 'Transferencia/Pagamento'
         or subtipo in ('Pagamento de fatura', 'Entre contas proprias', 'Investimento', 'Resgate'))
)
select a.hash_natural as perna_a, b.hash_natural as perna_b,
       a.origem as conta_a, b.origem as conta_b,
       round(a.valor, 2) as valor_a, round(b.valor, 2) as valor_b,
       a.dt_aprox as dt_a, b.dt_aprox as dt_b,
       a.classe as classe_a, b.classe as classe_b
from cand a
join cand b
  on b.v_abs = a.v_abs
 and sign(b.valor) = -sign(a.valor)             -- sinais opostos
 and b.origem <> a.origem                        -- contas diferentes
 and a.hash_natural < b.hash_natural             -- cada par uma vez
 and a.dt_aprox is not null and b.dt_aprox is not null
 and abs(a.dt_aprox - b.dt_aprox) <= 3           -- janela de 3 dias
order by a.v_abs desc;
