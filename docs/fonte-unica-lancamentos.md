# Fonte única de gasto/receita — contrato de centralização

> **Objetivo:** garantir que **todos** os dashboards de "gastos e receitas" leiam de
> **um único lugar** — a tabela `lancamentos` —, onde cada linha é um gasto/receita
> classificado, com a **competência efetiva**, sem dupla contagem, com parcelas no
> mês em que caem, com transferências entre contas próprias marcadas, e com
> investimentos e rendimentos com natureza própria (apartados de gasto/receita).
>
> Este documento é o **contrato** que todas as frentes (W0–W5) obedecem. Mexeu em
> regra de classificação/competência/dashboard? Atualize aqui primeiro.

---

## 1. Estado atual (o que já existe)

- **`lancamentos` já é a fonte única.** Todo dashboard de gasto/receita lê dela via
  o hook `src/hooks/useLancamentos.ts`.
- **Dedup PDF × Open Finance:** o hook aplica um **corte por competência**
  (`CORTE_OPEN_BANKING = "2026-06"`): antes do corte → PDF curado; do corte até o
  mês atual → Pluggy; futuro → oculto. Dentro de cada fonte, dedup por
  `hash_natural` (`pluggy:<txId>` no Open Finance; hash determinístico no import).
- **Tradução Pluggy → `lancamentos`:** função SQL `public.pluggy_traduzir_lancamentos`
  (única escritora das linhas Pluggy). Hoje ela:
  - **Competência = mês de `dt_br`** (data da transação em horário de São Paulo).
    **Não** deriva da parcela → bancos que colapsam parcelas no mês da compra
    jogam todas no mesmo mês (bug do requisito #2).
  - **Classifica `classe`** por uma cascata de prioridades (ver §5). Já distingue
    salário, pagamento de fatura, aporte, resgate, rendimento e transferência entre
    contas próprias — mas amontoa investimento/transferência em
    `Transferencia/Pagamento` e rendimento em `Receita` genérica.
  - Calcula um **`subtipo` legível** (`'Pagamento de fatura'`, `'Entre contas
    proprias'`, `'Investimento'`, `'Rendimentos'`, `'Cofrinho'`, `'Resgate'`,
    `'Salario'`) que hoje é gravado em `categoria_auto`.
  - **Preserva `categoria_manual`** no `ON CONFLICT` (re-sync não desfaz sua
    classificação de categoria).
- **Silos legítimos (não mexer):** `pluggy_saldos` (aba Saldo) e
  `pluggy_investments` (aba Investimentos = patrimônio). Não são gasto/receita.

### Divergência de eixo (a corrigir)
Hoje **Início** e **Planejamento** agregam por `competencia`; **Visão Geral**,
**Resumo Mensal** e **Evolução Diária** agregam pela **data real** (`mesReal`).
Mesma fonte, recortes de mês diferentes → o requisito "competência efetiva" pede
unificar tudo em `competencia`.

---

## 2. Decisões travadas

| # | Decisão | Escolha |
|---|---------|---------|
| 1 | Regras SQL | **Recuperar e versionar** a função atual, e estender a partir dela. |
| 2 | Eixo do mês | **Tudo por `competencia`.** Data real só para a curva diária dentro do mês; parcelas/compras de **meses anteriores** entram no **dia 1** da competência — o "platô" já comprometido (`ehParcelaAnterior`/`diaNaComp` em `src/lib/finance.ts`). |
| 3 | Modelo de dados | **Novas classes + flags de ligação** (colunas em `lancamentos`). |
| 4 | Detecção | **Automático** (categoria Pluggy + casamento de pernas) **+ correção manual** na aba Lançamentos. |

---

## 3. Modelo-alvo (o contrato)

### 3.1 Taxonomia de `classe`
A dimensão que os dashboards filtram. Valores canônicos (ver `src/lib/lancClasses.ts`):

| `classe` | Significado | Entra em gasto? | Entra em receita? |
|----------|-------------|-----------------|-------------------|
| `Gasto` | Consumo real | **Sim** (positivo) | — |
| `Estorno/Credito` | Estorno de gasto | **Sim** (subtrai) | — |
| `Receita` | Renda real (salário, etc.) | — | **Sim** |
| `Aporte` | Dinheiro investido (saída p/ investimento) | **Não** | **Não** |
| `Receita Investimento` | Rendimento/dividendo/juro recebido em conta | **Não** | **Não** (vai numa métrica própria) |
| `Transferencia/Pagamento` | Movimento neutro (transf. interna, fatura, resgate) | **Não** | **Não** |

### 3.2 Colunas novas em `lancamentos`
| Coluna | Tipo | Quem escreve | Para quê |
|--------|------|--------------|----------|
| `interna` | `boolean` (default `false`) | função/import (efetivo) | **Movimento entre contas próprias** (transf. interna, pagamento de fatura, aporte/resgate). Dashboards de gasto/receita **sempre** excluem `interna = true`. |
| `par_hash` | `text` | função (W1) | Liga as **duas pernas** casadas de uma transferência (mesma id nas duas linhas) → netting e verificação. |
| `subtipo` | `text` | função (W1) | Rótulo legível (`Pagamento de fatura`, `Entre contas proprias`, `Aporte`, `Resgate`, `Rendimentos`, `Salario`…). Sai de `categoria_auto`. |
| `classe_manual` | `text` | UI (W4) | Override do usuário p/ `classe`. A re-tradução **respeita**. |
| `interna_manual` | `boolean` | UI (W4) | Override do usuário p/ `interna`. A re-tradução **respeita**. |

**Regra de override:** o valor *efetivo* gravado em `classe`/`interna` é
`coalesce(<manual>, <regra automática>)`. A UI escreve nos `_manual`; a função
recomputa o efetivo honrando-os (igual já se faz com `categoria_manual`).

### 3.3 Competência efetiva
- **Linha de cartão com sufixo de parcela `NN/MM`** na descrição:
  `competencia(NN) = competência da parcela 01 + (NN − 1) meses`, derivada do
  índice — **não** do `data_mov`. Conserta o regime colapsado **sem** estragar o
  regime já-espalhado (ver §5).
- **Demais linhas:** `competencia = mês de `dt_br`` (comportamento atual).

### 3.4 Contrato dos dashboards
Toda agregação mensal usa os predicados de `src/lib/lancClasses.ts` e o eixo
`competencia`:

| Métrica | Definição |
|---------|-----------|
| Gasto do mês | `Σ valorGasto(d)` = `Gasto` (+) menos `Estorno/Credito` (−), excluindo `interna` e `Aporte` |
| Receita do mês | `Σ` `classe=Receita` e `!interna` |
| Investido no mês | `Σ` `classe=Aporte` |
| Renda de investimentos | `Σ` `classe=Receita Investimento` |
| Transferências internas | `interna=true` → **nunca** em gasto/receita; só em visões de fluxo/saldo |
| Eixo do mês | `competencia` (decisão 2) |

---

## 4. Os 5 requisitos → onde são atendidos

1. **Sem dupla contagem** → corte PDF×Pluggy (auditado em **W2**) + dedup
   `hash_natural` + **netting de pernas** (`par_hash`, **W1**).
2. **Parcela na competência que cai** → competência por índice de parcela (**W1**),
   eixo `competencia` em todos os dashboards (**W3**).
3. **Marcar transferência interna / fatura** → `interna` + `subtipo` + `par_hash`
   (**W1**), correção manual (**W4**).
4. **Investimento com natureza própria** → classe `Aporte` (**W1**), apartado de
   gasto nos dashboards (**W3**), visão/edição (**W4**).
5. **Rendimento/dividendo = receita investimento** → classe `Receita Investimento`
   (**W1**), métrica própria (**W3**).

---

## 5. Especificação do W1 (backend SQL)

Partindo da função atual `pluggy_traduzir_lancamentos` (já versionada na migration
do W1), aplicar:

### 5.1 Cascata de classificação atual (referência)
Ordem = prioridade. Hoje produz `classe` + `subtipo`:

| Prioridade | Condição | `classe` hoje | `subtipo` |
|-----------|----------|---------------|-----------|
| P05 | `op ∈ (PORTABILIDADE_SALARIO, FOLHA_PAGAMENTO)` e valor>0 | `Receita` | `Salario` |
| P10 | `categoria='Credit card payment'` | `Transferencia/Pagamento` | `Pagamento de fatura` |
| P20 | conta + `op ∈ (RESGATE/RENDIMENTO_APLIC_FINANCEIRA)` | `Transferencia/Pagamento` | `Investimento` |
| P30 | conta + `categoria ∈ (Investments, Fixed income)` | `Transferencia/Pagamento` | `Investimento` |
| P40a | conta + valor<0 + `categoria ∈ (Proceeds…, Variable income)` | `Transferencia/Pagamento` | `Investimento` |
| P40b | conta + idem + descrição cofrinho/resgate | `Transferencia/Pagamento` | `Cofrinho` |
| P40c | conta + `categoria ∈ (Proceeds…, Variable income)` (entrada) | `Receita` | `Rendimentos` |
| P50 | conta + `categoria='Same person transfer'` | `Transferencia/Pagamento` | `Entre contas proprias` |
| P60 | conta + `categoria ∈ (Transfers, Transfer-PIX/TED/Bank Slip)` | `Transferencia/Pagamento` | `Transferencia` |
| fb | valor<0 → `Gasto`; cartão → `Estorno/Credito`; senão `Receita` | | categoria Pluggy |

### 5.2 Mudanças
- **Promover classes (req. 4 e 5):**
  - `subtipo='Investimento'` **na saída** (aporte: valor<0) → `classe='Aporte'`, `interna=true`.
  - `subtipo ∈ ('Investimento','Cofrinho')` **na entrada** (resgate: valor>0) →
    manter `Transferencia/Pagamento`, `interna=true`, `subtipo='Resgate'` (é
    principal de volta, **não** é receita).
  - `subtipo='Rendimentos'` (P40c) **e** rendimento de aplicação recebido em conta
    (parte do P20 `RENDIMENTO_APLIC_FINANCEIRA` que é **crédito** em conta) →
    `classe='Receita Investimento'`.
- **Marcar `interna` (req. 3):** `true` para `Pagamento de fatura` (P10),
  `Entre contas proprias` (P50), aporte/resgate entre contas próprias, e P60
  **somente** quando casado a uma perna própria (ver `par_hash`).
- **`par_hash` (req. 1 e 3):** casar pernas opostas do mesmo usuário — `abs(valor)`
  igual, sinais opostos, contas diferentes, janela de data curta (~3 dias).
  Atribuir a mesma `par_hash` às duas linhas. **Pega o pagamento de fatura**
  (débito na conta ↔ crédito no cartão) e **distingue transferência genérica
  externa** (ex.: restituição da Receita Federal — P60 sem perna casada → **não**
  é interna; reclassificar para `Receita`).
- **Competência de parcela (req. 2):** detectar `NN/MM` no fim da descrição
  (exigir `eh_cartao` e `MM` plausível p/ evitar falso-positivo de data). Âncora =
  competência da parcela `01` do grupo (mesmo cartão + estabelecimento normalizado
  + total `MM` + valor aproximado); se ausente, inferir por
  `mês(dt_br) − (NN−1)` e usar o mínimo do grupo. `competencia(NN) = âncora + (NN−1)`.
- **Overrides:** efetivo = `coalesce(classe_manual, regra)` /
  `coalesce(interna_manual, regra)`; **não** sobrescrever os `_manual` no `ON CONFLICT`.
- **`subtipo`** passa a ir na coluna `subtipo` (libera `categoria_auto` para a
  categoria Pluggy real, que alimenta o classificador).
- **Backfill:** migration idempotente que reaplica a classificação ao histórico já
  gravado (Pluggy e, na medida do possível, PDF por descrição/categoria).

---

## 6. Frentes e donos de arquivo (paralelização)

```
            ┌─ W1 (SQL/backend)
W0  ──────► ├─ W2 (auditoria dedup)  ──► W5 (integração)
(contrato)  ├─ W3 (dashboards)
            └─ W4 (UI lançamentos)
```

| Frente | Donos de arquivo | Depende de |
|--------|------------------|------------|
| **W0** contrato & schema | `docs/fonte-unica-lancamentos.md`, `src/lib/lancClasses.ts`, `src/types.ts`, `db/migrations/2026-06-26-fonte-unica-lancamentos-schema.sql` | — |
| **W1** backend SQL & backfill | `db/migrations/*` (função + backfill), `supabase/functions/*` | W0 |
| **W2** dedup & integridade | `db/verificacao/*`, ajuste pontual em `src/hooks/useLancamentos.ts` | W0 |
| **W3** dashboards & finance | `src/lib/finance.ts`, `src/components/tabs/{Inicio,VisaoGeral,ResumoMensal,EvolucaoDiaria,Planejamento}.tsx` | W0 |
| **W4** UI lançamentos | `src/components/tabs/{Lancamentos,Classificar,Adicionar}.tsx`, `src/components/Modal.tsx` | W0 (schema) |
| **W5** integração & verificação | aplica migrations + redeploy; valida reconciliação | W1–W4 |

**Regra anti-conflito:** cada frente só edita seus arquivos. O contrato em código
(`src/lib/lancClasses.ts`) é **só leitura** para W3/W4 — qualquer mudança nele passa
pelo W0/este doc. W3 refatora `finance.ts` para **delegar** aos predicados de
`lancClasses.ts` (fonte única em código).

---

## 7. Execução no Supabase (importante)
As migrations SQL e as Edge Functions são aplicadas **manualmente** pelo dono do
projeto no Supabase (idempotentes). As frentes produzem o código; o "play" final no
banco (rodar SQL + redeploy das functions + re-sync) é do dono.
