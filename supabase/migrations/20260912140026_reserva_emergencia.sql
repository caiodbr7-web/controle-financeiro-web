-- ============================================================
--  Reserva de emergência (sub-aba "Balanceamento")
--
--  Dois parâmetros que só o usuário sabe:
--
--    gasto_mensal — quanto custaria o mês NUMA EMERGÊNCIA, que não é
--                   o gasto médio das abas Diário/Mensal: numa
--                   emergência se corta viagem, lazer e afins, então
--                   esse numero é menor e o app não tem como deduzi-lo.
--    meses        — quantos meses de cobertura se quer.
--
--  O alvo da reserva é gasto_mensal × meses. O quanto já existe segue
--  derivado da liquidez D+1 (caixa + investimentos resgatáveis em ~1
--  dia útil) — nada disso é duplicado aqui.
--
--  Uma linha por usuário. Aplicada automaticamente pelo workflow de
--  migrações no merge para main. Idempotente.
-- ============================================================

create table if not exists public.reserva_emergencia (
  user_id       uuid primary key references auth.users(id) default auth.uid(),
  gasto_mensal  numeric(14,2) not null default 0,
  meses         int           not null default 6,
  atualizado_em timestamptz   not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'reserva_emergencia_chk'
  ) then
    alter table public.reserva_emergencia
      add constraint reserva_emergencia_chk
      check (gasto_mensal >= 0 and meses >= 0 and meses <= 120);
  end if;
end $$;

alter table public.reserva_emergencia enable row level security;

drop policy if exists "proprios dados" on public.reserva_emergencia;
create policy "proprios dados" on public.reserva_emergencia
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ============================================================
--  Pronto. Sem linha, a sub-aba abre com a reserva desligada e
--  um convite para definir o gasto de emergência e os meses.
-- ============================================================
