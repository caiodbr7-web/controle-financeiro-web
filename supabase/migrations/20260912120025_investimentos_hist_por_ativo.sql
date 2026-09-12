-- ============================================================
--  Investimentos: histórico diário do patrimônio POR ATIVO
--
--  Cria public.pluggy_investments_hist_ativo: um retrato DIÁRIO de CADA
--  posição, para a tabela "Evolução mensal por categoria" poder expandir
--  uma categoria e mostrar a evolução dos ativos dentro dela.
--
--  Por quê: pluggy_investments_hist guarda o TOTAL por dia e
--  pluggy_investments_hist_tipo guarda a quebra POR CATEGORIA. Nenhuma das
--  duas desce ao nível do ativo — pluggy_investments tem os ativos, mas só a
--  posição ATUAL, sem série temporal. Esta tabela é o nível que faltava.
--
--  `ativo_id` é a chave estável da posição:
--    - Pluggy / IBKR / manual -> o próprio investment_id;
--    - import da B3           -> "b3:<tipo>:<nome normalizado>", já que os
--      relatórios da B3 não trazem id, só o nome do produto.
--  `nome` e `tipo` são desnormalizados de propósito: o retrato tem que
--  preservar como o ativo se chamava e em que categoria ele estava NAQUELE
--  dia, mesmo que depois seja renomeado, reclassificado ou encerrado.
--
--  Aplicada automaticamente pelo workflow de migrações no merge para main.
--  Idempotente (seguro rodar mais de uma vez).
-- ============================================================

create table if not exists public.pluggy_investments_hist_ativo (
  user_id        uuid not null references auth.users(id) default auth.uid(),
  dia            date not null,          -- "YYYY-MM-DD" (snapshot do dia)
  ativo_id       text not null,          -- investment_id, ou "b3:<tipo>:<slug>"
  tipo           text not null,          -- categoria efetiva NAQUELE dia
  nome           text,                   -- rótulo do ativo NAQUELE dia
  valor_total    numeric,                -- saldo da posição no dia
  valor_aplicado numeric,                -- montante aplicado no dia
  atualizado_em  timestamptz default now(),
  primary key (user_id, dia, ativo_id)
);

-- leitura da tela: histórico inteiro do usuário ordenado por dia
create index if not exists pluggy_investments_hist_ativo_user_idx
  on public.pluggy_investments_hist_ativo (user_id, dia);

-- expandir UMA categoria sem varrer o resto
create index if not exists pluggy_investments_hist_ativo_tipo_idx
  on public.pluggy_investments_hist_ativo (user_id, tipo, dia);

-- isolamento por usuário (mesmo padrão das outras tabelas)
alter table public.pluggy_investments_hist_ativo enable row level security;

drop policy if exists "proprios dados" on public.pluggy_investments_hist_ativo;
create policy "proprios dados" on public.pluggy_investments_hist_ativo
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ============================================================
--  Conferir (opcional): rode depois de uma sincronização
--    select dia, tipo, nome, valor_total
--    from public.pluggy_investments_hist_ativo
--    order by dia desc, valor_total desc;
-- ============================================================
