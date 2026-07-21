// ============================================================================
//  Importação do HISTÓRICO de investimentos a partir dos relatórios consolidados
//  da Área do Investidor da B3 (investidor.b3.com.br -> Relatórios).
//
//  Cada arquivo (mensal ou anual, .xlsx) traz a POSIÇÃO no fechamento do
//  período, em abas "Posição - <produto>" (Ações, ETF, Fundos, Renda Fixa,
//  Tesouro Direto, BDR…). Agregamos o valor por CATEGORIA do app e gravamos um
//  ponto por mês nas mesmas tabelas do retrato diário do Pluggy
//  (pluggy_investments_hist e pluggy_investments_hist_tipo) — o gráfico de
//  evolução, a tabela mensal e os KPIs de crescimento passam a enxergar o
//  longo prazo sem nenhum código novo de leitura.
//
//  Cuidados de parsing (formato real dos exports da B3, validado em 2022-2025):
//   - células vêm como TEXTO com decimal em ponto ("2038.14");
//   - em Renda Fixa, CRA/CRI podem cair em colunas DESALINHADAS (bug do export
//     da B3 — o próprio "Total" da planilha os ignora). Por isso somamos linha
//     a linha usando o ÚLTIMO número da linha (= "Valor Atualizado"), que
//     captura também os desalinhados;
//   - a data da posição NÃO está dentro do arquivo: vem do NOME padrão
//     ("relatorioconsolidadomensal2025julho", "relatorioconsolidadoanual2024")
//     e pode ser corrigida na UI antes de importar.
// ============================================================================

import { sb } from "./supabase";
import { semAcento } from "./texto";

/** total de uma categoria do app num mês (valor + nº de posições) */
export interface CatTotal { valor: number; posicoes: number }
/** um ponto mensal pronto para gravar: "YYYY-MM" -> categorias */
export interface PontoB3 { mk: string; categorias: Record<string, CatTotal> }

/** resultado do parse de um arquivo (a competência pode vir nula se o nome fugir do padrão) */
export interface ArquivoB3 {
  nome: string;
  mk: string | null;
  categorias: Record<string, CatTotal>;
  total: number;
  posicoes: number;
  avisos: string[];
}

// aba "Posição - X" -> categoria do app (mesmas chaves do tipo efetivo do Pluggy)
function categoriaDaAba(titulo: string): string {
  const t = semAcento(titulo).toLowerCase();
  if (t.includes("tesouro")) return "FIXED_INCOME";
  if (t.includes("renda fixa") || t.includes("cdb") || t.includes("lc") || t.includes("cri") || t.includes("cra") || t.includes("debenture")) return "FIXED_INCOME";
  if (t.includes("etf")) return "ETF";
  if (t.includes("fundo") || t.includes("fii")) return "REAL_ESTATE";
  if (t.includes("acoes") || t.includes("acao") || t.includes("bdr")) return "EQUITY";
  return "OUTROS";
}

