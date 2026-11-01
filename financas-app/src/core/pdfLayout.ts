/** Trecho de texto de uma página de PDF, como o pdf.js entrega. */
export interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Agrupa os trechos de uma página em linhas visuais: mesma altura (y) com
 * tolerância, ordenados da esquerda para a direita, com espaço entre trechos
 * separados por uma lacuna.
 */
export function groupTextItems(items: PdfTextItem[]): string[] {
  const valid = items.filter((i) => i.str && i.str.trim());
  if (valid.length === 0) return [];
  const sorted = [...valid].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: PdfTextItem[][] = [];
  for (const it of sorted) {
    const tol = Math.max(2, (it.height || 8) * 0.45);
    const row = rows.find((r) => Math.abs(r[0].y - it.y) <= tol);
    if (row) row.push(it);
    else rows.push([it]);
  }
  rows.sort((a, b) => b[0].y - a[0].y);
  return rows.map((r) => {
    r.sort((a, b) => a.x - b.x);
    let line = '';
    let lastEnd = -Infinity;
    for (const it of r) {
      const gap = it.x - lastEnd;
      if (line && gap > Math.max(1, (it.height || 8) * 0.15) && !line.endsWith(' ') && !it.str.startsWith(' ')) line += ' ';
      line += it.str;
      lastEnd = it.x + it.width;
    }
    return line.replace(/\s+/g, ' ').trim();
  }).filter(Boolean);
}
