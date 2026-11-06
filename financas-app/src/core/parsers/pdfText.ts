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

const OCR_DIGIT: Record<string, string> = { O: '0', o: '0', D: '0', l: '1', I: '1', i: '1', B: '8', S: '5', s: '5' };

/**
 * CPF/CNPJ na descrição, inteiro ou mascarado ("***.616.981-**",
 * "616.9B1*+*"), no formato "***616981**" (só os dígitos visíveis do meio).
 */
export function extractDocument(text: string): string | null {
  for (const tok of text.split(/\s+/)) {
    const t = tok.replace(/[OolIiBSsD]/g, (c) => OCR_DIGIT[c] ?? c);
    // CPF completo
    let m = t.match(/^\*+(\d{6})\*+$/);
    if (m) return `***${m[1]}**`;
    m = t.match(/^\*{0,3}(\d{3})\.?(\d{3})\.?(\d{3})-?(\d{2})$/);
    if (m) return `***${m[2]}${m[3]}**`;
    // Mascarado: "***.616.981-**", "616.981*+*" ou só "616.981" (o OCR perde os asteriscos).
    m = t.match(/^[*+]{0,4}\.?(\d{3})\.(\d{3})(?:[-*+.]+\d{0,2}[-*+]*)?$/);
    if (m) return `***${m[1]}${m[2]}**`;
  }
  return null;
}

