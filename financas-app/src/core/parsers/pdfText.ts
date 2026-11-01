import type { ParsedStatement, ParsedTransaction } from '../types';
import { normalizeText, parseAmount, parseDate } from '../text';

/**
 * Interpreta o texto de um extrato ou fatura em PDF. O texto chega já agrupado
 * em linhas (ver `components/PdfTextExtractor`). Como cada banco tem um layout,
 * usamos heurísticas: linha que começa com data + descrição + valor(es).
 * O resultado sempre passa pela tela de revisão antes de ser importado.
 */

const DATE_RE = /^(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{1,2}\s?(?:JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)[A-Z]*\.?(?:\/?\s?\d{2,4})?|\d{4}-\d{2}-\d{2})\b\s*/i;
const MONEY_RE = /(?:^|\s)(\(?[-+]?\s?(?:R\$\s?)?\d{1,3}(?:\.\d{3})*,\d{2}\)?(?:\s?[-+]|\s[DC]\b)?)(?=\s|$)/gi;
const SKIP = /^(SALDO|S A L D O|TOTAL|SUBTOTAL|LIMITE|PAGAMENTO MINIMO|VALOR MINIMO|ENCARGOS|TAXA DE JUROS|CET|IOF DE FINANCIAMENTO|DATA\b|LANCAMENTOS?\b|HISTORICO\b)/;
const INCOME_HINT = /\b(RECEBID[OA]|CREDITO|CRED\b|SALARIO|DEPOSITO|DEP\b|ESTORNO|RENDIMENTO|RESGATE|REEMBOLSO|DEVOLUCAO|PIX REC|TED REC|DOC REC|TRANSF(ERENCIA)? REC|PAGAMENTO RECEBIDO|PROVENTOS|CASHBACK)/;

function dominantYear(text: string): number {
  const counts = new Map<number, number>();
  for (const m of text.matchAll(/\b\d{1,2}\/\d{1,2}\/(\d{4})\b/g)) {
    const y = Number(m[1]);
    if (y > 1990 && y < 2200) counts.set(y, (counts.get(y) ?? 0) + 1);
  }
  for (const m of text.matchAll(/\b(?:JANEIRO|FEVEREIRO|MARCO|MARÇO|ABRIL|MAIO|JUNHO|JULHO|AGOSTO|SETEMBRO|OUTUBRO|NOVEMBRO|DEZEMBRO)\s*(?:DE\s*)?\/?\s*(\d{4})\b/gi)) {
    const y = Number(m[1]);
    counts.set(y, (counts.get(y) ?? 0) + 2);
  }
  if (counts.size === 0) return new Date().getFullYear();
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function moneyTokens(s: string): { value: number; raw: string; index: number; explicitSign: boolean }[] {
  const out: { value: number; raw: string; index: number; explicitSign: boolean }[] = [];
  for (const m of s.matchAll(MONEY_RE)) {
    const raw = m[1].trim();
    const value = parseAmount(raw);
    if (value === null) continue;
    out.push({ value, raw, index: (m.index ?? 0) + m[0].indexOf(m[1]), explicitSign: /[-+()]|\s[DC]$/i.test(raw) });
  }
  return out;
}

export function looksLikeCardBill(text: string): boolean {
  const n = normalizeText(text.slice(0, 6000));
  return /FATURA|CARTAO DE CREDITO|VENCIMENTO DA FATURA|LIMITE DE CREDITO|PAGAMENTO MINIMO/.test(n);
}

export interface PdfParseOptions {
  /** Força o modo fatura de cartão (valores positivos = gastos). */
  creditCard?: boolean;
}

export function parsePdfText(lines: string[], opts: PdfParseOptions = {}): ParsedStatement {
  const fullText = lines.join('\n');
  const year = dominantYear(fullText);
  const isCard = opts.creditCard ?? looksLikeCardBill(fullText);
  const warnings: string[] = [];
  const transactions: ParsedTransaction[] = [];
  let currentDate: string | null = null;
  let prevBalance: number | null = null;
  let sawTransaction = false;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    const norm = normalizeText(line);

    let rest = line;
    const dm = line.match(DATE_RE);
    let lineDate: string | null = null;
    if (dm) {
      lineDate = parseDate(dm[1].replace(/\s/g, ' '), year);
      if (lineDate) rest = line.slice(dm[0].length);
    }
    const tokens = moneyTokens(rest);

    // Linhas de saldo: guardam o saldo para inferir o sinal das próximas.
    if (/^(SALDO|S A L D O)/.test(normalizeText(rest))) {
      if (tokens.length) prevBalance = tokens[tokens.length - 1].value;
      if (lineDate) currentDate = lineDate;
      continue;
    }
    if (tokens.length === 0) {
      if (lineDate) currentDate = lineDate;
      continue;
    }
    const date = lineDate ?? (sawTransaction ? currentDate : null);
    if (!date) continue;

    let description = rest.slice(0, tokens[0].index).trim();
    // Remove uma segunda data (data do movimento x data do lançamento).
    description = description
      .replace(DATE_RE, '')
      .replace(/\s\d{1,2}\/\d{1,2}(\/\d{2,4})?$/, '')
      .replace(/\s[-–]\s*$/, '')
      .trim();
    const descNorm = normalizeText(description);
    if (!/[A-Z]{2,}/.test(descNorm) || SKIP.test(descNorm) || SKIP.test(norm)) continue;

    const amountTok = tokens[0];
    let amount = amountTok.value;
    const balanceTok = tokens.length >= 2 ? tokens[tokens.length - 1] : null;

    if (!amountTok.explicitSign) {
      let resolved = false;
      if (balanceTok && prevBalance !== null) {
        const diff = balanceTok.value - prevBalance;
        if (Math.abs(Math.abs(diff) - Math.abs(amount)) <= 1) {
          amount = diff >= 0 ? Math.abs(amount) : -Math.abs(amount);
          resolved = true;
        }
      }
      if (!resolved) {
        if (isCard) amount = INCOME_HINT.test(descNorm) || /PAGAMENTO/.test(descNorm) ? Math.abs(amount) : -Math.abs(amount);
        else amount = INCOME_HINT.test(descNorm) ? Math.abs(amount) : -Math.abs(amount);
      }
    } else if (isCard) {
      // Em faturas, "-", parênteses ou "C" indicam crédito/pagamento; o resto é compra.
      const credit = /[-()]|\sC$/i.test(amountTok.raw);
      amount = credit ? Math.abs(amount) : -Math.abs(amount);
    }
    if (balanceTok) prevBalance = balanceTok.value;
    if (amount === 0) continue;

    transactions.push({ date, description, amountCents: amount });
    currentDate = date;
    sawTransaction = true;
  }

  if (transactions.length === 0) {
    warnings.push('Nenhum lançamento reconhecido no PDF. Se for um PDF escaneado (imagem), exporte o extrato em OFX ou CSV pelo internet banking.');
  } else {
    warnings.push('PDF lido por aproximação: confira valores e sinais antes de importar.');
  }
  return { format: 'pdf', transactions, warnings, account: isCard ? { type: 'credit_card' } : undefined };
}
