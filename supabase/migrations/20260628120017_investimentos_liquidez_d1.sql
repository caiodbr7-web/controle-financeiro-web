-- ============================================================
--  Investimentos: liquidez D+1 (override manual)
--
--  Adiciona a coluna public.pluggy_investments.liquidez_d1_manual (boolean),
--  o SEU override de "este ativo tem liquidez D+1?" (resgate com o dinheiro
--  disponível em ~1 dia útil). Quando NULL, o app usa uma heurística pelo
--  tipo/produto do ativo; marque Sim (true) ou Não (false) na tabela da aba
--  Investimentos para sobrepor.
--
--  Igual a tipo_manual, a coluna NÃO é tocada pela sincronização (o upsert da
--  Edge Function pluggy-investments não a inclui), então o seu override
--  sobrevive a cada "Sincronizar investimentos".
--
--  COMO RODAR:
--    Supabase  ->  SQL Editor  ->  New query  ->  cole TUDO  ->  Run
--  É idempotente e não apaga dados.
-- ============================================================

alter table public.pluggy_investments
  add column if not exists liquidez_d1_manual boolean;

comment on column public.pluggy_investments.liquidez_d1_manual is
  'Override do usuário: o ativo tem liquidez D+1? NULL = usar a heurística do app.';

-- ============================================================
--  Conferir (opcional):
--    select nome, tipo, liquidez_d1_manual
--    from public.pluggy_investments
--    where liquidez_d1_manual is not null;
-- ============================================================
