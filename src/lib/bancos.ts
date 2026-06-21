import { semAcento } from "./texto";

// ============================================================================
// Resolvedor de banco canônico — ESPELHO de public.pluggy_banco_canonico (SQL,
// migration 0008). Reconhece a instituição pelo conector + nomes das contas e
// devolve um nome CANÔNICO alinhado à base de PDF ('Itau','Nubank','PicPay') e
// nomes limpos para os demais. Mantenha os dois em sincronia.
// ============================================================================

const XP = /(^|[^a-z])xp([^a-z]|$)/;

/** Reconhece o banco a partir de um texto livre (conector + contas). null se desconhecido. */
export function bancoCanonico(blob: string): string | null {
  const n = semAcento(blob).toLowerCase();
  if (n.includes("nubank") || n.includes("nu pagamentos") || n.includes("nu financeira")) return "Nubank";
  if (n.includes("itau")) return "Itau";
  if (n.includes("picpay")) return "PicPay";
  if (n.includes("rico")) return "Rico";
  if (XP.test(n)) return "XP";
  if (n.includes("bradesco")) return "Bradesco";
  if (n.includes("santander")) return "Santander";
  if (n.includes("banco do brasil")) return "Banco do Brasil";
  if (n.includes("caixa")) return "Caixa";
  if (n.includes("inter")) return "Inter";
  if (n.includes("c6")) return "C6";
  if (n.includes("btg")) return "BTG";
  if (n.includes("mercado pago") || n.includes("mercadopago")) return "Mercado Pago";
  if (n.includes("pagbank") || n.includes("pagseguro")) return "PagBank";
  if (n.includes("safra")) return "Safra";
  if (n.includes("neon")) return "Neon";
  if (n.includes("sicoob")) return "Sicoob";
  if (n.includes("sicredi")) return "Sicredi";
  if (n.includes("original")) return "Original";
  return null;
}

/** Nome do banco para exibir, com fallback: conector real (nunca "Pluggy") ou conta. */
export function resolverBanco(connector: string | null, contas: string[]): string {
  const blob = [connector ?? "", ...contas].join(" ");
  const canon = bancoCanonico(blob);
  if (canon) return canon;
  if (connector && !/pluggy/i.test(connector)) return connector;
  return contas.find(Boolean) || connector || "Banco";
}
