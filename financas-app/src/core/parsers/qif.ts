import type { ParsedStatement, ParsedTransaction } from '../types';
import { parseAmount, parseDate } from '../text';

/** Leitor de QIF (Quicken Interchange Format), ainda exportado por alguns bancos. */
export function looksLikeQif(text: string): boolean {
  return /^\s*!(Type|Account|Option)/im.test(text.slice(0, 500));
}

function qifDate(raw: string): string | null {
  // Formatos vistos: 25/12/2024, 12/25'24, 25/12/24, 2024-12-25
  const s = raw.replace(/'/g, '/').replace(/\s/g, '');
  const iso = parseDate(s);
  if (iso) return iso;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) return parseDate(`${m[2]}/${m[1]}/${m[3]}`);
  return null;
}

export function parseQif(text: string): ParsedStatement {
  const warnings: string[] = [];
  const transactions: ParsedTransaction[] = [];
  let cur: Partial<ParsedTransaction> & { payee?: string } = {};
  const flush = () => {
    if (cur.date && cur.amountCents !== undefined) {
      transactions.push({
        date: cur.date,
        description: cur.payee || cur.memo || 'Sem descrição',
        amountCents: cur.amountCents,
        memo: cur.payee && cur.memo ? cur.memo : undefined,
      });
    } else if (Object.keys(cur).length) {
      warnings.push('Lançamento QIF incompleto ignorado.');
    }
    cur = {};
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line || line.startsWith('!')) continue;
    const code = line[0];
    const value = line.slice(1).trim();
    switch (code) {
      case 'D': cur.date = qifDate(value) ?? undefined; break;
      case 'T': case 'U': {
        const a = parseAmount(value);
        if (a !== null) cur.amountCents = a;
        break;
      }
      case 'P': cur.payee = value; break;
      case 'M': cur.memo = value; break;
      case '^': flush(); break;
    }
  }
  flush();
  return { format: 'qif', transactions, warnings };
}
