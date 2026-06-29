// ============================================================================
// Motor de sugestão / auto-classificação (lógica pura — sem React, sem Supabase).
// ----------------------------------------------------------------------------
// Combina, em ordem de prioridade, as fontes de conhecimento do produto para
// sugerir a categoria de um lançamento ainda não classificado:
//
//   1. vínculo    — vínculo do Planejamento (plano.link_texto contido na
//                   descrição) → plano.categoria.  Ex.: "Total Pass" → Academia.
//   2. histórico  — você JÁ classificou este estabelecimento antes (histMap) OU
//                   existe uma regra aprendida pelo app (prioridade ≥ 100).
//   3. motor      — máquina de conhecimento embutida: ~200 regras de palavra-chave
//                   (tabela `regras`, match "contains" por prioridade). Ex.:
//                   "uber" → Transporte. Também a categoria_auto do parser de PDF.
//   4. banco      — a categoria que o próprio Open Banking (Pluggy) atribuiu,
//                   que vem em inglês e é mapeada para uma categoria PT.
//
// "conhecido" (vínculo + histórico) é o que o app pode aplicar sozinho num clique
// ("Aplicar conhecidos"); "motor"/"banco" são só sugestões pré-preenchidas que
// você confirma — e, ao confirmar, viram histórico para o próximo mês.
// ============================================================================
import { getCategorias } from "./finance";
import { semAcento } from "./texto";

export type FonteSugestao = "vinculo" | "historico" | "motor" | "banco" | "nenhuma";

export interface Regra {
  padrao: string;
  categoria: string;
  prioridade?: number | null;
  match_type?: string | null;
}

export interface VinculoPlano {
  link_texto?: string | null;
  categoria?: string | null;
  ativo?: boolean;
}

export interface Sugestao {
  categoria: string;
  fonte: FonteSugestao;
  conhecido: boolean;
}

export interface CtxSugestao {
  regras: Regra[];
  planos: VinculoPlano[];
  histMap: Record<string, string>; // chave normEstab → categoria que você já usou
}

// regras gravadas pelo app herdam a prioridade default do banco (100); as ~200
// regras SEMEADAS têm prioridade baixa (3–17). Usamos isso p/ distinguir "aprendida
// por você" (conhecido) de "motor embutido" (só sugestão).
const PRIO_APRENDIDA = 100;

const ehCategoria = (c?: string | null): c is string => !!c && getCategorias().includes(c);

/** Normaliza texto p/ comparação por conteúdo: minúsculas, sem acento, espaço colapsado. */
export function normTexto(s: string): string {
  return semAcento(String(s || "").toLowerCase()).replace(/\s+/g, " ").trim();
}

// O Pluggy entrega a categoria em INGLÊS (ex.: "Groceries", "Food and drinks").
// Mapeamos para uma das CATEGORIAS (PT) por palavra-chave — robusto a variações do
// taxonomy do Pluggy (casa por substring, não igualdade exata). A ORDEM importa:
// a primeira regex que casa vence (ex.: streaming/assinatura antes de lazer).
const BANCO_MAP: [RegExp, string][] = [
  [/grocer|supermarket|market(?!place)/, "Mercado"],
  [/food|restaurant|dining|\bbar\b|coffee|cafe|bakery|delivery|drink/, "Alimentacao"],
  [/transport|taxi|ride.?hail|mobility|\bfuel\b|gas station|parking|\btoll|transit|airport shuttle/, "Transporte"],
  [/gym|fitness|wellness|workout|crossfit/, "Academia"],
  [/pharmac|drugstore|\bhealth|medical|doctor|dentist|hospital|clinic|\blab\b|therapy/, "Saude"],
  [/beauty|personal care|\bsalon|barber|\bhair|cosmet/, "Saude"],
  [/cloth|apparel|fashion|footwear|\bshoe/, "Vestuario"],
  [/travel|airline|\bflight|hotel|accommodation|lodging|tourism|booking/, "Viagem"],
  [/telecom|internet|\bmobile|\bphone|subscription|software|streaming|online service|cloud|saas/, "Assinaturas"],
  [/leisure|entertain|cinema|movie|theat(er|re)|gaming|concert|event/, "Lazer"],
  [/education|school|tuition|course|university|college|\bbooks?\b/, "Educacao"],
  [/\brent\b|housing|mortgage|utilit|electric|\bwater\b|gas bill|condo|home/, "Moradia"],
  [/\btax\b|taxes|government fee|duties/, "Impostos/Taxas"],
  [/\bpet/, "Pets"],
  [/\bgift|donation|charity/, "Presentes"],
  [/shop|store|retail|marketplace|e.?commerce|department|electronics/, "Compras"],
  [/service/, "Servicos"],
];

