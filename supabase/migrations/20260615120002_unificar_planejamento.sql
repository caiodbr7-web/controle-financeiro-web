-- ============================================================
--  Unificação: Orçamento + Planejamento num módulo só.
--
--  A tabela `planos` passa a ser a FONTE ÚNICA de itens (gastos fixos,
--  parcelamentos, pagamentos, metas e receitas). A nova `plano_mensal`
--  guarda o realizado/pago de cada item por mês (o que antes ficava em
--  orcamento_mensal).
--
--  Esta migração traz seus dados de orçamento para o novo modelo:
--    - cada item do Orçamento vira um "gasto fixo" em planos
--    - cada valor real/pago vira uma linha em plano_mensal
--
--  COMO RODAR:
--    Supabase -> SQL Editor -> New query -> cole TUDO -> Run
--
--  É segura: idempotente (pode rodar de novo) e NÃO apaga as tabelas
--  antigas (orcamento_itens / orcamento_mensal ficam como backup).
-- ============================================================

-- 1) planos ganha o vínculo a lançamentos reais + a origem (p/ idempotência)
alter table public.planos add column if not exists link_categoria text;
alter table public.planos add column if not exists link_texto text;
alter table public.planos add column if not exists origem_orcamento_item bigint;

-- 2) realizado por item/mês, chaveado em planos
create table if not exists public.plano_mensal (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) default auth.uid(),
  plano_id    bigint not null references public.planos(id) on delete cascade,
  competencia text not null,            -- 'AAAA-MM'
  valor_real  numeric,
  pago        boolean not null default false,
  unique (plano_id, competencia)
);
create index if not exists plano_mensal_user_idx on public.plano_mensal (user_id);

alter table public.plano_mensal enable row level security;
drop policy if exists "proprios dados" on public.plano_mensal;
create policy "proprios dados" on public.plano_mensal
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 3) migra orcamento_itens -> planos (tipo 'fixo'), preservando vínculos.
--    mes_inicio '2020-01' = recorrente "desde sempre" (vale para qualquer mês);
--    mes_fim null = sem fim definido.
do $$
begin
  if to_regclass('public.orcamento_itens') is not null then
    insert into public.planos
      (user_id, tipo, nome, categoria, valor, mes_inicio, mes_fim, parcelas,
       ativo, ordem, link_categoria, link_texto, origem_orcamento_item)
    select oi.user_id, 'fixo', oi.nome, oi.categoria, coalesce(oi.valor_previsto, 0),
           '2020-01', null, null, coalesce(oi.ativo, true), coalesce(oi.ordem, 0),
           oi.link_categoria, oi.link_texto, oi.id
    from public.orcamento_itens oi
    where not exists (
      select 1 from public.planos p where p.origem_orcamento_item = oi.id
    );
  end if;
end $$;

-- 4) migra orcamento_mensal -> plano_mensal (via o mapeamento de origem)
do $$
begin
  if to_regclass('public.orcamento_mensal') is not null then
    insert into public.plano_mensal (user_id, plano_id, competencia, valor_real, pago)
    select om.user_id, p.id, om.competencia, om.valor_real, coalesce(om.pago, false)
    from public.orcamento_mensal om
    join public.planos p on p.origem_orcamento_item = om.item_id
    where not exists (
      select 1 from public.plano_mensal pm
      where pm.plano_id = p.id and pm.competencia = om.competencia
    );
  end if;
end $$;

-- ============================================================
--  Pronto. A aba "Planejamento" agora reúne as duas visões:
--    - "Mês":      previsto × realizado (pago), como era o Orçamento
--    - "Projeção": os próximos meses (gastos, receita, saldo)
--
--  Tudo a partir da MESMA lista de itens — sem digitação duplicada.
--  Quando se sentir seguro, pode apagar orcamento_itens/orcamento_mensal.
-- ============================================================
