import { MES_ABREV, CATEGORIAS_DEFAULT } from "../finance";
import type { Lancamento, Investimento, InvestimentoHist, InvestimentoHistTipo } from "../../types";
import type { SaldoConta } from "../pluggy";

/* ============================================================================
   Base de dados FAKE do "Acesso teste" (modo demo).

   Gera um retrato realista de finanças pessoais (≈14 meses de lançamentos,
   investimentos, saldos, planejamento e categorias) para que qualquer pessoa
   possa explorar o produto completo SEM ver dados reais — nada disso toca o
   Supabase. O cliente fake (demo/demoClient.ts) serve estas tabelas em memória.

   Visibilidade: o hook useLancamentos só mostra lançamentos do lado certo do
   "corte de fonte" (PDF antes do corte; Open Finance/pluggy do corte até o mês
   atual). Por isso geramos `fonte_dados = "pluggy"` para meses >= CORTE e
   `null` (PDF) para os anteriores — assim TODOS os meses aparecem.
   Mantenha CORTE igual a CORTE_OPEN_BANKING em src/hooks/useLancamentos.ts.
   ============================================================================ */
const CORTE = "2026-05";

// ---- PRNG determinístico (dados estáveis entre recarregamentos) -------------
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const rnd = makeRng(20260629);
const ri = (min: number, max: number) => Math.floor(rnd() * (max - min + 1)) + min;
const money = (min: number, max: number) => Math.round((rnd() * (max - min) + min) * 100) / 100;
const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];

// ---- helpers de mês ---------------------------------------------------------
function ymBack(monthsBack: number): { y: number; m: number; key: string } {
  const base = new Date();
  const d = new Date(base.getFullYear(), base.getMonth() - monthsBack, 1);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  return { y, m, key: `${y}-${String(m).padStart(2, "0")}` };
}
// "2026-06 (Jun/26)" — o app usa o prefixo "YYYY-MM" e o conteúdo do parêntese
const competenciaDe = (y: number, m: number) =>
  `${y}-${String(m).padStart(2, "0")} (${MES_ABREV[m - 1]}/${String(y).slice(2)})`;

const CUR = ymBack(0); // mês civil atual (parcial; sem categorização → vira pendência)
const N_MESES = 14;    // histórico gerado (mês atual + 13 anteriores)

// catálogo de gastos: categoria → estabelecimentos + faixa de valor + frequência/mês
interface GastoDef {
  cat: string;
  origem: string;
  banco: string;
  nomes: string[];
  min: number;
  max: number;
  freq: number;       // ocorrências por mês (média)
}
const GASTOS: GastoDef[] = [
  { cat: "Mercado", origem: "Cartao Nubank", banco: "Nubank", nomes: ["Pao de Acucar", "Carrefour", "Assai Atacadista", "Hortifruti Natural", "Mercado Dia", "Supermercado St Marche"], min: 80, max: 540, freq: 4 },
  { cat: "Alimentacao", origem: "Cartao Nubank", banco: "Nubank", nomes: ["iFood", "Restaurante Madero", "Outback", "Padaria Bella Paulista", "Burger King", "Starbucks", "China in Box"], min: 24, max: 180, freq: 6 },
  { cat: "Transporte", origem: "Cartao Itau", banco: "Itau", nomes: ["Uber", "99 App", "Posto Shell", "Estacionamento Shopping", "Metro SP", "Posto Ipiranga"], min: 12, max: 140, freq: 6 },
  { cat: "Saude", origem: "Cartao Itau", banco: "Itau", nomes: ["Drogasil", "Farmacia Pague Menos", "Clinica Odontologica", "Laboratorio Fleury"], min: 28, max: 420, freq: 2 },
  { cat: "Compras", origem: "Cartao Nubank", banco: "Nubank", nomes: ["Amazon", "Mercado Livre", "Magazine Luiza", "Renner", "Zara", "Centauro"], min: 45, max: 680, freq: 2 },
  { cat: "Lazer", origem: "Cartao Nubank", banco: "Nubank", nomes: ["Cinema Cinemark", "Eventim", "Bar do Ze", "Teatro Municipal", "Spotify Eventos"], min: 30, max: 260, freq: 2 },
  { cat: "Vestuario", origem: "Cartao Nubank", banco: "Nubank", nomes: ["Riachuelo", "C&A", "Nike Store", "Adidas"], min: 60, max: 480, freq: 1 },
  { cat: "Educacao", origem: "Conta Itau", banco: "Itau", nomes: ["Curso Alura", "Udemy", "Livraria Cultura", "Coursera"], min: 40, max: 320, freq: 1 },
  { cat: "Pets", origem: "Cartao Itau", banco: "Itau", nomes: ["Petz", "Cobasi", "Veterinario PetCare"], min: 40, max: 300, freq: 1 },
  { cat: "Presentes", origem: "Cartao Nubank", banco: "Nubank", nomes: ["Floricultura", "Presente Aniversario", "Loja de Brinquedos"], min: 50, max: 350, freq: 1 },
];

