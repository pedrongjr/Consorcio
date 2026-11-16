import type { CategoryRule, ParsedTransaction } from './types';
import { descriptionKey, normalizeText } from './text';
import { UNCATEGORIZED_EXPENSE, UNCATEGORIZED_INCOME } from './categories';
import { isSelfTransfer, type Holder } from './holder';

export interface Classification {
  categoryKey: string;
  /** Regra que decidiu, ou `null` quando caiu em "Outros". */
  rule: CategoryRule | null;
  confidence: 'user' | 'rule' | 'history' | 'none';
}

/** Lançamento já categorizado pelo usuário, usado para aprender por semelhança. */
export interface HistoryEntry {
  /** `similarityKey(descrição, complemento)`; vazio = genérico, ignorado. */
  key: string;
  categoryKey: string;
  direction: 'in' | 'out';
}

interface CompiledRule {
  rule: CategoryRule;
  re: RegExp;
  weight: number;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * O padrão sempre precisa começar no início de uma palavra. Padrões curtos
 * (até 4 letras) ou terminados em espaço também precisam terminar em fim de
 * palavra — assim "BET" não casa com "BETO", mas "SUPERMERC" casa com "SUPERMERCADOS".
 */
function compile(rule: CategoryRule): CompiledRule {
  const raw = normalizeText(rule.pattern);
  const needsEnd = /[A-Z0-9]$/.test(raw) && (raw.length <= 4 || /\s$/.test(rule.pattern));
  const body = escapeRe(raw).replace(/ /g, '\\s+');
  const re = new RegExp(`(?:^|[^A-Z0-9])${body}${needsEnd ? '(?=$|[^A-Z0-9])' : ''}`);
  const weight = (rule.source === 'user' ? 1000 : 0) + (rule.priority ?? 0) + raw.length;
  return { rule, re, weight };
}

export class Classifier {
  private compiled: CompiledRule[];
  private history = new Map<string, { in?: string; out?: string }>();

  /** Titular das contas (nome/CPF): PIX/TED para si mesmo vira transferência. */
  private holder: Holder | null;
  /** Categoria usada para transferências para si mesmo (se existir para o usuário). */
  private selfCategory: string | null;

  constructor(rules: CategoryRule[], history: HistoryEntry[] = [], opts: { holder?: Holder | null; selfCategory?: string | null } = {}) {
    this.holder = opts.holder ?? null;
    this.selfCategory = opts.selfCategory === undefined ? 'transferencias' : opts.selfCategory;
    this.compiled = rules.filter((r) => r.pattern.trim()).map(compile).sort((a, b) => b.weight - a.weight);
    for (const h of history) {
      if (!h.key) continue;
      const entry = this.history.get(h.key) ?? {};
      entry[h.direction] = h.categoryKey; // o mais recente vence
      this.history.set(h.key, entry);
    }
  }

