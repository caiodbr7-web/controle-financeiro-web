-- ============================================================
--  Subcategoria nos LANÇAMENTOS
--
--  Permite classificar cada transação também por subcategoria
--  (opcional). O par (categoria_manual, subcategoria_manual)
--  identifica a classificação: a subcategoria guarda apenas o
--  NOME da sub, sempre subordinada à categoria_manual vigente.
--
--  Aplicada automaticamente pelo workflow de migrações no merge
--  para main. Idempotente (seguro rodar mais de uma vez).
-- ============================================================

alter table public.lancamentos
  add column if not exists subcategoria_manual text;

-- consultas por categoria+sub (contagens da aba Categorias)
create index if not exists lancamentos_subcat_idx
  on public.lancamentos (categoria_manual, subcategoria_manual)
  where subcategoria_manual is not null;