const MESES_NOME = [
  "janeiro", "fevereiro", "marco", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** "relatorioconsolidadomensal2025julho.xlsx" -> "2025-07"; anual -> dezembro. */
export function competenciaDoNome(nome: string): string | null {
  const n = semAcento(nome).toLowerCase();
  const anual = n.match(/anual[^0-9]*(\d{4})/);
  if (anual) return `${anual[1]}-12`;
  const mensal = n.match(/mensal[^0-9]*(\d{4})\s*([a-z]+)/);
  if (mensal) {
    const idx = MESES_NOME.findIndex((m) => mensal[2].startsWith(m));
    if (idx >= 0) return `${mensal[1]}-${String(idx + 1).padStart(2, "0")}`;
  }
  return null;
}

/** último dia do mês de "YYYY-MM" -> "YYYY-MM-DD" */
export function ultimoDiaDoMes(mk: string): string {
  const y = +mk.slice(0, 4), m = +mk.slice(5, 7);
  return `${mk}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
}

// número de uma célula da B3: aceita number ou texto "1234.56"; rejeita datas,
// códigos ("CDB322GG9UP") e os traços de célula vazia.
function numCelula(c: unknown): number | null {
  if (typeof c === "number" && Number.isFinite(c)) return c;
  if (typeof c === "string") {
    const t = c.trim();
    if (/^-?\d+(\.\d+)?$/.test(t)) return parseFloat(t);
  }
  return null;
}

/** Lê um relatório consolidado da B3 (.xlsx) e agrega o valor por categoria. */
export async function parseB3Xlsx(file: File): Promise<ArquivoB3> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer());
  const categorias: Record<string, CatTotal> = {};
  const avisos: string[] = [];
  let abasPos = 0;

  for (const nomeAba of wb.SheetNames) {
    if (!semAcento(nomeAba).toLowerCase().startsWith("posicao")) continue;
    abasPos++;
    const cat = categoriaDaAba(nomeAba);
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[nomeAba], { header: 1, raw: true, blankrows: false });
    const acc = (categorias[cat] = categorias[cat] || { valor: 0, posicoes: 0 });
    for (let i = 1; i < aoa.length; i++) {
      const row = aoa[i] || [];
      const produto = String(row[0] ?? "").trim();
      if (!produto || produto === "Total") continue; // linha em branco / total da aba
      // o valor da posição é o ÚLTIMO número da linha ("Valor Atualizado")
      let valor: number | null = null;
      for (const c of row) { const n = numCelula(c); if (n != null) valor = n; }
      if (valor == null) { avisos.push(`${nomeAba}: linha "${produto.slice(0, 40)}" sem valor — ignorada`); continue; }
      acc.valor += valor;
      acc.posicoes += 1;
    }
    if (acc.valor === 0 && acc.posicoes === 0) delete categorias[cat];
  }

  if (!abasPos) avisos.push('Nenhuma aba "Posição - …" encontrada — este arquivo é um relatório consolidado da B3?');
  const total = Object.values(categorias).reduce((s, v) => s + v.valor, 0);
  const posicoes = Object.values(categorias).reduce((s, v) => s + v.posicoes, 0);
  return { nome: file.name, mk: competenciaDoNome(file.name), categorias, total, posicoes, avisos };
}

/** Grava os pontos mensais no histórico (upsert do total + substitui a quebra
 *  por categoria do dia, como a sincronização faz). Dias já existentes são
 *  SUBSTITUÍDOS — importar de novo corrige, não duplica. */
export async function salvarPontosB3(pontos: PontoB3[]): Promise<void> {
  const agora = new Date().toISOString();
  for (const p of pontos) {
    const dia = ultimoDiaDoMes(p.mk);
    const cats = Object.entries(p.categorias).filter(([, v]) => v.valor > 0);
    const valor_total = cats.reduce((s, [, v]) => s + v.valor, 0);
    const posicoes = cats.reduce((s, [, v]) => s + v.posicoes, 0);

    const { error } = await sb.from("pluggy_investments_hist").upsert(
      { dia, valor_total, valor_aplicado: null, lucro: null, posicoes, atualizado_em: agora },
      { onConflict: "user_id,dia" },
    );
    if (error) throw new Error(error.message);

    // substitui a quebra do dia inteira (RLS restringe o delete ao próprio usuário)
    const { error: eDel } = await sb.from("pluggy_investments_hist_tipo").delete().eq("dia", dia);
    if (eDel) throw new Error(eDel.message);
    if (cats.length) {
      const linhas = cats.map(([tipo, v]) => ({
        dia, tipo, valor_total: v.valor, valor_aplicado: null, posicoes: v.posicoes, atualizado_em: agora,
      }));
      const { error: eIns } = await sb.from("pluggy_investments_hist_tipo").insert(linhas);
      if (eIns) throw new Error(eIns.message);
    }
  }
}