  classify(tx: Pick<ParsedTransaction, 'description' | 'amountCents' | 'memo'>): Classification {
    const direction: 'in' | 'out' = tx.amountCents >= 0 ? 'in' : 'out';
    const text = normalizeText(`${tx.description} ${tx.memo ?? ''}`);

    // 1) Regras criadas pelo usuário
    // 2) Lançamentos idênticos que o usuário já categorizou (aprendizado)
    // 2b) Transferência para/de você mesmo (nome ou CPF do titular)
    // 3) Regras padrão por palavra-chave
    for (const c of this.compiled) {
      if (c.rule.source !== 'user') break;
      if (c.rule.direction && c.rule.direction !== direction) continue;
      if (c.re.test(text)) return { categoryKey: c.rule.categoryKey, rule: c.rule, confidence: 'user' };
    }
    const simKey = similarityKey(tx.description, tx.memo);
    const learned = simKey ? this.history.get(simKey)?.[direction] : undefined;
    if (learned) return { categoryKey: learned, rule: null, confidence: 'history' };
    // 2b) Para/de você mesmo (nome ou CPF do titular): transferência entre contas suas.
    if (this.selfCategory && this.holder && isSelfTransfer(tx, this.holder)) {
      return { categoryKey: this.selfCategory, rule: null, confidence: 'rule' };
    }
    for (const c of this.compiled) {
      if (c.rule.source === 'user') continue;
      if (c.rule.direction && c.rule.direction !== direction) continue;
      if (c.re.test(text)) return { categoryKey: c.rule.categoryKey, rule: c.rule, confidence: 'rule' };
    }
    return {
      categoryKey: direction === 'in' ? UNCATEGORIZED_INCOME : UNCATEGORIZED_EXPENSE,
      rule: null,
      confidence: 'none',
    };
  }
}

/**
 * Palavras que só descrevem o meio de pagamento ("PIX ENVIADO", "COMPRA CARTAO
 * DEBITO", "TED"...). Uma descrição ou regra feita só delas vale para quase
 * tudo — não serve para identificar um lançamento.
 */
const GENERIC_WORDS = new Set(`
  PIX ENVIADO ENVIADA ENVIADOS RECEBIDO RECEBIDA RECEBIDOS ENVIO RECEB REMETIDO TRANSF TRANSFERENCIA TRANSFERENCIAS
  TRANSFERIDO TRANSFERIDA TRANSFER TED DOC TEV QR QRS QRCODE CODE CHAVE PAGAMENTO PAGAMENTOS PAGTO PGTO PAG PAGO
  COMPRA COMPRAS CARTAO CART CARD DEBITO DEB CREDITO CRED ELO VISA MASTER MASTERCARD MAESTRO ELECTRON BOLETO
  BOLETOS TITULO TITULOS CONTA CONTAS AUTOMATICO AUTOMATICA AUTOM AUT ELETRONICO ELETRONICA ELETRON SAIDA ENTRADA
  LANCAMENTO OPERACAO MOV MOVIMENTACAO AGENDADO AGENDADA AGENDAMENTO INTERNET APP MOBILE CEL ONLINE BCO BANCO
  INSTITUICAO TITULARIDADE MESMA OUTRA OUTRO CPF CNPJ AG AGENCIA CC CP DE DA DO DAS DOS PARA PELO PELA EM COM
  NO NA NOS NAS E A O VIA REF DEST REM FAV FAVORECIDO
`.split(/\s+/).filter(Boolean));

/** Palavras significativas (sem números soltos nem letras isoladas). */
function meaningfulWords(text: string): string[] {
  return descriptionKey(text).split(' ').filter((w) => w.length > 1 && !/^\d+$/.test(w));
}

/** `true` quando o texto só tem palavras de meio de pagamento (ex.: "PIX ENVIADO"). */
export function isGenericText(text: string): boolean {
  return meaningfulWords(text).every((w) => GENERIC_WORDS.has(w));
}

/**
 * Chave para achar lançamentos "iguais" a este. Usa a descrição; se ela for
 * genérica (muitos bancos põem só "PIX ENVIADO" e o nome no complemento),
 * inclui o complemento. Se ainda assim for genérica, devolve '' — não há como
 * dizer quais lançamentos são semelhantes.
 */
export function similarityKey(description: string, memo?: string | null): string {
  const k = descriptionKey(description);
  if (!isGenericText(k)) return k;
  if (memo?.trim()) {
    const k2 = descriptionKey(`${description} ${memo}`);
    if (!isGenericText(k2)) return k2;
  }
  return '';
}

/**
 * Sugere um padrão de regra a partir de uma descrição, removendo as palavras
 * de meio de pagamento ("COMPRA CARTAO", "PIX ENVIADO", ...). Devolve '' quando
 * não sobra nada que identifique o lançamento.
 */
export function suggestRulePattern(description: string, memo?: string | null): string {
  const text = isGenericText(description) && memo ? `${description} ${memo}` : description;
  const words = descriptionKey(text)
    .replace(/\b(BR|BRA|SAO PAULO|RIO DE JANEIRO|SP|RJ|MG|LTDA|S A|SA|ME|EIRELI|EPP)\b/g, ' ')
    .split(' ')
    .filter((w) => w.length > 1 && !/^\d+$/.test(w));
  // Remove o prefixo de meio de pagamento e mantém o que vem depois.
  let i = 0;
  while (i < words.length && GENERIC_WORDS.has(words[i])) i++;
  return words.slice(i, i + 3).join(' ');
}

/** Texto para exibir: se a descrição for genérica ("PIX ENVIADO"), junta o complemento (nome de quem recebeu). */
export function displayDescription(description: string, memo?: string | null): string {
  return memo?.trim() && isGenericText(description) ? `${description} · ${memo.trim()}` : description;
}
