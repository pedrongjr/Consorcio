import type { ParsedStatement, ParsedTransaction } from '../types';
import { normalizeText, parseAmount, parseDate } from '../text';

/**
 * Interpreta o texto de um extrato ou fatura em PDF. O texto chega já agrupado
 * em linhas (ver `components/PdfTextExtractor`). Como cada banco tem um layout,
 * usamos heurísticas: linha que começa com data + descrição + valor(es).
 * O resultado sempre passa pela tela de revisão antes de ser importado.
 */

// Datas no início da linha: 01/10/2024, 01/10, 01-10-2024, 01.10.2024, 2024-10-01,
// 01 OUT 2024, 01/out/2024, "1 de Outubro de 2024".
const MONTH_WORD = '(?:JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)[A-ZÇ]*\\.?';
const DATE_RE = new RegExp(
  `^(\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{2,4}|\\d{1,2}/\\d{1,2}(?![/\\d])|\\d{1,2}\\s+de\\s+${MONTH_WORD}(?:\\s+(?:de\\s+)?\\d{4})?|\\d{1,2}[\\s/-]?${MONTH_WORD}(?:[/\\s-]?\\d{2,4})?|\\d{4}-\\d{2}-\\d{2})(?![\\dA-Z])\\s*`,
  'i',
);
// Valores: "1.234,56", "-150,00", "150,00-", "R$ -150,00", "−R$ 150,00", "- R$ 150,00",
// "150,00 D", "150,00C", "150,00 (-)", "(150,00)".
const MONEY_RE = /(?:^|\s)((?:\(?[-+−–]\s?)?(?:R\$\s?)?[-−–]?\s?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}\)?(?:\s?\(\s?[-+−]\s?\)|\s?[-+](?=\s|$)|\s?[DC]\b)?)(?=\s|$)/gi;
const SKIP = /^(SALDO|S A L D O|TOTAL|SUBTOTAL|LIMITE|PAGAMENTO MINIMO|VALOR MINIMO|ENCARGOS|TAXA DE JUROS|CET|IOF DE FINANCIAMENTO|DATA\b|LANCAMENTOS?\b|HISTORICO\b|RESUMO|VALOR TOTAL|JUROS DO ROTATIVO|DISPONIVEL|RENDIMENTO LIQUIDO|RENDIMENTO DO PERIODO)/;
const INCOME_HINT = /\b(RECEBID[OA]|CREDITO|CRED\b|SALARIO|DEPOSITO|DEP\b|ESTORNO|RENDIMENTO|RESGATE|REEMBOLSO|DEVOLUCAO|PIX REC|TED REC|DOC REC|TRANSF(ERENCIA)? REC|PAGAMENTO RECEBIDO|PROVENTOS|CASHBACK)/;

function dominantYear(text: string): number {
  const counts = new Map<number, number>();
  for (const m of text.matchAll(/\b\d{1,2}[/.-]\d{1,2}[/.-](\d{4})\b|\b\d{1,2}\s+(?:DE\s+)?(?:JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)[A-ZÇ]*\.?\s+(?:DE\s+)?(\d{4})\b/gi)) {
    const y = Number(m[1] ?? m[2]);
    if (y > 1990 && y < 2200) counts.set(y, (counts.get(y) ?? 0) + 1);
  }
  for (const m of text.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)) {
    const y = Number(m[0].slice(0, 4));
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
    out.push({ value, raw, index: (m.index ?? 0) + m[0].indexOf(m[1]), explicitSign: /[-+()−–]|\s?[DC]$/i.test(raw) });
  }
  return out;
}

