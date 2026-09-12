-- ============================================================
--  Alocação-alvo da carteira (sub-aba "Balanceamento")
--
--  Guarda, por usuário, o percentual ALVO de cada classe de
--  investimento. A classe é a mesma chave já usada em
--  pluggy_investments.tipo_manual (FIXED_INCOME, ETF_US, ...),
--  mais a pseudo-classe 'CAIXA' — o saldo em conta entra no
--  balanceamento como uma classe normal, dentro dos 100%.
--
--  Só o ALVO mora aqui. A posição de hoje e o % atual continuam
--  sendo calculados a partir de pluggy_investments + saldos das
--  contas; nada é duplicado.
--
--  Aplicada automaticamente pelo workflow de migrações no merge
--  para main. Idempotente (seguro rodar mais de uma vez).
-- ============================================================

create table if not exists public.alocacao_alvo (
  user_id       uuid not null references auth.users(id) default auth.uid(),
  tipo          text not null,
  alvo_pct      numeric(6,2) not null default 0,
  atualizado_em timestamptz not null default now(),
  primary key (user_id, tipo)
);

-- um alvo é uma fatia de 100%: nunca negativo, nunca acima de 100
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'alocacao_alvo_pct_chk'
  ) then
    alter table public.alocacao_alvo
      add constraint alocacao_alvo_pct_chk check (alvo_pct >= 0 and alvo_pct <= 100);
  end if;
end $$;

create index if not exists alocacao_alvo_user_idx
  on public.alocacao_alvo (user_id);

alter table public.alocacao_alvo enable row level security;

drop policy if exists "proprios dados" on public.alocacao_alvo;
create policy "proprios dados" on public.alocacao_alvo
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ============================================================
--  Pronto. A tabela nasce vazia: sem alvo definido, a sub-aba
--  "Balanceamento" abre oferecendo a composição atual como
--  ponto de partida.
-- ============================================================
