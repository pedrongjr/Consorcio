import type { ParsedStatement } from '../types';
import { parseTable, type Cell, type TableParseOptions } from './table';

/** Escolhe o separador mais consistente entre `;`, `,`, tab e `|`. */
export function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 30);
  let best = ',';
  let bestScore = -1;
  for (const d of [';', ',', '\t', '|']) {
    const counts = lines.map((l) => splitCsvLine(l, d).length);
    const multi = counts.filter((c) => c > 1);
    if (multi.length === 0) continue;
    // Prioriza o separador que gera o mesmo número de colunas em mais linhas.
    const freq = new Map<number, number>();
    for (const c of multi) freq.set(c, (freq.get(c) ?? 0) + 1);
    const [cols, times] = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
    const score = times * 10 + cols;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

export function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

export function csvToRows(text: string): Cell[][] {
  const delimiter = detectDelimiter(text);
  // Junta linhas quebradas dentro de aspas.
  const rows: Cell[][] = [];
  let buffer = '';
  for (const line of text.replace(/^﻿/, '').split(/\r?\n/)) {
    buffer = buffer ? `${buffer}\n${line}` : line;
    const quotes = (buffer.match(/"/g) ?? []).length;
    if (quotes % 2 === 1) continue;
    rows.push(splitCsvLine(buffer, delimiter));
    buffer = '';
  }
  if (buffer) rows.push(splitCsvLine(buffer, delimiter));
  return rows;
}

export function parseCsv(text: string, opts?: TableParseOptions): ParsedStatement {
  return parseTable(csvToRows(text), 'csv', opts);
}