export function looksLikeCardBill(text: string): boolean {
  const n = normalizeText(text.slice(0, 6000));
  // "Pagamento de fatura" num extrato de conta não faz dele uma fatura: exige marcas do cabeçalho da fatura.
  return /VENCIMENTO DA FATURA|TOTAL DA FATURA|RESUMO DA FATURA|FATURA DO CARTAO|LIMITE DE CREDITO|LIMITE TOTAL|PAGAMENTO MINIMO|VALOR MINIMO|FATURA (DE|ATUAL|FECHADA)|CARTAO DE CREDITO.*VENCIMENTO|VENCIMENTO.*CARTAO DE CREDITO/.test(n);
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
    // Lote, documento, número do lançamento antes do histórico ("13105 99015 Pix - Enviado").
    .replace(/^(?:\d{3,12}\s+)+(?=\S*[A-Za-zÀ-ú])/, '');
  d = d
    .split(' ')
    .filter((tok) => !(/[*•]/.test(tok) && /\d{2}/.test(tok)) && !/[*•]{2}/.test(tok) && !/^\d{3}\.\d{3}(?:[.\-*•+]*[\d*•+]*)$/.test(tok) && !/^[+]\d+$/.test(tok))
    .join(' ');
  // Número de documento/operação no fim ("PIX RECEBIDO 112233"): não identifica o lançamento.
  d = d.replace(/(?:\s+(?:\d{5,}|0+))+\s*$/, '');
  return d.replace(/\s[-–]\s*$/, '').replace(/\s+/g, ' ').trim();
}

const OCR_DIGIT: Record<string, string> = { O: '0', o: '0', D: '0', l: '1', I: '1', i: '1', B: '8', S: '5', s: '5' };

/**
 * CPF/CNPJ na descrição, inteiro ou mascarado ("***.616.981-**",
 * "616.9B1*+*"), no formato "***616981**" (só os dígitos visíveis do meio).
 */
