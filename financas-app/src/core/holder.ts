import { extractDocument } from './parsers/pdfText';
import { normalizeText } from './text';

/**
 * Titular das contas: nomes e os 6 dígitos do meio do CPF (os que os bancos
 * mostram no CPF mascarado, "***.616.981-**"). Um PIX/TED para ou de alguém
 * com o seu nome ou CPF é dinheiro mudando de uma conta sua para outra:
 * transferência, que não conta como gasto nem receita.
 */
export interface Holder {
  names: string[];
  /** 6 dígitos do meio do CPF, ou null. O CPF completo nunca é guardado. */
  cpfMiddle: string | null;
}

/** Palavras que não identificam a pessoa ("DA", "DOS"...). */
const NAME_STOPWORDS = new Set(['DA', 'DE', 'DO', 'DAS', 'DOS', 'E', 'D']);

/** Receitas que vêm "em nome do titular", mas são renda de verdade (salário, benefícios...). */
export const SELF_INCOME_EXCLUDE = /\b(SALARIO|SAL|PROVENTOS?|FOLHA|VENCIMENTOS?|BENEFICIO|INSS|FGTS|RESTITUICAO|IRPF|DECIMO|13O|FERIAS|RESCISAO|PLR|BOLSA|APOSENTADORIA|PENSAO|PREMIO|RENDIMENTOS?|JUROS|DIVIDENDOS?|ESTORNO|REEMBOLSO|CASHBACK)\b/;

function nameTokens(name: string): string[] {
  return normalizeText(name).replace(/[^A-Z ]/g, ' ').split(/\s+/).filter((t) => t && !NAME_STOPWORDS.has(t));
}

/**
 * O texto cita o titular pelo nome? Exige o primeiro nome como palavra
 * inteira e mais um sobrenome (aceitando abreviação do banco/OCR, como
 * "GLO" para "GLORIA").
 */
export function mentionsName(text: string, name: string): boolean {
  const want = nameTokens(name);
  if (want.length < 2) return false;
  const have = normalizeText(text).replace(/[^A-Z ]/g, ' ').split(/\s+/).filter(Boolean);
  const first = have.indexOf(want[0]);
  if (first < 0) return false;
  const rest = have.slice(first + 1, first + 8);
  return want.slice(1).some((w) => rest.some((h) => h === w || (h.length >= 3 && w.startsWith(h))));
}

/** O texto traz o CPF do titular (inteiro ou mascarado)? */
export function mentionsCpf(text: string, cpfMiddle: string | null): boolean {
  if (!cpfMiddle || !/^\d{6}$/.test(cpfMiddle)) return false;
  return extractDocument(text) === `***${cpfMiddle}**` ||
    text.split(/\s+/).some((tok) => extractDocument(tok) === `***${cpfMiddle}**`);
}

export function mentionsHolder(text: string, holder: Holder | null | undefined): boolean {
  if (!holder) return false;
  return mentionsCpf(text, holder.cpfMiddle) || holder.names.some((n) => mentionsName(text, n));
}

/**
 * Transferência para/de si mesmo: cita o titular e não é uma receita própria
 * (salário, benefício, rendimento...).
 */
export function isSelfTransfer(t: { description: string; memo?: string | null; amountCents: number }, holder: Holder | null | undefined): boolean {
  const text = `${t.description} ${t.memo ?? ''}`;
  if (!mentionsHolder(text, holder)) return false;
  return !SELF_INCOME_EXCLUDE.test(normalizeText(text));
}

/** "123.616.981-00" → "616981"; aceita só os 6 dígitos também. */
export function cpfMiddleDigits(input: string): string | null {
  const d = input.replace(/\D/g, '');
  if (d.length === 11) return d.slice(3, 9);
  if (d.length === 6) return d;
  return null;
}

/** Normaliza a lista de nomes digitada (um por linha), sem repetir. */
export function cleanNames(names: string[]): string[] {
  const out: string[] = [];
  for (const n of names) {
    const v = normalizeText(n).replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (nameTokens(v).length >= 2 && !out.includes(v)) out.push(v);
  }
  return out.slice(0, 10);
}
