import type { ParsedStatement, ParsedTransaction } from '../types';
import { normalizeText, parseAmount, parseDate } from '../text';

/**
 * Interpreta o texto de um extrato ou fatura em PDF. O texto chega já agrupado
 * em linhas (ver `components/PdfTextExtractor`). Como cada banco tem um layout,
 * usamos heurísticas: linha que começa com data + descrição + valor(es).
 * O resultado sempre passa pela tela de revisão antes de ser importado.
 */

const DATE_RE = /^(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{1,2}\s?(?:JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)[A-Z]*\.?(?:\/?\s?\d{2,4})?|\d{4}-\d{2}-\d{2})\b\s*/i;
const MONEY_RE = /(?:^|\s)(\(?[-+]?\s?(?:R\$\s?)?(?:\d{1,3}(?:\.\d{3})*|\d+),\d{2}\)?(?:\s?[-+]|\s?[DC]\b)?)(?=\s|$)/gi;
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
    out.push({ value, raw, index: (m.index ?? 0) + m[0].indexOf(m[1]), explicitSign: /[-+()]|\s?[DC]$/i.test(raw) });
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
  /** O texto veio de OCR (PDF escaneado ou foto). */
  ocr?: boolean;
  /** Formato a registrar no resultado. */
  format?: 'pdf' | 'image';
}

/**
 * Limpa a descrição de colunas que não interessam: hora ("- 07:55:10"),
 * número do documento ("060755") e CPF/CNPJ mascarado ("***.616.981***").
 */
export function cleanPdfDescription(description: string): string {
  let d = description
    .replace(/^[-–]?\s*\d{1,2}:\d{2}(?::\d{2})?\b\s*/, '')
    .replace(/^\d{4,8}\s+(?=\S*[A-Za-zÀ-ú])/, '');
  d = d
    .split(' ')
    .filter((tok) => !(/\*/.test(tok) && /\d{2}/.test(tok)) && !/\*\*/.test(tok) && !/^\d{3}\.\d{3}/.test(tok) && !/^[+]\d+$/.test(tok))
    .join(' ');
  return d.replace(/\s[-–]\s*$/, '').replace(/\s+/g, ' ').trim();
}

type MoneyTok = ReturnType<typeof moneyTokens>[number];
type Row =
  | { kind: 'balance'; date: string | null; balance: number; opening: boolean }
  | { kind: 'tx'; date: string; description: string; descNorm: string; amountTok: MoneyTok | null; balanceTok: MoneyTok | null };

