import type { ParsedStatement, ParsedTransaction } from '../types';
import { parseDate, toCents } from '../text';

/**
 * Leitor de OFX 1.x (SGML, tags sem fechamento) e OFX 2.x (XML).
 * Cobre extratos de conta corrente (STMTRS) e de cartão de crédito (CCSTMTRS),
 * que é como a maioria dos bancos brasileiros exporta ("Money", "OFX", "Quicken").
 */

function tagValue(block: string, tag: string): string | undefined {
  // Em SGML o valor vai até a próxima tag ou quebra de linha; em XML até </TAG>.
  const re = new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i');
  const m = block.match(re);
  if (!m) return undefined;
  const v = decodeEntities(m[1].trim());
  return v === '' ? undefined : v;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/gi, '&');
}

/** OFX usa ponto decimal, mas alguns bancos brasileiros exportam com vírgula. */
function ofxAmount(raw: string | undefined): number | null {
  if (!raw) return null;
  let s = raw.replace(/\s/g, '');
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? toCents(n) : null;
}

function blocks(text: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}>([\\s\\S]*?)(?=</${tag}>|<${tag}>|</BANKTRANLIST>|$)`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[1]);
  return out;
}

export function looksLikeOfx(text: string): boolean {
  const head = text.slice(0, 2000).toUpperCase();
  return head.includes('OFXHEADER') || head.includes('<OFX>') || /<\?OFX\b/i.test(head);
}

export function parseOfx(text: string): ParsedStatement {
  const warnings: string[] = [];
  const transactions: ParsedTransaction[] = [];
  const upper = text.toUpperCase();
  const isCard = upper.includes('<CCSTMTRS>') || upper.includes('<CCACCTFROM>');

  for (const b of blocks(text, 'STMTTRN')) {
    const date = parseDate(tagValue(b, 'DTPOSTED') ?? tagValue(b, 'DTUSER') ?? '');
    const amount = ofxAmount(tagValue(b, 'TRNAMT'));
    if (!date || amount === null) {
      warnings.push('Lançamento OFX ignorado por falta de data ou valor.');
      continue;
    }
    const name = tagValue(b, 'NAME');
    const memo = tagValue(b, 'MEMO');
    // Muitos bancos põem o histórico só no MEMO; outros, só no NAME.
    let description = name ?? memo ?? tagValue(b, 'PAYEE') ?? 'Sem descrição';
    let extraMemo: string | undefined;
    if (name && memo && memo !== name) {
      if (memo.toUpperCase().includes(name.toUpperCase())) description = memo;
      else if (!name.toUpperCase().includes(memo.toUpperCase())) extraMemo = memo;
    }
    transactions.push({
      date,
      description,
      amountCents: amount,
      externalId: tagValue(b, 'FITID') ?? undefined,
      memo: extraMemo ?? tagValue(b, 'CHECKNUM'),
    });
  }

  if (transactions.length === 0) warnings.push('Nenhum lançamento encontrado no arquivo OFX.');

  const ledger = text.match(/<LEDGERBAL>([\s\S]*?)(<\/LEDGERBAL>|<AVAILBAL>|<\/STMTRS>|<\/CCSTMTRS>|$)/i);
  const balanceCents = ledger ? ofxAmount(tagValue(ledger[1], 'BALAMT')) ?? undefined : undefined;
  const acctType = tagValue(text, 'ACCTTYPE')?.toUpperCase();

  return {
    format: 'ofx',
    transactions,
    account: {
      bankId: tagValue(text, 'BANKID'),
      branchId: tagValue(text, 'BRANCHID'),
      accountId: tagValue(text, 'ACCTID'),
      currency: tagValue(text, 'CURDEF'),
      type: isCard ? 'credit_card' : acctType === 'SAVINGS' ? 'savings' : 'checking',
    },
    balanceCents,
    warnings,
  };
}
