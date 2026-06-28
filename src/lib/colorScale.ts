// Escala de cor p/ heatmap discreto da matriz mensal.
// Ideia: cada secao tem um "hue" base; celulas recebem um OVERLAY com alpha baixo
// proporcional ao valor (sequencial) ou ao delta (divergente verde/vermelho).
// Alpha sempre baixo (<= ~0.2) p/ legibilidade nos temas claro e escuro.

export type RGB = readonly [number, number, number];

// Hue base por secao
export const HUE_SECAO: Record<'receita' | 'gasto' | 'investido' | 'saldo', RGB> = {
  receita: [22, 163, 74],    // verde
  gasto: [224, 56, 43],      // vermelho
  investido: [124, 58, 237], // violeta
  saldo: [94, 92, 230],      // violeta-azulado
};

// Verde/vermelho fixos p/ a escala divergente
const VERDE: RGB = [22, 163, 74];
const VERMELHO: RGB = [224, 56, 43];

// Tint sequencial: intensidade proporcional a |valor|/max no hue da secao
export function tintSequencial(
  valor: number,
  max: number,
  hue: RGB,
  opts?: { alphaMax?: number; gamma?: number },
): string {
  const t = max > 0 ? Math.min(1, Math.abs(valor) / max) : 0;
  if (!isFinite(t) || valor === 0 || t === 0) return "transparent";
  const a = (opts?.alphaMax ?? 0.18) * Math.pow(t, opts?.gamma ?? 0.8);
  return `rgba(${hue[0]}, ${hue[1]}, ${hue[2]}, ${a.toFixed(3)})`;
}

// Tint divergente: verde se a variacao e "boa", vermelho se "ruim"
export function tintDivergente(
  delta: number,
  absMax: number,
  opts?: { alphaMax?: number; gamma?: number; bomQuandoSobe?: boolean },
): string {
  const t = absMax > 0 ? Math.min(1, Math.abs(delta) / absMax) : 0;
  if (delta === 0 || t === 0 || !isFinite(t)) return "transparent";
  // "subir e bom"? (receita/investido: true; gasto: false)
  const bom = opts?.bomQuandoSobe ?? false;
  const positivo = delta > 0;
  const ehBom = positivo === bom; // subiu e bom, OU caiu e ruim
  const hue = ehBom ? VERDE : VERMELHO;
  const a = (opts?.alphaMax ?? 0.16) * Math.pow(t, opts?.gamma ?? 0.8);
  return `rgba(${hue[0]}, ${hue[1]}, ${hue[2]}, ${a.toFixed(3)})`;
}
