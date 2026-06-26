# Reconciliação & não-dupla-contagem (frente W2)

> Auditoria de integridade da fonte única `lancamentos`: garante que gasto/receita
> não sejam contados em dobro entre **PDF** e **Open Finance (Pluggy)**, que o
> **netting** de transferências internas feche, e que o **corte por competência**
> não crie buracos. Companheiro de `docs/fonte-unica-lancamentos.md` (o contrato).
>
> As queries de conferência ficam em `db/verificacao/*.sql` (só SELECT,
> idempotentes, para o SQL Editor do Supabase). Este doc explica o mecanismo, os
> riscos conhecidos e o checklist que o dono roda após aplicar o W1.

---

## 1. Como o dedup funciona hoje

Três camadas independentes evitam a dupla contagem:

1. **Dedup por `hash_natural` (dentro de cada fonte).**
   - Pluggy: `hash_natural = 'pluggy:' || tx_id`. A função
     `public.pluggy_traduzir_lancamentos` insere com `ON CONFLICT (hash_natural)
     DO UPDATE`, então re-sync nunca duplica.
   - Import de arquivo: hash determinístico `imp_...` em `src/lib/import.ts`
     (`banco|origem|YYYY-MM-DD|valor|descrição` normalizados). `importarRows`
     filtra contra os hashes já existentes antes de inserir.
   - **Risco residual:** o hash do import inclui `data_mov` e `valor` — uma compra
     com data ou valor levemente diferente entre dois extratos gera dois hashes →
     não é colisão, é duplicata legítima escapando do dedup. Coberto por
     `01-hash-duplicatas.sql` (1.1/1.2) e por `02` (mesma transação nas duas fontes).

2. **Corte PDF × Pluggy por competência (entre fontes).** No hook
   `src/hooks/useLancamentos.ts`, `lancVisivel()`:
   - competência `< CORTE_OPEN_BANKING ('2026-06')` → **PDF**;
   - `CORTE <= competência <= mês atual` → **Pluggy**;
   - competência `> mês atual` → **oculto** (faturas futuras adiantadas pelo Pluggy);
   - competência inválida → **oculto** (guarda adicionada pelo W2, ver §5).

   As duas fontes cobrem meses sobrepostos; o corte garante que **cada
   competência venha de uma fonte só**. As abas **Conciliação** e **Open Banking**
   NÃO usam o hook (têm query própria) e por isso continuam vendo as duas fontes —
   é lá que se valida o casamento.

3. **Netting de pernas internas (`interna` + `par_hash`), W1.** Transferência
   entre contas próprias, pagamento de fatura e aporte/resgate têm **duas pernas
   opostas**. A função do W1 marca `interna = true` e liga as pernas com o mesmo
   `par_hash`. Os dashboards **sempre excluem `interna = true`** (ver
   `src/lib/lancClasses.ts`), então as duas pernas saem do gasto/receita e o saldo
   não é afetado. Coberto por `03-netting-pernas.sql`.

---

## 2. O furo central: o corte é por competência, mas a dupla contagem é por mês real

O corte usa **`competencia`** (string `'YYYY-MM ...'`). O problema é que
**competência não é o mesmo eixo nas duas fontes**:

| Fonte | O que `competencia` significa |
|-------|-------------------------------|
| PDF de **cartão** | mês da **fatura** (uma compra de mai cai na fatura de jun → competência `2026-06`) |
| Pluggy | mês da **transação** (`dt_br`, data real da compra) → mai = `2026-05` |
| PDF/Pluggy de **conta** | mês do movimento (os dois eixos coincidem) |

A intenção do corte é "cada **mês real** vem de uma fonte só". Mas como ele compara
**competência**, na fronteira do cartão isso desalinha. Exemplo com `CORTE = '2026-06'`:

> Compra de cartão em **maio/2026** (mês real `2026-05`):
> - no PDF entra na **fatura de junho** → `competencia = '2026-06'`. Regra PDF é
>   `m < CORTE` → `'2026-06' < '2026-06'` é **falso** → **oculta**.
> - no Pluggy entra em `competencia = '2026-05'` → `m >= CORTE` é **falso** →
>   **oculta**.
> - **Resultado: a compra some das duas fontes.** É **sub-contagem** (não dupla),
>   mas é um buraco real na fronteira.