// recorrentes fixos (1×/mês, dia fixo) — sempre na conta ou cartão
interface FixoDef { cat: string; origem: string; banco: string; nome: string; valor: number; dia: number }
const FIXOS: FixoDef[] = [
  { cat: "Moradia", origem: "Conta Itau", banco: "Itau", nome: "Aluguel Apartamento", valor: 2500, dia: 5 },
  { cat: "Moradia", origem: "Conta Itau", banco: "Itau", nome: "Condominio Edificio", valor: 720, dia: 8 },
  { cat: "Moradia", origem: "Conta Itau", banco: "Itau", nome: "Enel Energia", valor: 0, dia: 12 },     // valor variável (preenchido abaixo)
  { cat: "Moradia", origem: "Conta Itau", banco: "Itau", nome: "Sabesp Agua", valor: 0, dia: 12 },      // valor variável
  { cat: "Assinaturas", origem: "Cartao Nubank", banco: "Nubank", nome: "Netflix", valor: 55.9, dia: 15 },
  { cat: "Assinaturas", origem: "Cartao Nubank", banco: "Nubank", nome: "Spotify Premium", valor: 34.9, dia: 15 },
  { cat: "Assinaturas", origem: "Conta Itau", banco: "Itau", nome: "Vivo Internet Fibra", valor: 119.9, dia: 10 },
  { cat: "Academia", origem: "Conta Itau", banco: "Itau", nome: "SmartFit", valor: 109.9, dia: 7 },
];

const dd = (dia: number, m: number) => `${String(dia).padStart(2, "0")}/${String(m).padStart(2, "0")}`;

