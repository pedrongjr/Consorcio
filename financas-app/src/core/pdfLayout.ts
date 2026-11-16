/** Trecho de texto de uma página de PDF, como o pdf.js entrega. */
export interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Agrupa os trechos de uma página em linhas visuais, ordenados da esquerda
 * para a direita, com espaço entre trechos separados por uma lacuna.
 *
 * Dois trechos ficam na mesma linha quando as faixas verticais se sobrepõem
 * em boa parte. Comparar só a base (y) falha no OCR: "6,00" tem a vírgula
 * descendo abaixo da linha e o Tesseract devolve a caixa mais baixa que a
 * do "D" ao lado, o que jogava valor e saldo para uma linha separada.
 */
export function groupTextItems(items: PdfTextItem[]): string[] {
  // Cópias: a marcação de colunas crédito/débito altera `str`.
  const valid = items.filter((i) => i.str && i.str.trim()).map((i) => ({ ...i }));
  if (valid.length === 0) return [];
  const h = (i: PdfTextItem) => Math.max(1, i.height || 8);
  const mid = (i: PdfTextItem) => i.y + h(i) / 2;
  const sorted = [...valid].sort((a, b) => mid(b) - mid(a) || a.x - b.x);
  const rows: { lo: number; hi: number; items: PdfTextItem[] }[] = [];
  for (const it of sorted) {
    const lo = it.y;
    const hi = it.y + h(it);
    const row = rows.find((r) => {
      const overlap = Math.min(hi, r.hi) - Math.max(lo, r.lo);
      return overlap >= 0.5 * Math.min(hi - lo, r.hi - r.lo) || Math.abs(r.lo - lo) <= Math.max(2, h(it) * 0.2);
    });
    if (row) row.items.push(it);
    else rows.push({ lo, hi, items: [it] });
  }
  rows.sort((a, b) => b.hi + b.lo - a.hi - a.lo);
  markCreditDebitColumns(rows.map((r) => r.items));
  return rows.map(({ items: r }) => {
    r.sort((a, b) => a.x - b.x);
    let line = '';
    let lastEnd = -Infinity;
    for (const it of r) {
      const gap = it.x - lastEnd;
      // Colunas vizinhas de valores (valor e saldo) às vezes encostam: "150,00850,00".
      const moneyThenNumber = /\d,\d{2}$/.test(line) && /^[-+(]?\d/.test(it.str.trim());
      if (line && (gap > Math.max(1, (it.height || 8) * 0.15) || moneyThenNumber) && !line.endsWith(' ') && !it.str.startsWith(' ')) line += ' ';
      line += it.str;
      lastEnd = it.x + it.width;
    }
    return line.replace(/\s+/g, ' ').trim();
  }).filter(Boolean);
}

const plain = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
const UNSIGNED_MONEY = /^(R\$\s?)?(\d{1,3}(\.\d{3})+|\d+),\d{2}$/;

/**
 * Extratos com colunas separadas de crédito e débito (Bradesco, Itaú, Banco do
 * Brasil em alguns modelos) trazem valores sem sinal: o sinal está na coluna.
 * Ao achar o cabeçalho "Crédito"/"Débito" (ou "Entradas"/"Saídas"), cada valor
 * sem sinal abaixo dele ganha "+" ou "-" conforme a coluna mais próxima; os da
 * coluna "Saldo" ficam como estão. Vale até o próximo cabeçalho.
 */
function markCreditDebitColumns(rows: PdfTextItem[][]): void {
  type Cols = { inX: number[]; outX: number[]; balX: number[] | null };
  let cols: Cols | null = null;
  const xs = (i: PdfTextItem) => [i.x + i.width / 2, i.x + i.width];
  for (const row of rows) {
    const cIn = row.find((i) => /^(CREDITO|CREDITOS|ENTRADAS?|VALOR DE ENTRADA)\b/.test(plain(i.str)));
    const cOut = row.find((i) => /^(DEBITO|DEBITOS|SAIDAS?|VALOR DE SAIDA)\b/.test(plain(i.str)));
    if (cIn && cOut && cIn !== cOut) {
      const bal = row.find((i) => /^SALDO\b/.test(plain(i.str)));
      cols = { inX: xs(cIn), outX: xs(cOut), balX: bal ? xs(bal) : null };
      continue;
    }
    if (!cols) continue;
    const c: Cols = cols;
    for (const it of row) {
      const str = it.str.trim();
      if (!UNSIGNED_MONEY.test(str)) continue;
      const [mid, right] = xs(it);
      const dist = (p: number[]) => Math.min(Math.abs(mid - p[0]), Math.abs(right - p[1]));
      const dIn = dist(c.inX);
      const dOut = dist(c.outX);
      const dBal = c.balX ? dist(c.balX) : Infinity;
      if (dBal < dIn && dBal < dOut) continue;
      it.str = (dIn <= dOut ? '+' : '-') + str;
    }
  }
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
    .replace(/(\d)([.,])\s(\d{2})\b/g, '$1$2$3')
    // "4090,/13C" → "4090,13C" (barra de borda lida no meio do número)
    .replace(/(\d,)[\/|](\d{2})/g, '$1$2')
    // "9,59C" → "9,59 C" (indicador de crédito/débito colado, como na Caixa)
    .replace(/(\d[.,]\d{2})([CD])(?=\s|$)/g, '$1 $2')
    // "7429C" / "7.07045C" → vírgula perdida antes do indicador colado
    .replace(/(?:^|\s|R\$)(\d[\d.]{2,9})([CD])(?=\s|$)/g, (m, n: string, cd: string) => m.replace(n + cd, `${n} ${cd}`));
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
  // Barra no lugar da vírgula depois de um valor: "0,00 C 74/29" → "74,29".
  for (let i = 1; i < toks.length; i++) {
    if (/^\d{1,3}(\.\d{3})*\/\d{2}$/.test(toks[i]) && toks.slice(0, i).some((t) => /\d,\d{2}$/.test(t))) toks[i] = toks[i].replace('/', ',');
  }
  // Vírgula perdida antes de C/D: "1200 D 9,59 C" → "12,00 D 9,59 C".
  for (let i = 0; i < toks.length - 1; i++) {
    const m = toks[i].match(/^(R\$)?(\d[\d.]{2,9})$/);
    if (m && !/^\d{1,3}(\.\d{3})+$/.test(m[2]) && /^[CD]$/.test(toks[i + 1])) {
      const d = m[2].replace(/\./g, '');
      toks[i] = `${m[1] ?? ''}${d.slice(0, -2)},${d.slice(-2)}`;
    }
  }
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