export function parsePdfText(lines: string[], opts: PdfParseOptions = {}): ParsedStatement {
  const fullText = lines.join('\n');
  const year = dominantYear(fullText);
  const isCard = opts.creditCard ?? looksLikeCardBill(fullText);
  const warnings: string[] = [];
  const transactions: ParsedTransaction[] = [];

  // Extratos com coluna de saldo: a maioria das linhas datadas tem 2 valores.
  // No OCR, uma linha com um valor só provavelmente perdeu o valor e ficou com o saldo.
  const dated = lines.filter((l) => DATE_RE.test(l.trim()) && !/SALDO/i.test(l)).map((l) => moneyTokens(l.trim().replace(DATE_RE, '')).length).filter((n) => n > 0);
  const hasBalanceColumn = !isCard && dated.length >= 3 && dated.filter((n) => n >= 2).length / dated.length >= 0.6;

  // 1ª passada: linhas → lançamentos e saldos, na ordem do arquivo.
  const rows: Row[] = [];
  let currentDate: string | null = null;
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
    const restNorm = normalizeText(cleanPdfDescription(rest));

    // Linhas de saldo: guardam o saldo para inferir o sinal e conferir valores.
    if (/^(SALDO|S A L D O)/.test(restNorm)) {
      if (tokens.length) rows.push({ kind: 'balance', date: lineDate, balance: tokens[tokens.length - 1].value, opening: /^SALDO (ANTERIOR|INICIAL)/.test(restNorm) });
      if (lineDate) currentDate = lineDate;
      continue;
    }
    if (tokens.length === 0) {
      if (lineDate) currentDate = lineDate;
      continue;
    }
    const date = lineDate ?? (sawTransaction ? currentDate : null);
    if (!date) continue;

    // Remove uma segunda data (data do movimento x data do lançamento).
    const description = cleanPdfDescription(
      rest.slice(0, tokens[0].index).trim()
        .replace(DATE_RE, '')
        .replace(/\s\d{1,2}\/\d{1,2}(\/\d{2,4})?$/, ''),
    );
    const descNorm = normalizeText(description);
    if (!/[A-Z]{2,}/.test(descNorm) || SKIP.test(descNorm) || SKIP.test(norm)) continue;

    let amountTok: MoneyTok | null = tokens[0];
    let balanceTok = tokens.length >= 2 ? tokens[tokens.length - 1] : null;
    // OCR: o único número é o saldo; o valor sai da diferença de saldos.
    if (opts.ocr && hasBalanceColumn && tokens.length === 1) {
      balanceTok = tokens[0];
      amountTok = null;
    }
    rows.push({ kind: 'tx', date, description, descNorm, amountTok, balanceTok });
    currentDate = date;
    sawTransaction = true;
  }

  // 2ª passada: extratos do mais novo para o mais antigo (Caixa, por exemplo)
  // são invertidos para que o saldo anterior venha antes de cada lançamento.
  const txDates = rows.filter((r) => r.kind === 'tx').map((r) => r.date as string);
  let up = 0;
  let down = 0;
  for (let i = 1; i < txDates.length; i++) {
    if (txDates[i] > txDates[i - 1]) up++;
    else if (txDates[i] < txDates[i - 1]) down++;
  }
  const descending = down > up;
  const ordered = descending
    ? [...rows.filter((r) => r.kind === 'balance' && r.opening), ...rows.filter((r) => !(r.kind === 'balance' && r.opening)).reverse()]
    : rows;
  const balanceOf = (r: Row | undefined) => (!r ? null : r.kind === 'balance' ? r.balance : r.balanceTok?.value ?? null);

  // 3ª passada: valores e sinais, conferindo com a coluna de saldo.
  let prevBalance: number | null = null;
  let inferredFromBalance = 0;
  let corrected = 0;
  ordered.forEach((row, idx) => {
    if (row.kind === 'balance') {
      prevBalance = row.balance;
      return;
    }
    const { amountTok, balanceTok, descNorm } = row;
    const diff = balanceTok && prevBalance !== null ? balanceTok.value - prevBalance : null;
    let amount: number;

    if (!amountTok) {
      if (diff === null) {
        if (balanceTok) prevBalance = balanceTok.value;
        return;
      }
      amount = diff;
      inferredFromBalance++;
    } else {
      amount = amountTok.value;
      const matches = diff !== null && Math.abs(Math.abs(diff) - Math.abs(amount)) <= 1;
      if (matches) {
        if (!isCard) amount = diff! >= 0 ? Math.abs(amount) : -Math.abs(amount);
      } else if (opts.ocr && diff !== null && diff !== 0 && hasBalanceColumn) {
        // Valor lido diferente da variação do saldo. Só corrige se o saldo
        // desta linha também bate com o próximo lançamento (senão o erro de
        // leitura pode estar no próprio saldo).
        const next = ordered.slice(idx + 1).find((r) => balanceOf(r) !== null);
        const nb = balanceOf(next);
        const confirmed = next && nb !== null && (next.kind === 'balance'
          ? Math.abs(nb - balanceTok!.value) <= 1
          : !!next.amountTok && Math.abs(Math.abs(nb - balanceTok!.value) - Math.abs(next.amountTok.value)) <= 1);
        if (confirmed) {
          amount = diff;
          corrected++;
        } else {
          amount = signed(amountTok, amount, descNorm, isCard);
        }
      } else {
        amount = signed(amountTok, amount, descNorm, isCard);
      }
    }
    if (balanceTok) prevBalance = balanceTok.value;
    if (amount === 0) return;
    transactions.push({ date: row.date, description: row.description, amountCents: amount });
  });
  if (descending) transactions.reverse();

  if (transactions.length === 0) {
    warnings.push(opts.ocr
      ? 'Nenhum lançamento reconhecido pelo OCR. Use uma imagem nítida, reta e bem iluminada, ou exporte o extrato em OFX/CSV.'
      : 'Nenhum lançamento reconhecido no PDF. Exporte o extrato em OFX ou CSV pelo internet banking.');
  } else if (opts.ocr) {
    if (inferredFromBalance) warnings.push(`${inferredFromBalance} valor(es) não foram lidos e foram calculados pela diferença de saldo.`);
    if (corrected) warnings.push(`${corrected} valor(es) lidos com erro foram corrigidos pela diferença de saldo.`);
    warnings.push('Texto lido por OCR (reconhecimento de imagem): confira datas, valores e sinais com atenção antes de importar.');
  } else {
    warnings.push('PDF lido por aproximação: confira valores e sinais antes de importar.');
  }
  return { format: opts.format ?? 'pdf', transactions, warnings, account: isCard ? { type: 'credit_card' } : undefined };
}

/** Sinal do valor quando o saldo não ajuda: indicador explícito ou palavras-chave. */
function signed(tok: MoneyTok, amount: number, descNorm: string, isCard: boolean): number {
  if (isCard) {
    if (tok.explicitSign) {
      // Em faturas, "-", parênteses ou "C" indicam crédito/pagamento; o resto é compra.
      return /[-()]|\s?C$/i.test(tok.raw) ? Math.abs(amount) : -Math.abs(amount);
    }
    return INCOME_HINT.test(descNorm) || /PAGAMENTO/.test(descNorm) ? Math.abs(amount) : -Math.abs(amount);
  }
  if (tok.explicitSign) return amount;
  return INCOME_HINT.test(descNorm) ? Math.abs(amount) : -Math.abs(amount);
}