function buildLancamentos(): Lancamento[] {
  const rows: Lancamento[] = [];
  let id = 1000;
  const novo = (
    y: number, m: number, dia: number, origem: string, banco: string, descricao: string,
    classe: string, valor: number, categoria: string | null, extra: Partial<Lancamento> = {},
  ): Lancamento => {
    const ym = `${y}-${String(m).padStart(2, "0")}`;
    const pluggy = ym >= CORTE;
    const ehGasto = classe === "Gasto";
    // mês atual fica sem categoria manual → alimenta a aba "Classificar" com pendências
    const semCat = ehGasto && ym === CUR.key;
    return {
      id: id++,
      hash_natural: `demo-${id}`,
      competencia: competenciaDe(y, m),
      ano: y,
      mes: m,
      banco,
      origem,
      data_mov: dd(dia, m),
      descricao,
      detalhe: pluggy ? (classe === "Receita" ? "CREDIT" : "DEBIT") : null,
      classe,
      categoria_auto: ehGasto ? categoria : null,
      valor,
      moeda: "BRL",
      natureza: extra.natureza ?? "Pessoal",
      categoria_manual: ehGasto ? (semCat ? null : categoria) : (extra.categoria_manual ?? null),
      fonte_dados: pluggy ? "pluggy" : null,
      pluggy_tx_id: pluggy ? `tx_${id}` : null,
      pluggy_account_id: pluggy ? `acc_${banco.toLowerCase()}` : null,
      pluggy_item_id: pluggy ? `item_${banco.toLowerCase()}` : null,
      criado_em: `${ym}-15T10:00:00Z`,
      atualizado_em: `${ym}-15T10:00:00Z`,
      interna: extra.interna ?? false,
      subtipo: extra.subtipo ?? null,
      ...extra,
    };
  };

  for (let back = N_MESES - 1; back >= 0; back--) {
    const { y, m } = ymBack(back);

    // salário (receita) — dia 5
    rows.push(novo(y, m, 5, "Conta Itau", "Itau", "Salario Empresa XYZ", "Receita", 12000 + ri(-200, 400), null));
    // freelance ocasional
    if (rnd() < 0.4) rows.push(novo(y, m, ri(10, 25), "Conta Itau", "Itau", "Freelance Projeto", "Receita", money(1500, 3500), null));

    // recorrentes fixos
    for (const f of FIXOS) {
      const valor = f.valor > 0 ? f.valor : (f.nome.includes("Energia") ? money(140, 380) : money(70, 160));
      rows.push(novo(y, m, f.dia, f.origem, f.banco, f.nome, "Gasto", -valor, f.cat));
    }

    // variáveis por categoria
    for (const g of GASTOS) {
      const n = Math.max(0, g.freq + ri(-1, 1));
      for (let i = 0; i < n; i++) {
        rows.push(novo(y, m, ri(1, 28), g.origem, g.banco, pick(g.nomes), "Gasto", -money(g.min, g.max), g.cat));
      }
    }

    // corporativo (reembolsável) — natureza/categoria Corporativo
    if (rnd() < 0.7) {
      rows.push(novo(y, m, ri(3, 25), "Cartao Itau", "Itau", pick(["Uber Corp", "Almoco Cliente", "Hotel Viagem Trabalho", "Passagem Aerea"]), "Gasto", -money(120, 900), "Corporativo", { natureza: "Corporativo", categoria_manual: "Corporativo" }));
    }

    // estorno ocasional
    if (rnd() < 0.3) rows.push(novo(y, m, ri(1, 28), "Cartao Nubank", "Nubank", "Estorno Compra", "Estorno/Credito", money(30, 200), "Compras"));

    // aporte mensal em investimento (interno, não conta como gasto)
    rows.push(novo(y, m, 6, "Conta Itau", "Itau", "Aplicacao Tesouro Direto", "Aporte", -1500, null, { interna: true, subtipo: "Aporte" }));

    // rendimento de investimento ocasional
    if (rnd() < 0.5) rows.push(novo(y, m, ri(20, 28), "Conta Itau", "Itau", "Rendimentos CDB", "Receita Investimento", money(40, 280), null, { subtipo: "Rendimentos" }));

    // pagamento de fatura do cartão (transferência interna — fluxo neutro)
    rows.push(novo(y, m, 10, "Conta Itau", "Itau", "Pagamento Fatura Nubank", "Transferencia/Pagamento", -money(1800, 3200), null, { interna: true, subtipo: "Pagamento de fatura" }));
  }

  // parcelamentos no cartão — cada parcela cai na competência do próprio mês,
  // mas repete a DATA ORIGINAL da compra ("regime colapsado") e traz o sufixo
  // "N/M" na descrição. É daqui que nasce o platô do dia 1 na curva diária
  // (Início/Diário): valor já comprometido antes de o mês abrir.
  // "Notebook Dell" casa com o plano "Notebook novo" (10× de 583,20).
  const NTB = ymBack(3);
  for (let i = 0; i <= 3; i++) {
    const { y, m } = ymBack(3 - i);
    rows.push({ ...novo(y, m, 14, "Cartao Nubank", "Nubank", `Notebook Dell ${i + 1}/10`, "Gasto", -583.2, "Compras"), data_mov: dd(14, NTB.m) });
  }
  const PAS = ymBack(9);
  for (let i = 0; i <= 9; i++) {
    const { y, m } = ymBack(9 - i);
    rows.push({ ...novo(y, m, 8, "Cartao Nubank", "Nubank", `Latam Passagens ${i + 1}/12`, "Gasto", -420.5, "Viagem"), data_mov: dd(8, PAS.m) });
  }

  return rows;
}

// ---- categorias (semeadas, com id e ordem) ----------------------------------
function buildCategorias() {
  return CATEGORIAS_DEFAULT.map((c, i) => ({ id: i + 1, nome: c.nome, cor: c.cor, ordem: i }));
}

