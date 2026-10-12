-- ============================================================
--  Planejamento: dados de pagamento, lembrete e observações
--
--  A nova página de Planejamento (calendário + planilha + despesas)
--  precisa saber, para cada despesa programada:
--    • para quem pagar (favorecido) e em que dia vence;
--    • como pagar (forma) e os dados (chave Pix, código do boleto…);
--    • com quantos dias de antecedência lembrar;
--    • observações livres sobre a despesa;
--    • se o valor varia mês a mês (conta de luz, água…) — o previsto
--      vira uma estimativa.
--  E, por mês (plano_mensal), uma nota sobre aquele pagamento
--  ("boleto atrasou", "pago com desconto"…).
--
--  Só ADICIONA colunas (todas opcionais): não apaga nem altera dado
--  existente. Idempotente — pode rodar mais de uma vez.
-- ============================================================

alter table public.planos add column if not exists favorecido      text;
alter table public.planos add column if not exists dia_venc        smallint;
alter table public.planos add column if not exists forma_pagamento text;
alter table public.planos add column if not exists dados_pagamento text;
alter table public.planos add column if not exists lembrar_dias    smallint;
alter table public.planos add column if not exists observacoes     text;
alter table public.planos add column if not exists variavel        boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'planos_dia_venc_chk'
  ) then
    alter table public.planos
      add constraint planos_dia_venc_chk check (dia_venc is null or dia_venc between 1 and 31);
  end if;
end $$;

alter table public.plano_mensal add column if not exists nota text;
