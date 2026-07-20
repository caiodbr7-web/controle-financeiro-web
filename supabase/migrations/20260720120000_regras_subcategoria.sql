-- ============================================================
--  Subcategoria nas REGRAS de auto-classificação
--
--  A partir de agora a classificação aponta para a FOLHA da
--  hierarquia: a subcategoria quando a categoria tem subs, ou a
--  própria categoria quando não tem nenhuma. As regras aprendidas
--  passam a guardar também a subcategoria, para pré-preencher o
--  par (categoria › subcategoria) nas próximas vezes.
--
--  Aplicada automaticamente no merge para main. Idempotente.
-- ============================================================

alter table public.regras
  add column if not exists subcategoria text;
