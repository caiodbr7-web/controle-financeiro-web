/* ============================================================================
   Classes de investimento — rótulos, opções e paleta.

   Vivem aqui (e não na aba) porque são compartilhadas pela aba "Investimentos"
   e pela sub-aba "Balanceamento". O "tipo efetivo" de um ativo é a sua
   classificação manual (tipo_manual) ou, sem ela, a da Pluggy.
   ============================================================================ */

// rótulos amigáveis para os tipos (Pluggy + classes manuais extras)
export const TIPO_LABEL: Record<string, string> = {
  FIXED_INCOME: "Renda Fixa",
  MUTUAL_FUND: "Fundos",
  SECURITY: "Títulos",
  EQUITY: "Ações",
  STOCK: "Ações",
  ETF: "ETF",
  ETF_US: "ETF - US",
  DEBENTURE: "Debêntures",
  COE: "COE",
  PENSION: "Previdência",
  REAL_ESTATE: "Imobiliário",
  CRYPTO: "Cripto",
  CAIXA: "Caixa",
  OUTROS: "Outros",
};
export const labelTipo = (t?: string | null) => (t ? TIPO_LABEL[t] ?? t : "Outros");

// opções do seletor de classificação manual (value = chave canônica)
export const CLASSE_OPTS = [
  { v: "FIXED_INCOME", label: "Renda Fixa" },
  { v: "MUTUAL_FUND", label: "Fundos" },
  { v: "EQUITY", label: "Ações" },
  { v: "ETF", label: "ETF" },
  { v: "ETF_US", label: "ETF - US" },
  { v: "DEBENTURE", label: "Debêntures" },
  { v: "COE", label: "COE" },
  { v: "PENSION", label: "Previdência" },
  { v: "REAL_ESTATE", label: "Imobiliário" },
  { v: "CRYPTO", label: "Cripto" },
  { v: "OUTROS", label: "Outros" },
];

// paleta categórica (uma cor por tipo) — legível nos dois temas (premium 2026)
export const PALETA = ["#6d28d9", "#16a06b", "#e0a33a", "#ec5b7e", "#3b82f6", "#8b5cf6", "#14b8a6", "#9ca3af"];
// cor fixa do "Caixa" (saldo líquido em conta) — cinza-azulado, destaca-se da paleta
export const CAIXA_COR = "#64748b";

// chave da pseudo-categoria "Caixa" (saldo em conta; não é uma posição da Pluggy).
// Entra no balanceamento como uma classe normal — o caixa faz parte dos 100%.
export const CAIXA_TIPO = "CAIXA";

// todas as classes que podem receber um alvo de alocação: as classificáveis + Caixa
export const CLASSES_ALVO = [...CLASSE_OPTS, { v: CAIXA_TIPO, label: "Caixa" }];