A direção de **dupla contagem** aparece se, em algum recorte que não passe pelo
corte (ex.: a aba Conciliação, ou um futuro relatório por mês real), a mesma
compra for somada nas duas fontes. Por isso `02-dupla-contagem-fronteira.sql`
reconstrói o **mês real** (igual a `mesReal()`/`dvDataReal()` de `finance.ts`) e
procura a mesma transação (mesmo `|valor|` + mesmo mês real) presente em PDF **e**
Pluggy, marcando as que **cruzam o corte** (`cruza_corte`).

### Deveria ser por conta/competência?

Sim — é o caminho mais robusto, mas é mudança de política (fora do escopo
conservador do W2; fica registrado como recomendação):

- **Por mês real, não por competência de fatura.** Cortar pelo mês real da compra
  (o eixo que `conciliacao.ts` já usa para o placar) elimina o desalinhamento de
  fatura do cartão. Custo: o PDF não traz mês real explícito para conta; para
  cartão dá para derivar de `data_mov` + competência (como `dvDataReal`).
- **Por conta/origem, não global.** Hoje o corte é um único mês para **todas** as
  contas. Se o Open Finance entrou em datas diferentes por banco (um cartão
  conectou em mai, outro em jul), um corte global vaza: meses em que só um banco
  tem Pluggy contam o PDF do outro como ausente. Um corte **por (banco, tipo)**
  resolveria — ao custo de configuração por conta.
- **Por casamento real (preferível a qualquer corte).** A conciliação
  (`src/lib/conciliacao.ts`) já casa par a par com múltiplos sinais. O alvo final
  é **persistir o casamento** (marcar a perna PDF como suplantada quando há a
  Pluggy correspondente) em vez de cortar por janela — aí a dedup não depende de
  o eixo de mês bater. Hoje a conciliação só diagnostica; não escreve.

Enquanto o corte global por competência continuar, **mantenha o `CORTE` num mês de
virada de fatura** e rode `02` e `05` após cada mudança de fonte.

---

## 3. Casos de divergência conhecidos