export function extractDocument(text: string): string | null {
  for (const raw of text.split(/\s+/)) {
    const tok = raw.replace(/•/g, '*');
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
type Section = 'in' | 'out' | null;
type TxRow = {
  kind: 'tx'; date: string; description: string; descNorm: string; memo: string | null;
  amountTok: MoneyTok | null; balanceTok: MoneyTok | null;
  /** Seção do extrato em que o lançamento está ("Entradas"/"Saídas"), para o sinal. */
  section: Section;
  /** A data veio sem ano (01/10, 01 OUT): o ano foi deduzido. */
  yearless: boolean;
};
type Row = { kind: 'balance'; date: string | null; balance: number; opening: boolean; closing: boolean } | TxRow;

/**
 * Cabeçalho de seção que define o sinal dos valores sem sinal: "Total de
 * entradas" / "Total de saídas" (Nubank), "Créditos" / "Débitos",
 * "Pagamentos e créditos" / "Compras" (faturas).
 */
function sectionOf(norm: string, isCard: boolean): Section {
  const words = norm.replace(/[^A-Z ]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 6) return null;
  if (/^(TOTAL DE |TOTAL )?(ENTRADAS|CREDITOS|RECEBIMENTOS|DEPOSITOS|VALORES RECEBIDOS)\b/.test(norm)) return 'in';
  if (isCard && /^(TOTAL DE |TOTAL )?(PAGAMENTOS|PAGAMENTOS E CREDITOS|CREDITOS E ESTORNOS|ESTORNOS)\b/.test(norm)) return 'in';
  if (/^(TOTAL DE |TOTAL )?(SAIDAS|DEBITOS|VALORES PAGOS)\b/.test(norm)) return 'out';
  if (isCard && /^(TOTAL DE |TOTAL )?(COMPRAS|LANCAMENTOS|DESPESAS|COMPRAS E SAQUES|LANCAMENTOS NACIONAIS|LANCAMENTOS INTERNACIONAIS)\b/.test(norm)) return 'out';
  if (!isCard && /^(TOTAL DE |TOTAL )?(PAGAMENTOS|COMPRAS)\b/.test(norm) && words.length <= 3) return 'out';
  return null;
}

/** Linhas de cabeçalho/rodapé que nunca são parte de um lançamento. */
const JUNK = /^(PAGINA|PAG\.? ?\d|FOLHA\b|EXTRATO|AGENCIA|AG\b|CONTA\b|CPF|CNPJ|CLIENTE|TITULAR|NOME\b|PERIODO|DATA\b|DIA\b|HISTORICO|DESCRICAO|LANCAMENTO|MOVIMENTA|SALDO|OUVIDORIA|SAC\b|CENTRAL|ATENDIMENTO|ALO\b|WWW|HTTP|EMITIDO|GERADO|VALOR\b|VALORES|DOCUMENTO|DOCTO|N[OU]? DOC|CREDITO \(|DEBITO \(|ENTRADAS|SAIDAS|DEFICIENTES|CAPITAIS|DEMAIS|PARA SUA SEGURANCA|INFORMACOES|AVISO|OBSERVACOES|CONTINUA|TRANSPORTE)/;

/** Rodapés de atendimento (telefones, SAC, ouvidoria, sites). */
const FOOTER = /\b(0800|4004|3003|4020|SAC|OUVIDORIA|DEFICIENCIA|DEFICIENTES|AUDITIVA|CENTRAL DE ATENDIMENTO|CAPITAIS E REGIOES|DEMAIS REGIOES|WWW\.|HTTPS?:|\.COM\.BR)\b|\b\d{4}[ -]\d{4}\b/;

/** Descrição fraca (sem palavra de 3+ letras ou só "REM:"/"DES:"): o texto principal está na linha de cima. */
function weakDescription(desc: string): boolean {
  const n = normalizeText(desc);
  return !/[A-Z]{3,}/.test(n.replace(/^(REM|DES|REMETENTE|FAVORECIDO|DESTINATARIO|PAGADOR|RECEBEDOR)\b:?/, '')) ||
    /^(REM|DES|REMETENTE|FAVORECIDO|DESTINATARIO|PAGADOR|RECEBEDOR)\b:?/.test(n);
}

function appendMemo(row: TxRow, text: string): void {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return;
  const doc = extractDocument(t);
  const extra = doc && !(row.memo ?? '').includes(doc) ? `${t} (CPF/CNPJ ${doc})` : t;
  row.memo = (row.memo ? `${row.memo} · ${extra}` : extra).slice(0, 500);
}

export function parsePdfText(lines: string[], opts: PdfParseOptions = {}): ParsedStatement {
  const st = parseLines(lines, opts);
  if (st.transactions.length) return st;
  // Layout desconhecido com a data no meio da linha ("PIX ENVIADO 01/10/2024 -150,00"):
  // tenta de novo com a data movida para o começo.
  const moved = lines.map((l) => {
    if (DATE_RE.test(l.trim()) || !moneyTokens(l).length) return l;
    const m = l.match(/(?:^|\s)(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})(?=\s)/);
    return m ? `${m[1]} ${l.replace(m[1], ' ')}` : l;
  });
  const retry = parseLines(moved, opts);
  return retry.transactions.length ? retry : st;
}

function parseLines(lines: string[], opts: PdfParseOptions): ParsedStatement {
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
  //
  // Funciona com os layouts mais comuns dos bancos brasileiros:
  // - data em toda linha (Itaú, Santander, Caixa, Sicredi, Mercado Pago, PicPay, C6);
  // - data só no primeiro lançamento do dia ou como cabeçalho do grupo (Bradesco, Nubank, Inter);
  // - descrição continuada na linha de baixo (Banco do Brasil, Bradesco, Nubank, Sicoob),
  //   que vai para o complemento — ou para a descrição, se a linha do valor não tiver texto;
  // - valores sem sinal em seções "Entradas"/"Saídas" ou em colunas Crédito/Débito
  //   (o sinal vem da seção, da coluna — marcada em `groupTextItems` — ou do saldo).
  const rows: Row[] = [];
  let currentDate: string | null = null;
  let currentYearless = false;
  let section: Section = null;
  let lastTx: TxRow | null = null;
  /** Linhas só de texto desde o último lançamento. */
  let pending: string[] = [];
  const flushPending = () => {
    if (lastTx) for (const p of pending) appendMemo(lastTx, p);
    pending = [];
  };
  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    const norm = normalizeText(line);

    let rest = line;
    const dm = line.match(DATE_RE);
    let lineDate: string | null = null;
    let lineYearless = false;
    if (dm) {
      lineYearless = !/\d{4}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2}/.test(dm[1]);
      lineDate = parseDate(dm[1].replace(/\s+/g, ' '), year);
      if (lineDate) rest = line.slice(dm[0].length);
      else rest = line;
    }
    const tokens = moneyTokens(rest);
    const restNorm = normalizeText(cleanPdfDescription(rest));

    // Seção "Entradas"/"Saídas" (com ou sem total): muda o sinal dos próximos valores sem sinal.
    const sec = sectionOf(restNorm.replace(/[-+−]?\s*(R\$\s*)?[\d.,]+\s*$/, '').trim(), isCard);
    if (sec && tokens.length <= 1) {
      flushPending();
      section = sec;
      if (lineDate) { currentDate = lineDate; currentYearless = lineYearless; }
      continue;
    }

    // Linhas de saldo: guardam o saldo para inferir o sinal e conferir valores.
    if (/^(SALDO|S A L D O)/.test(restNorm)) {
      flushPending();
      if (tokens.length) {
        rows.push({
          kind: 'balance', date: lineDate, balance: tokens[tokens.length - 1].value,
          opening: /^SALDO (ANTERIOR|INICIAL|EM CONTA ANTERIOR)/.test(restNorm),
          closing: /^SALDO (FINAL|ATUAL|DISPONIVEL EM|EM \d)/.test(restNorm),
        });
      }
      if (lineDate) { currentDate = lineDate; currentYearless = lineYearless; }
      continue;
    }

    if (tokens.length === 0) {
      if (lineDate) {
        // "Período: 01/10/2024 a 31/10/2024" não é data de lançamento.
        if (/\b(A|ATE|AO)\b/.test(normalizeText(rest)) && DATE_RE.test(rest.replace(/^.*?\b(?:a|até|ao)\s+/i, ''))) continue;
        if (/^\d{1,2}:\d{2}/.test(restNorm) && lastTx) {
          // "01/10 10:30 Fulano de Tal" (Banco do Brasil): detalhe do lançamento anterior.
          appendMemo(lastTx, rest);
          continue;
        }
        flushPending();
        currentDate = lineDate;
        currentYearless = lineYearless;
        // Data seguida de texto sem valor: descrição de um lançamento cujo valor vem na linha de baixo.
        if (restNorm && !/^(SEGUNDA|TERCA|QUARTA|QUINTA|SEXTA|SABADO|DOMINGO|HOJE|ONTEM)\b/.test(restNorm) && /[A-Z]{3,}/.test(restNorm) && !JUNK.test(restNorm)) {
          pending = [rest];
        }
        continue;
      }
      // Linha só de texto: detalhe do lançamento anterior ou início do próximo (decidido adiante).
      if (/[A-Za-zÀ-ú]{3,}/.test(line) && line.length <= 160 && !JUNK.test(restNorm) && !SKIP.test(restNorm) && !FOOTER.test(normalizeText(line))) {
        pending.push(line);
        if (pending.length > 3) { if (lastTx) appendMemo(lastTx, pending.shift()!); else pending.shift(); }
      }
      continue;
    }

    const date = lineDate ?? currentDate;
    if (!date) { pending = []; continue; }
    const yearless = lineDate ? lineYearless : currentYearless;

    // Remove uma segunda data (data do movimento x data do lançamento).
    const rawDesc = rest.slice(0, tokens[0].index).trim()
      .replace(DATE_RE, '')
      // Em extrato, uma 2ª data no fim é a data do movimento; em fatura, "2/3" é a parcela.
      .replace(isCard ? /$^/ : /\s\d{1,2}\/\d{1,2}(\/\d{2,4})?$/, '');
    let description = cleanPdfDescription(rawDesc);
    let memoText: string | null = null;
    if (pending.length && weakDescription(description)) {
      // Bradesco e outros: o histórico vem numa linha e o valor (com "REM: Fulano") na seguinte.
      memoText = description || null;
      description = cleanPdfDescription(pending.join(' '));
      pending = [];
    } else {
      flushPending();
    }
    const descNorm = normalizeText(description);
    if (!/[A-Z]{2,}/.test(descNorm) || SKIP.test(descNorm) || SKIP.test(norm.replace(DATE_RE, '').trim())) continue;

    let amountTok: MoneyTok | null = tokens[0];
    let balanceTok = tokens.length >= 2 ? tokens[tokens.length - 1] : null;
    // OCR: o único número é o saldo; o valor sai da diferença de saldos.
    if (opts.ocr && hasBalanceColumn && tokens.length === 1) {
      balanceTok = tokens[0];
      amountTok = null;
    }
    // CPF/CNPJ (às vezes mascarado) vai para o complemento: identifica transferências para si mesmo.
    const doc = extractDocument(rawDesc);
    const row: TxRow = { kind: 'tx', date, description, descNorm, memo: doc ? `CPF/CNPJ ${doc}` : null, amountTok, balanceTok, section, yearless };
    if (memoText) appendMemo(row, memoText);
    rows.push(row);
    lastTx = row;
    currentDate = date;
    currentYearless = yearless;
  }
  flushPending();

  // Virada de ano em datas sem ano (fatura de dezembro paga em janeiro, extrato
  // de dez/jan): se há meses do fim e do começo do ano, um dos lados muda de ano.
  const yl = rows.filter((r): r is TxRow => r.kind === 'tx' && r.yearless);
  const months = new Set(yl.map((r) => Number(r.date.slice(5, 7))));
  if ([11, 12].some((m) => months.has(m)) && [1, 2].some((m) => months.has(m))) {
    // Datas completas no texto (vencimento, período) dizem se o ano deduzido é o do fim ou do começo.
    const full = [...fullText.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/g)].map((m) => ({ y: +m[3], mo: +m[2] }));
    const latest = full.sort((a, b) => b.y - a.y || b.mo - a.mo)[0];
    const yearIsLater = !latest || (latest.y === year && latest.mo <= 3);
    for (const r of yl) {
      const mo = Number(r.date.slice(5, 7));
      const y = Number(r.date.slice(0, 4));
      if (yearIsLater && mo >= 9) r.date = `${y - 1}${r.date.slice(4)}`;
      else if (!yearIsLater && mo <= 4) r.date = `${y + 1}${r.date.slice(4)}`;
    }
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
  /** Índice do lançamento gerado por cada linha de `ordered`. */
  const rowTx: (number | null)[] = [];
  /** Lançamentos cujo sinal foi só um palpite (sem sinal, seção, coluna ou saldo da linha). */
  const guessed = new Set<number>();
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
    let guess = false;

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
          amount = signed(amountTok, amount, descNorm, isCard, row.section);
          guess = !amountTok.explicitSign && !row.section;
          prevOk = false;
          breaks.push(row.date);
        }
        prev = [bal];
      } else {
        amount = signed(amountTok, amount, descNorm, isCard, row.section);
          guess = !amountTok.explicitSign && !row.section;
        // Saldo que não fecha com o anterior: valor ou saldo mal lido, ou lançamento perdido no meio.
        if (hasBalanceColumn && bal !== null && prev.length === 1 && !isCard) breaks.push(row.date);
        if (bal !== null) { prev = [bal]; prevOk = false; }
      }
    }
    if (amount === 0) return;
    rowTx[idx] = transactions.length;
    if (guess) guessed.add(transactions.length);
    transactions.push({ date: row.date, description: row.description, amountCents: amount, ...(row.memo ? { memo: row.memo } : {}) });
  });

  // Sinais que eram palpite: entre dois saldos conhecidos ("saldo do dia",
  // saldo da linha), escolhe os sinais que fecham a conta — se houver uma só
  // combinação possível (Itaú e outros mostram créditos sem sinal).
  if (!isCard && guessed.size) {
    let anchor: number | null = null;
    let seg: number[] = [];
    const solve = (end: number) => {
      const g = seg.filter((i) => guessed.has(i));
      if (anchor === null || !g.length || g.length > 10) return;
      const fixed = seg.filter((i) => !guessed.has(i)).reduce((sum, i) => sum + transactions[i].amountCents, 0);
      const target = end - anchor - fixed;
      let found: number[] | null = null;
      let count = 0;
      for (let mask = 0; mask < 1 << g.length; mask++) {
        const signs = g.map((_, k) => ((mask >> k) & 1 ? 1 : -1));
        const sum = g.reduce((acc, i, k) => acc + signs[k] * Math.abs(transactions[i].amountCents), 0);
        if (near(sum, target)) { count++; found = signs; }
      }
      if (count === 1 && found) g.forEach((i, k) => { transactions[i].amountCents = found![k] * Math.abs(transactions[i].amountCents); });
    };
    ordered.forEach((row, idx) => {
      if (row.kind === 'balance') {
        solve(row.balance);
        anchor = row.balance;
        seg = [];
        return;
      }
      const ti = rowTx[idx];
      if (ti !== null && ti !== undefined) seg.push(ti);
      if (row.balanceTok) {
        solve(row.balanceTok.value);
        anchor = row.balanceTok.value;
        seg = [];
      }
    });
  }

  // Conferência: saldo inicial + lançamentos deve dar o saldo final. Se não
  // bater, algum lançamento pode ter sido perdido ou mal lido.
  const balances = ordered.map((r) => (r.kind === 'balance' ? r.balance : r.balanceTok?.value ?? null));
  const firstIdx = balances.findIndex((v) => v !== null);
  const opening = ordered.find((r) => r.kind === 'balance' && r.opening) as { balance: number } | undefined;
  const closing = [...balances].reverse().find((v) => v !== null) ?? null;
  let reconcileGap: number | null = null;
  const explicitClosing = ordered.find((r) => r.kind === 'balance' && r.closing) as { balance: number } | undefined;
  if (opening && explicitClosing && transactions.length && !isCard) {
    // "Saldo inicial" e "Saldo final" informados (Nubank, Inter...): confere mesmo sem coluna de saldo.
    const sum = transactions.reduce((s, t) => s + t.amountCents, 0);
    if (!near(opening.balance + sum, explicitClosing.balance)) reconcileGap = explicitClosing.balance - (opening.balance + sum);
  } else if (hasBalanceColumn && closing !== null && firstIdx >= 0) {
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
function signed(tok: MoneyTok, amount: number, descNorm: string, isCard: boolean, section: Section = null): number {
  if (isCard) {
    if (tok.explicitSign) {
      // Em faturas, "-", parênteses ou "C" indicam crédito/pagamento; o resto é compra.
      return /[-()−–]|\s?C$/i.test(tok.raw) ? Math.abs(amount) : -Math.abs(amount);
    }
    if (section) return section === 'in' ? Math.abs(amount) : -Math.abs(amount);
    return INCOME_HINT.test(descNorm) || /PAGAMENTO/.test(descNorm) ? Math.abs(amount) : -Math.abs(amount);
  }
  if (tok.explicitSign) return amount;
  // Seção "Entradas"/"Saídas" do extrato (Nubank e outros) define o sinal.
  if (section) return section === 'in' ? Math.abs(amount) : -Math.abs(amount);
  return INCOME_HINT.test(descNorm) ? Math.abs(amount) : -Math.abs(amount);
}