// ---- planejamento -----------------------------------------------------------
function buildPlanos() {
  const inicioAntigo = ymBack(N_MESES - 1).key;
  let id = 1;
  const p = (o: Record<string, unknown>) => ({
    id: id++, tipo: "fixo", nome: "", categoria: null, valor: 0,
    mes_inicio: inicioAntigo, mes_fim: null, parcelas: null, ativo: true, ordem: id,
    no_cartao: false, eh_cartao_total: false, eh_conta_total: false, eh_receita_total: false,
    link_categoria: null, link_texto: null, ...o,
  });
  return [
    p({ tipo: "fixo", nome: "Aluguel", categoria: "Moradia", valor: 2500, link_categoria: "Moradia", link_texto: "aluguel" }),
    p({ tipo: "fixo", nome: "Condomínio", categoria: "Moradia", valor: 720 }),
    p({ tipo: "fixo", nome: "Internet", categoria: "Assinaturas", valor: 119.9 }),
    p({ tipo: "fixo", nome: "Academia", categoria: "Academia", valor: 109.9 }),
    p({ tipo: "fixo", nome: "Streaming (Netflix + Spotify)", categoria: "Assinaturas", valor: 90.8, no_cartao: true }),
    p({ tipo: "receita", nome: "Salário", categoria: null, valor: 12000 }),
    p({ tipo: "parcelamento", nome: "Notebook novo", categoria: "Compras", valor: 583.2, parcelas: 10, mes_inicio: ymBack(3).key, no_cartao: true }),
    p({ tipo: "meta", nome: "Viagem Europa", categoria: "Viagem", valor: 18000, mes_inicio: ymBack(2).key, mes_fim: ymBack(-9).key }),
    p({ tipo: "pagamento", nome: "IPVA 2026", categoria: "Impostos/Taxas", valor: 1850, mes_inicio: ymBack(-1).key }),
    p({ tipo: "fixo", nome: "Orçamento do cartão", categoria: null, valor: 3200, eh_cartao_total: true }),
    p({ tipo: "fixo", nome: "Orçamento da conta", categoria: null, valor: 2600, eh_conta_total: true }),
  ];
}

// ---- investimentos (posições) ----------------------------------------------
function buildInvestimentos(): Investimento[] {
  const base = (o: Partial<Investimento> & { investment_id: string }): Investimento => ({
    item_id: "item_nubank", banco: null, tipo: null, subtipo: null, nome: null, emissor: null,
    saldo: null, valor_aplicado: null, lucro: null, quantidade: null, moeda: "BRL",
    vencimento: null, taxa: null, status: "ACTIVE", tipo_manual: null, liquidez_d1_manual: null,
    fonte: "pluggy", manual: false, ticker: null, moeda_cotacao: null, preco_unitario: null,
    preco_em: null, atualizado_em: new Date().toISOString(), ...o,
  });
  const calc = (i: Investimento): Investimento => ({ ...i, lucro: (i.saldo ?? 0) - (i.valor_aplicado ?? 0) });
  return [
    calc(base({ investment_id: "inv_selic", tipo: "FIXED_INCOME", nome: "Tesouro Selic 2029", emissor: "Tesouro Nacional", banco: "Nu Financeira", saldo: 25400, valor_aplicado: 22000, taxa: "100 Selic", vencimento: "2029-03-01" })),
    calc(base({ investment_id: "inv_cdb", tipo: "FIXED_INCOME", nome: "CDB Liquidez Diária", emissor: "Banco Inter", banco: "Banco Inter", saldo: 15200, valor_aplicado: 14500, taxa: "110 CDI" })),
    calc(base({ investment_id: "inv_fundo", tipo: "MUTUAL_FUND", nome: "Fundo XP Renda Fixa DI", emissor: "XP", banco: "XP Investimentos", saldo: 8300, valor_aplicado: 8000, subtipo: "Renda Fixa DI" })),
    calc(base({ investment_id: "inv_petr", tipo: "EQUITY", nome: "PETR4", emissor: "Petrobras", banco: "XP Investimentos", saldo: 6100, valor_aplicado: 5200, quantidade: 200 })),
    calc(base({ investment_id: "inv_ivvb", tipo: "ETF", nome: "IVVB11", emissor: "BlackRock", banco: "XP Investimentos", saldo: 12800, valor_aplicado: 9500, quantidade: 45 })),
    calc(base({ investment_id: "inv_prev", tipo: "PENSION", nome: "Previdência PGBL", emissor: "Icatu", banco: "Icatu Seguros", saldo: 31000, valor_aplicado: 28500 })),
    calc(base({ investment_id: "inv_btc", tipo: null, tipo_manual: "CRYPTO", nome: "Bitcoin (carteira própria)", banco: "Carteira", saldo: 5400, valor_aplicado: 3000, fonte: "manual", manual: true, item_id: null })),
  ];
}

// total atual da carteira (soma das posições) — base p/ o histórico
function totalCarteira(invs: Investimento[]): { total: number; aplicado: number } {
  let total = 0, aplicado = 0;
  for (const i of invs) { total += i.saldo ?? 0; aplicado += i.valor_aplicado ?? 0; }
  return { total, aplicado };
}

