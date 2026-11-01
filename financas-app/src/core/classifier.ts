import type { CategoryRule, ParsedTransaction } from './types';
import { descriptionKey, normalizeText } from './text';
import { UNCATEGORIZED_EXPENSE, UNCATEGORIZED_INCOME } from './categories';

export interface Classification {
  categoryKey: string;
  /** Regra que decidiu, ou `null` quando caiu em "Outros". */
  rule: CategoryRule | null;
  confidence: 'user' | 'rule' | 'history' | 'none';
}

/** Lançamento já categorizado pelo usuário, usado para aprender por semelhança. */
export interface HistoryEntry {
  descriptionKey: string;
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

  constructor(rules: CategoryRule[], history: HistoryEntry[] = []) {
    this.compiled = rules.filter((r) => r.pattern.trim()).map(compile).sort((a, b) => b.weight - a.weight);
    for (const h of history) {
      if (!h.descriptionKey) continue;
      const entry = this.history.get(h.descriptionKey) ?? {};
      entry[h.direction] = h.categoryKey; // o mais recente vence
      this.history.set(h.descriptionKey, entry);
    }
  }

  classify(tx: Pick<ParsedTransaction, 'description' | 'amountCents' | 'memo'>): Classification {
    const direction: 'in' | 'out' = tx.amountCents >= 0 ? 'in' : 'out';
    const text = normalizeText(`${tx.description} ${tx.memo ?? ''}`);

    // 1) Regras criadas pelo usuário
    // 2) Lançamentos idênticos que o usuário já categorizou (aprendizado)
    // 3) Regras padrão por palavra-chave
    for (const c of this.compiled) {
      if (c.rule.source !== 'user') break;
      if (c.rule.direction && c.rule.direction !== direction) continue;
      if (c.re.test(text)) return { categoryKey: c.rule.categoryKey, rule: c.rule, confidence: 'user' };
    }
    const learned = this.history.get(descriptionKey(tx.description))?.[direction];
    if (learned) return { categoryKey: learned, rule: null, confidence: 'history' };
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
 * Sugere um padrão de regra a partir de uma descrição, removendo prefixos
 * genéricos de meio de pagamento ("COMPRA CARTAO", "PIX ENVIADO", ...).
 */
export function suggestRulePattern(description: string): string {
  let key = descriptionKey(description);
  key = key
    .replace(/^(COMPRA(S)? (COM )?(CARTAO|CART|DEB(ITO)?|CRED(ITO)?|ELO|VISA|MASTER(CARD)?)( (DEB|CRED|ELETRON))?|COMPRA|PAG(AMENTO|TO)? (DE )?(BOLETO|TITULO|CONTA)|DEBITO AUTOMATICO|DEB AUTOM?|PIX (ENVIADO|RECEBIDO|TRANSF|QRS?|QR CODE)|TRANSF(ERENCIA)? PIX|PIX|TED|DOC|ELO|VISA|MASTERCARD|APLICACAO|DEB|CRED) +/, '')
    .replace(/\b(BR|BRA|SAO PAULO|RIO DE JANEIRO|SP|RJ|MG|LTDA|S A|SA|ME|EIRELI|EPP)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = key.split(' ').filter(Boolean);
  return words.slice(0, 3).join(' ');
}
