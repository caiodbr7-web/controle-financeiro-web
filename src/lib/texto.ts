// helper compartilhado: remove acentos (NFD + faixa de diacríticos combinantes
// U+0300–U+036F). RegExp construído por escape para não ter caractere
// combinante literal no código-fonte.
const DIACRITICOS = new RegExp("[\\u0300-\\u036f]", "g");
export const semAcento = (s: string): string => s.normalize("NFD").replace(DIACRITICOS, "");