// histórico diário do patrimônio (≈150 dias, terminando ONTEM; hoje é calculado ao vivo)
function buildHist(invs: Investimento[]): { hist: InvestimentoHist[]; histTipo: InvestimentoHistTipo[] } {
  const { total, aplicado } = totalCarteira(invs);
  const DIAS = 150;
  const hist: InvestimentoHist[] = [];
  const histTipo: InvestimentoHistTipo[] = [];
  const tipoEf = (i: Investimento) => i.tipo_manual ?? i.tipo ?? "OUTROS";
  const fracPorTipo = new Map<string, number>();
  for (const i of invs) {
    const k = tipoEf(i);
    fracPorTipo.set(k, (fracPorTipo.get(k) ?? 0) + (i.saldo ?? 0) / total);
  }
  const aplicadoFrac = aplicado / total;

  const hoje = new Date();
  for (let d = DIAS; d >= 1; d--) {
    const dt = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - d);
    const dia = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    // cresce de ~78% do total até ~99% (com leve ruído) — curva ascendente realista
    const prog = (DIAS - d) / DIAS;
    const fator = 0.78 + prog * 0.21 + (rnd() - 0.5) * 0.012;
    const valor_total = Math.round(total * fator * 100) / 100;
    const valor_aplicado = Math.round(valor_total * aplicadoFrac * 100) / 100;
    hist.push({ dia, valor_total, valor_aplicado, lucro: Math.round((valor_total - valor_aplicado) * 100) / 100, posicoes: invs.length });
    for (const [tipo, frac] of fracPorTipo) {
      const vt = Math.round(valor_total * frac * 100) / 100;
      histTipo.push({ dia, tipo, valor_total: vt, valor_aplicado: Math.round(vt * aplicadoFrac * 100) / 100, posicoes: 1 });
    }
  }
  return { hist, histTipo };
}

// saldo em conta (caixa) — Open Finance
function buildSaldos(): SaldoConta[] {
  const hoje = new Date();
  const dia = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
  return [
    { account_id: "acc_itau", banco: "Itau", conta_nome: "Conta Corrente", saldo: 8650.42, dia, moeda: "BRL" },
    { account_id: "acc_nubank", banco: "Nubank", conta_nome: "Conta", saldo: 3240.18, dia, moeda: "BRL" },
    { account_id: "acc_picpay", banco: "PicPay", conta_nome: "Carteira", saldo: 480.0, dia, moeda: "BRL" },
  ];
}

// conexões Open Finance já "conectadas"
function buildItems() {
  const ts = new Date().toISOString();
  return [
    { item_id: "item_nubank", connector_name: "Nubank", status: "UPDATED", sync_from: "2025-01-01", last_synced_at: ts, last_result: { contas: 2, transacoes: 320, lancamentos: 320 } },
    { item_id: "item_itau", connector_name: "Itaú", status: "UPDATED", sync_from: "2025-01-01", last_synced_at: ts, last_result: { contas: 2, transacoes: 280, lancamentos: 280 } },
  ];
}

// algumas regras de auto-classificação já "aprendidas"
function buildRegras() {
  return [
    { padrao: "uber", categoria: "Transporte", prioridade: 100, match_type: "contains" },
    { padrao: "ifood", categoria: "Alimentacao", prioridade: 100, match_type: "contains" },
    { padrao: "netflix", categoria: "Assinaturas", prioridade: 100, match_type: "contains" },
    { padrao: "drogasil", categoria: "Saude", prioridade: 100, match_type: "contains" },
    { padrao: "amazon", categoria: "Compras", prioridade: 100, match_type: "contains" },
  ];
}

export interface DemoDb {
  [table: string]: Record<string, unknown>[];
}

/** Constrói (uma vez) o conjunto completo de tabelas fake do modo demo. */
export function buildDemoData(): DemoDb {
  const invs = buildInvestimentos();
  const { hist, histTipo } = buildHist(invs);
  return {
    lancamentos: buildLancamentos() as unknown as Record<string, unknown>[],
    categorias: buildCategorias() as unknown as Record<string, unknown>[],
    planos: buildPlanos() as unknown as Record<string, unknown>[],
    plano_mensal: [],
    regras: buildRegras() as unknown as Record<string, unknown>[],
    pluggy_investments: invs as unknown as Record<string, unknown>[],
    pluggy_investments_hist: hist as unknown as Record<string, unknown>[],
    pluggy_investments_hist_tipo: histTipo as unknown as Record<string, unknown>[],
    pluggy_saldos: buildSaldos() as unknown as Record<string, unknown>[],
    pluggy_items: buildItems() as unknown as Record<string, unknown>[],
    pluggy_transacoes_raw: [],
    pluggy_contas_raw: [],
    ibkr_flex: [],
  };
}
