// Utilitário genérico de CSV: monta o texto e dispara o download no browser.
// Usa ; como separador (Excel pt-BR) e BOM UTF-8 para acentos abrirem certo.

export interface CsvCol<T> {
  label: string;
  value: (row: T) => unknown;
}

const esc = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv<T>(rows: T[], cols: CsvCol<T>[]): string {
  const head = cols.map((c) => c.label).join(";");
  const body = rows.map((r) => cols.map((c) => esc(c.value(r))).join(";"));
  return [head, ...body].join("\n");
}

export function baixarCsv<T>(nome: string, rows: T[], cols: CsvCol<T>[]) {
  const blob = new Blob(["﻿" + toCsv(rows, cols)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome.endsWith(".csv") ? nome : nome + ".csv";
  a.click();
  URL.revokeObjectURL(url);
}
