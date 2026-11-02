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

const OCR_DIGIT: Record<string, string> = { O: '0', o: '0', D: '0', l: '1', I: '1', i: '1', '|': '1', S: '5', s: '5', B: '8' };
const fixDigits = (s: string) => s.replace(/[OoDlIi|SsB]/g, (c) => OCR_DIGIT[c]);

/**
 * Corrige confusões comuns do OCR apenas em valores e datas (letra O no lugar
 * de zero, l/I no lugar de 1, "RS" no lugar de "R$", espaço como separador de
 * milhar), sem mexer nas descrições.
 */
export function cleanOcrLine(line: string): string {
  let s = line
    // "R S 10,00", "RS 10,00", "R5 10,00" → "R$ 10,00"
    .replace(/\bR\s?[S5]\s?(?=[-\d(OoIl])/g, 'R$ ')
    // "1 234,56" → "1234,56" (milhar separado por espaço)
    .replace(/(\d)\s(\d{3}[.,]\d{2})\b/g, '$1$2')
    // "10, 00" → "10,00"
    .replace(/(\d)([.,])\s(\d{2})\b/g, '$1$2$3');
  const toks = s
    .split(' ')
    // Menos lido como aspas ou travessão: "“35,00", "—35,00" → "-35,00"
    .map((tok) => tok.replace(/^[“”"'‘’–—~¬]+(?=[\dOo])/, '-'))
    .map((tok) => {
      // Valores: precisam terminar em ,dd ou .dd e ter ao menos 2 dígitos reais.
      const m = tok.match(/^([-+(]?(?:R\$)?)([\dOoDlIi|SsB.,]+)([)-]?)$/);
      if (m && /[.,][\dOoIl]{2}$/.test(m[2]) && (m[2].match(/\d/g) ?? []).length >= 2) return m[1] + fixDigits(m[2]) + m[3];
      // Datas: dd/mm ou dd/mm/aaaa
      if (/^[\dOoIl]{1,2}\/[\dOoIl]{1,2}(\/[\dOoIl]{2,4})?$/.test(tok) && /\d/.test(tok)) return fixDigits(tok);
      return tok;
    })
    // Traços e barras soltos costumam ser bordas de tabela lidas como texto.
    .filter((tok) => !/^[—–_|¦:;'"`~.,]+$/.test(tok));
  // Vírgula perdida: "-2780 3.001,93" → "-27,80 3.001,93" (só com sinal, para
  // não confundir com números de loja na descrição).
  for (let i = 0; i < toks.length - 1; i++) {
    if (/^-\d{3,7}$/.test(toks[i]) && /\d[.,]\d{2}[)-]?$/.test(toks[i + 1])) toks[i] = `${toks[i].slice(0, -2)},${toks[i].slice(-2)}`;
  }
  s = toks.join(' ');
  return s.replace(/\s+/g, ' ').trim();
}

export function cleanOcrLines(lines: string[]): string[] {
  return lines.map(cleanOcrLine).filter(Boolean);
}
