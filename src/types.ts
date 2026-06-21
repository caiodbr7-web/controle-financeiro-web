export interface Lancamento {
  id: number;
  hash_natural: string;
  competencia: string; // "2026-06 (Jun/26)"
  ano: number;
  mes: number;
  banco: string;
  origem: string; // "Cartao Nubank", "Conta Itau", ...
  data_mov: string; // "dd/mm"
  descricao: string;
  detalhe: string | null;
  classe: string | null; // Gasto / Receita / Estorno/Credito / Transferencia/Pagamento
  categoria_auto: string | null;
  valor: number; // gasto negativo, receita positivo (na moeda `moeda`, normalmente BRL)
  moeda?: string | null; // moeda do campo `valor` (ISO; 'BRL' por padrão)
  valor_origem?: number | null; // valor na moeda estrangeira original (transação internacional)
  moeda_origem?: string | null; // ISO da moeda estrangeira original (ex.: 'USD')
  natureza: string | null; // Pessoal / Corporativo
  categoria_manual: string | null;
  criado_em?: string;
  atualizado_em?: string;
  // origem do dado (PDF ou Pluggy/Open Finance)
  fonte_dados?: string | null;
  pluggy_tx_id?: string | null;
  pluggy_account_id?: string | null;
  pluggy_item_id?: string | null;
}

// Saldo diário reconstruído de uma conta bancária (tabela public.pluggy_saldos)
export interface Saldo {
  account_id: string;
  item_id: string | null;
  banco: string | null;
  conta_nome: string | null;
  tipo: string;
  moeda: string;
  dia: string; // "YYYY-MM-DD" (horário de Brasília)
  saldo: number; // saldo no fim do dia
  saldo_atual_ref: number | null; // saldo atual usado como âncora
  ancora_ts: string | null; // quando o saldo atual foi capturado
}

export type Visao = "ALL" | "pessoal" | "corporativo";
export type Modo = "cartao" | "ambos" | "conta";
export type Aba = "inicio" | "geral" | "mensal" | "diario" | "planejamento" | "classificar" | "lanc" | "adicionar" | "openbanking" | "conciliacao" | "saldo_evolucao" | "saldo_dados";