| Caso | O que acontece hoje | Onde aparece | Conferência |
|------|---------------------|--------------|-------------|
| **Compra de cartão na fronteira do corte** | fatura (competência) e compra (mês real) caem em lados opostos do corte → some das duas fontes (§2) | gasto sub-contado no mês da virada | `02` (2.1 `cruza_corte`, 2.3) |
| **Restituição da Receita Federal** | classificada por P60 (categoria `Transfers`) como `Transferencia/Pagamento` → hoje **neutralizada**, sem perna casada. É **entrada real** que deveria ser `Receita`. O W1 deve reclassificar P60 **sem par** para `Receita`. | receita sub-contada | `03` (3.1 interna/transfer sem `par_hash`); validar que vira `Receita` após W1 |
| **Parcelas colapsadas no mês da compra** | a tradução usa competência = mês de `dt_br`; bancos que lançam todas as parcelas na data da compra jogam tudo no mesmo mês (bug req. #2). O W1 deriva competência pelo índice `NN/MM`. | gasto inflado no mês da compra, vazio nos seguintes | comparar `04` (placar por competência) antes/depois do W1 |
| **Pagamento de fatura** | P10 (`Credit card payment`) marca `Transferencia/Pagamento`; o W1 marca `interna=true` e casa a perna débito-conta ↔ crédito-cartão via `par_hash` | neutro (correto) se as duas pernas casarem | `03` (3.2 pernas != 2, 3.3 soma != 0, 3.5 pernas soltas casáveis) |
| **Aporte/resgate (cofrinho, renda fixa)** | aporte (saída) → `Aporte`/`interna`; resgate (entrada) → `Transferencia/Pagamento`/`interna` (principal de volta, não receita) | apartado de gasto/receita | `04.2` (colunas `aportado`, `internas_excluidas`) |
| **Rendimento/dividendo recebido** | P40c → `Receita Investimento` (métrica própria, fora de receita comum) | não infla "Receita" | `04.2` (coluna `rend_invest`) |
| **Transação em moeda estrangeira** | `valor` em moeda != BRL não é comparável em real; somas ignoram e contam à parte | fora do placar BRL | `04` (coluna `estrangeiras`) |
| **PDF com competência >= corte sem Pluggy** | corte manda o mês para o Pluggy; se o Pluggy não cobre, o gasto fica invisível | sub-contagem de um mês inteiro | `05.2` |
| **Pluggy com competência < corte sem PDF** | corte oculta o Pluggy; se o PDF não cobre o mês, some | sub-contagem | `05.3` |
| **Competência nula/corrompida** | antes do W2 passava em `"" < CORTE` e contava como PDF; agora é **oculta** | nenhuma (guard do W2) | `05.1` (`mes_sem_fonte`) |

---

## 4. Checklist de reconciliação (rodar após aplicar o W1)

Ordem sugerida no SQL Editor do Supabase. Tudo é só-leitura; pode repetir.

1. **Snapshot ANTES.** Rode `04-totais-mensais-por-fonte.sql` (4.1 e 4.2) e guarde
   o resultado. É a base de comparação.
2. **Aplique o W1** (migration da função + backfill) — pelo dono, no Supabase.
   Rode `pluggy_traduzir_lancamentos` e o backfill.
3. **Duplicatas de hash** — `01-hash-duplicatas.sql`:
   - 1.1, 1.2, 1.4 devem voltar **vazias**. Se 1.2 (colisão dura) tiver linhas,
     pare: dois fatos distintos com o mesmo hash → um some do total.
   - 1.3: prefixos coerentes (`pluggy:*` para Pluggy, `imp_*` para PDF).
4. **Dupla contagem na fronteira** — `02-dupla-contagem-fronteira.sql`:
   - 2.1: revise as linhas com `cruza_corte = true` — são as candidatas a serem
     contadas duas vezes (ou perdidas). Ajuste o `CORTE` se houver concentração
     num mês.
   - 2.2/2.3: confirme que os meses com as duas fontes estão sendo separados pelo
     corte como esperado.
5. **Netting** — `03-netting-pernas.sql`:
   - 3.2 (pernas != 2) e 3.3 (par não soma ~zero) devem voltar **vazias**.
   - 3.1 (interna sem par) e 3.5 (pernas soltas casáveis): idealmente vazias;
     cada linha é uma transferência interna não-netada. Confirme em especial que a
     **restituição da Receita Federal** NÃO está aqui como `Transferencia` —
     deveria ter virado `Receita` (perna externa, sem par).
6. **Placar DEPOIS** — rode `04` de novo e compare com o snapshot:
   - **gasto/receita reais por mês NÃO devem mudar** materialmente (4.1).
   - o que muda é a **separação**: aparecem `aportado`, `rend_invest`,
     `internas_excluidas` (4.2); o gasto de meses com parcelas colapsadas se
     redistribui para os meses corretos (req. #2).
7. **Sanidade do corte** — `05-corte-competencia.sql`:
   - 5.1: nenhum mês com `mes_sem_fonte = true` nem `duas_fontes_visiveis = true`.
   - 5.2/5.3: listas vazias (sem buraco PDF→Pluggy nem Pluggy→PDF).
   - 5.4: confira que só faturas realmente futuras estão ocultas.
8. **Sanidade no app:** abra a aba **Conciliação** e confira que `soPDF` na janela
   de sobreposição está pequeno (PDFs sem par dentro da janela = candidatos a
   buraco) e que os `pares` de alta confiança batem com o que o corte está
   escondendo.

Se 1.2, 3.2 ou 3.3 trouxerem linhas, ou 5.1 acusar `duas_fontes_visiveis`/
`mes_sem_fonte`, **há dupla contagem ou buraco** — resolver antes de confiar nos
totais.

---

## 5. Ajuste feito pelo W2 no hook

Mudança **pontual e conservadora** em `src/hooks/useLancamentos.ts` (`lancVisivel`):
uma competência só posiciona a linha no corte se for um `YYYY-MM` válido
(`/^\d{4}-\d{2}$/`). Antes, uma competência nula/corrompida (`compKey` → `""`)
passava em `"" < CORTE` e a linha entrava nos dashboards **do lado do PDF**, sem
âncora de mês — contando num mês que não é o dela. Agora competência inválida é
**oculta** (conservador: melhor não contar do que contar no mês errado).

Não foi mexido na **política** do corte (mês global por competência) — isso é
decisão de produto e mudar arrisca introduzir dupla contagem. As recomendações de
cortar por mês real / por conta / por casamento persistido ficam registradas em
§2 para uma frente futura.