/** Nome do titular no cabeçalho do extrato ("Cliente FULANO", "Titular: FULANO"). */
export function extractHolderName(lines: string[]): string | null {
  for (const l of lines.slice(0, 40)) {
    const m = l.match(/^\s*(?:CLIENTE|TITULAR|CORRENTISTA|NOME(?: DO CLIENTE)?)\s*:?\s+([A-ZÀ-Úa-zà-ú][A-ZÀ-Úa-zà-ú' ]{5,80})$/i);
    if (m) {
      const name = m[1].replace(/\s+/g, ' ').trim();
      if (name.split(' ').length >= 2) return name.toUpperCase();
    }
  }
  return null;
}

type MoneyTok = ReturnType<typeof moneyTokens>[number];
type Row =
  | { kind: 'balance'; date: string | null; balance: number; opening: boolean }
  | { kind: 'tx'; date: string; description: string; descNorm: string; memo: string | null; amountTok: MoneyTok | null; balanceTok: MoneyTok | null };

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
    const rawDesc = rest.slice(0, tokens[0].index).trim()
      .replace(DATE_RE, '')
      .replace(/\s\d{1,2}\/\d{1,2}(\/\d{2,4})?$/, '');
    const description = cleanPdfDescription(rawDesc);
    // CPF/CNPJ (às vezes mascarado) vai para o complemento: identifica transferências para si mesmo.
    const doc = extractDocument(rawDesc);
    const descNorm = normalizeText(description);
    if (!/[A-Z]{2,}/.test(descNorm) || SKIP.test(descNorm) || SKIP.test(norm)) continue;

    let amountTok: MoneyTok | null = tokens[0];
    let balanceTok = tokens.length >= 2 ? tokens[tokens.length - 1] : null;
    // OCR: o único número é o saldo; o valor sai da diferença de saldos.
    if (opts.ocr && hasBalanceColumn && tokens.length === 1) {
      balanceTok = tokens[0];
      amountTok = null;
    }
    rows.push({ kind: 'tx', date, description, descNorm, memo: doc ? `CPF/CNPJ ${doc}` : null, amountTok, balanceTok });
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

  // 3ª passada: valores e sinais, conferindo com a coluna de saldo.
  //
  // `prev` guarda os candidatos a saldo anterior. Normalmente é um só; quando
  // a linha "SALDO DIA" discorda do saldo do último lançamento (um dos dois foi
  // mal lido), ficam os dois e vale o que bater com o valor lido a seguir.
  // `prevOk` diz se o saldo anterior foi confirmado por um valor lido — só
  // então um valor lido diferente da variação do saldo pode ser corrigido.
  let prev: number[] = [];
  let prevOk = false;
  let lastRowWasTx = false;
  let inferredFromBalance = 0;
  let corrected = 0;
  const breaks: string[] = [];
  const near = (a: number, b: number) => Math.abs(a - b) <= 1;
  ordered.forEach((row, idx) => {
    if (row.kind === 'balance') {
      if (lastRowWasTx && prev.length && !prev.some((p) => near(p, row.balance))) {
        prev = [...prev, row.balance];
        prevOk = false;
      } else if (!prev.length || !lastRowWasTx) {
        prev = [row.balance];
        prevOk = false;
      }
      lastRowWasTx = false;
      return;
    }
    lastRowWasTx = true;
    const { amountTok, balanceTok, descNorm } = row;
    const bal = balanceTok?.value ?? null;
    let amount: number;

    if (!amountTok) {
      // Só o saldo foi lido: o valor é a diferença, se não houver dúvida sobre o saldo anterior.
      if (bal === null || prev.length !== 1 || near(bal, prev[0])) {
        if (bal !== null) { prev = [bal]; prevOk = false; }
        return;
      }
      amount = bal - prev[0];
      inferredFromBalance++;
      prev = [bal];
      prevOk = false;
    } else {
      amount = amountTok.value;
      const match = bal === null ? undefined : prev.find((p) => near(Math.abs(bal - p), Math.abs(amount)));
      if (match !== undefined && bal !== null) {
        if (!isCard) amount = bal - match >= 0 ? Math.abs(amount) : -Math.abs(amount);
        prev = [bal];
        prevOk = true;
      } else if (opts.ocr && hasBalanceColumn && bal !== null && prev.length === 1 && prevOk && !near(bal, prev[0])) {
        // Valor lido diferente da variação do saldo, com o saldo anterior
        // confirmado. Só corrige se o saldo desta linha também bate com o
        // próximo lançamento (senão o erro de leitura pode estar no saldo).
        const next = ordered.slice(idx + 1).find((r) => r.kind === 'tx' ? !!r.balanceTok && !!r.amountTok : true);
        const confirmed = !!next && (next.kind === 'balance'
          ? near(next.balance, bal)
          : near(Math.abs(next.balanceTok!.value - bal), Math.abs(next.amountTok!.value)));
        if (confirmed) {
          amount = bal - prev[0];
          corrected++;
          prevOk = true;
        } else {
          amount = signed(amountTok, amount, descNorm, isCard);
          prevOk = false;
          breaks.push(row.date);
        }
        prev = [bal];
      } else {
        amount = signed(amountTok, amount, descNorm, isCard);
        // Saldo que não fecha com o anterior: valor ou saldo mal lido, ou lançamento perdido no meio.
        if (hasBalanceColumn && bal !== null && prev.length === 1 && !isCard) breaks.push(row.date);
        if (bal !== null) { prev = [bal]; prevOk = false; }
      }
    }
    if (amount === 0) return;
    transactions.push({ date: row.date, description: row.description, amountCents: amount, ...(row.memo ? { memo: row.memo } : {}) });
  });

  // Conferência: saldo inicial + lançamentos deve dar o saldo final. Se não
  // bater, algum lançamento pode ter sido perdido ou mal lido.
  const balances = ordered.map((r) => (r.kind === 'balance' ? r.balance : r.balanceTok?.value ?? null));
  const firstIdx = balances.findIndex((v) => v !== null);
  const opening = ordered.find((r) => r.kind === 'balance' && r.opening) as { balance: number } | undefined;
  const closing = [...balances].reverse().find((v) => v !== null) ?? null;
  let reconcileGap: number | null = null;
  if (hasBalanceColumn && closing !== null && firstIdx >= 0) {
    const firstRow = ordered[firstIdx];
    // Saldo antes do primeiro lançamento: o "saldo anterior" ou o da primeira linha menos o valor dela.
    const start = opening?.balance ?? null;
    if (start !== null && firstRow) {
      const sum = transactions.reduce((s, t) => s + t.amountCents, 0);
      if (!near(start + sum, closing)) reconcileGap = closing - (start + sum);
    }
  }
  if (descending) transactions.reverse();

  if (transactions.length === 0) {
    warnings.push(opts.ocr
      ? 'Nenhum lançamento reconhecido pelo OCR. Use uma imagem nítida, reta e bem iluminada, ou exporte o extrato em OFX/CSV.'
      : 'Nenhum lançamento reconhecido no PDF. Exporte o extrato em OFX ou CSV pelo internet banking.');
  } else if (opts.ocr) {
    if (reconcileGap !== null) {
      warnings.push(`Atenção: o saldo inicial mais os lançamentos lidos não dá o saldo final do extrato (diferença de ${brl(reconcileGap)}). Algum lançamento pode ter sido perdido ou mal lido: compare com o PDF antes de importar.`);
    }
    if (breaks.length) {
      const days = [...new Set(breaks)].map((d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`).join(', ');
      warnings.push(`O saldo não fecha com o valor lido em ${breaks.length} linha(s) (${days}): confira essas datas no PDF.`);
    }
    if (inferredFromBalance) warnings.push(`${inferredFromBalance} valor(es) não foram lidos e foram calculados pela diferença de saldo.`);
    if (corrected) warnings.push(`${corrected} valor(es) lidos com erro foram corrigidos pela diferença de saldo.`);
    warnings.push('Texto lido por OCR (reconhecimento de imagem): confira datas, valores e sinais com atenção antes de importar.');
  } else {
    if (reconcileGap !== null) {
      warnings.push(`Atenção: o saldo inicial mais os lançamentos lidos não dá o saldo final do extrato (diferença de ${brl(reconcileGap)}). Confira com o PDF antes de importar.`);
    }
    warnings.push('PDF lido por aproximação: confira valores e sinais antes de importar.');
  }
  const holderName = extractHolderName(lines);
  return {
    format: opts.format ?? 'pdf', transactions, warnings,
    account: isCard ? { type: 'credit_card' } : undefined,
    ...(holderName ? { holderName } : {}),
  };
}

const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

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