/**
 * Categoria PT sugerida a partir da categoria que o banco (Pluggy) atribuiu.
 * Aceita também uma categoria que já esteja em PT (caso do parser de PDF).
 * Retorna "" quando não há mapeamento.
 */
export function bancoSugestao(catBanco?: string | null): string {
  const t = normTexto(catBanco || "");
  if (!t) return "";
  for (const c of getCategorias()) if (c && normTexto(c) === t) return c; // já é PT
  for (const [re, cat] of BANCO_MAP) if (re.test(t)) return cat;
  return "";
}

/**
 * Melhor regra "contains" que casa na descrição já normalizada.
 * Critério: MAIOR prioridade vence; empate → padrão mais longo (mais específico).
 * Assim "amazon prime" (Assinaturas) ganha de "amazon" (Compras), e uma regra
 * aprendida (prioridade 100) ganha das semeadas (≤ 17).
 */
export function matchRegra(descNorm: string, regras: Regra[]): Regra | null {
  let best: Regra | null = null;
  let bestPad = "";
  for (const r of regras) {
    if (!r.padrao || !r.categoria) continue;
    const pad = normTexto(r.padrao);
    if (!pad) continue;
    const hit = (r.match_type || "contains") === "exact" ? descNorm === pad : descNorm.includes(pad);
    if (!hit) continue;
    if (!best) { best = r; bestPad = pad; continue; }
    const pa = best.prioridade ?? PRIO_APRENDIDA;
    const pb = r.prioridade ?? PRIO_APRENDIDA;
    if (pb > pa || (pb === pa && pad.length > bestPad.length)) { best = r; bestPad = pad; }
  }
  return best;
}

/**
 * Sugere a categoria de um GRUPO de lançamentos (mesmo estabelecimento) ainda
 * sem classificação manual. `key` é a chave normEstab; `descExemplo` é uma
 * descrição representativa do grupo; `categoriaAutoTop` é a categoria_auto
 * predominante das linhas (PT no PDF, EN no Pluggy).
 */
export function sugerirGrupo(
  key: string,
  descExemplo: string,
  categoriaAutoTop: string | null,
  ctx: CtxSugestao,
): Sugestao {
  const desc = normTexto(descExemplo);

  // 1) vínculo do Planejamento (link_texto contido na descrição) → conhecido
  for (const p of ctx.planos) {
    if (p.ativo === false) continue;
    const lt = normTexto(p.link_texto || "");
    if (lt && desc.includes(lt) && ehCategoria(p.categoria)) {
      return { categoria: p.categoria as string, fonte: "vinculo", conhecido: true };
    }
  }

  // 2) histórico: você já classificou este estabelecimento → conhecido
  const h = ctx.histMap[key];
  if (ehCategoria(h)) return { categoria: h, fonte: "historico", conhecido: true };

  // 3) motor de regras (palavra-chave). Regra aprendida (prio ≥ 100) é tratada
  //    como histórico/conhecido — cobre o caso da descrição variar levemente.
  const r = matchRegra(desc, ctx.regras);
  if (r && ehCategoria(r.categoria)) {
    const aprendida = (r.prioridade ?? PRIO_APRENDIDA) >= PRIO_APRENDIDA;
    return { categoria: r.categoria, fonte: aprendida ? "historico" : "motor", conhecido: aprendida };
  }

  // 3b) categoria_auto do parser de PDF já vem em PT (motor embutido) → sugestão
  if (ehCategoria(categoriaAutoTop)) {
    return { categoria: categoriaAutoTop, fonte: "motor", conhecido: false };
  }

  // 4) categoria do banco (Open Banking / Pluggy, em inglês) → sugestão
  const b = bancoSugestao(categoriaAutoTop);
  if (b) return { categoria: b, fonte: "banco", conhecido: false };

  return { categoria: "", fonte: "nenhuma", conhecido: false };
}
