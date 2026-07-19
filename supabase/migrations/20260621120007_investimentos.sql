-- ============================================================
--  Investimentos (Open Finance / Pluggy)
--
--  Cria a tabela public.pluggy_investments, que guarda a POSIÇÃO atual
--  de cada investimento puxado da API da Pluggy (endpoint /investments):
--  renda fixa (CDB, LCI/LCA, Tesouro), fundos, ações, ETFs, previdência, etc.
--
--  Diferente de `lancamentos` (transações) e `pluggy_saldos` (saldo diário de
--  conta), aqui cada linha é uma posição/ativo, com o valor ATUAL (balance) e o
--  montante aplicado (amount). É o "patrimônio investido".
--
--  COMO RODAR:
--    Supabase  ->  SQL Editor  ->  New query  ->  cole TUDO  ->  Run
--
--  É seguro rodar mais de uma vez (idempotente) e não apaga dados.
-- ============================================================

create table if not exists public.pluggy_investments (
  investment_id  text primary key,          -- id da Pluggy (chave do upsert)
  user_id        uuid not null references auth.users(id) default auth.uid(),
  item_id        text,                       -- conexão Pluggy (pluggy_items.item_id)
  banco          text,                       -- connector_name (instituição)
  tipo           text,                       -- type: FIXED_INCOME, MUTUAL_FUND, EQUITY, ETF, ...
  subtipo        text,                       -- subtype
  nome           text,                       -- name
  emissor        text,                       -- issuer
  saldo          numeric,                    -- balance: VALOR ATUAL da posição
  valor_aplicado numeric,                    -- amount: montante aplicado
  lucro          numeric,                    -- amountProfit: lucro acumulado
  quantidade     numeric,                    -- quantity (cotas/papéis)
  moeda          text default 'BRL',         -- currencyCode
  vencimento     date,                       -- dueDate
  taxa           text,                       -- rate + rateType (ex.: "110 CDI")
  status         text,                       -- status na Pluggy
  raw            jsonb,                       -- payload bruto, p/ campos extras
  capturado_em   timestamptz default now(),  -- 1ª vez que vimos esta posição
  atualizado_em  timestamptz default now()   -- última sincronização
);

-- índices úteis para a UI (filtra/ordena por dono, instituição e tipo)
create index if not exists pluggy_investments_user_idx on public.pluggy_investments (user_id);
create index if not exists pluggy_investments_item_idx on public.pluggy_investments (item_id);
create index if not exists pluggy_investments_tipo_idx on public.pluggy_investments (tipo);

-- isolamento por usuário (mesmo padrão das outras tabelas)
alter table public.pluggy_investments enable row level security;

drop policy if exists "proprios dados" on public.pluggy_investments;
create policy "proprios dados" on public.pluggy_investments
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ============================================================
--  Conferir (opcional): rode depois de uma sincronização
--    select tipo, count(*), sum(saldo) as total
--    from public.pluggy_investments
--    group by tipo order by total desc;
-- ============================================================
