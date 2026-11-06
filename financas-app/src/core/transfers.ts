import { normalizeText } from './text';
import type { CategoryKind } from './types';

/**
 * Transferências entre contas do próprio usuário: a saída de uma conta e a
 * entrada na outra são o mesmo dinheiro. Ligamos os dois lançamentos (par)
 * para mostrar "de qual conta para qual" e não contar como gasto/receita.
 */

/** Diferença máxima, em dias, entre a saída e a entrada de uma transferência. */
export const TRANSFER_WINDOW_DAYS = 4;

/** Palavras que costumam aparecer em transferências, aplicações e pagamento de fatura. */
export const TRANSFER_HINT = /\b(TRANSF\w*|TED|DOC|PIX|APLIC\w*|RESGATE|PAGAMENTO|PAGTO|PGTO|FATURA|DEPOSITO|POUPANCA|INVEST\w*|CDB|MESMA TITULARIDADE|ENVIAD[OA]|RECEBID[OA]|RECEBIMENTO|CREDITO EM CONTA|DEB AUTOMATICO)\b/;

export interface TransferCandidate {
  id: number;
  account_id: number;
  account_type: string;
  date: string;
  amount_cents: number;
  description: string;
  memo: string | null;
  category_key: string | null;
  category_kind: CategoryKind | null;
  category_source: string;
}

export interface TransferPair {
  outId: number;
  inId: number;
  categoryKey: string;
}

export function daysBetween(a: string, b: string): number {
  const d = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return Math.round(Math.abs(d(a) - d(b)) / 86400000);
}

/** Categoria do par conforme os tipos de conta (fatura, aplicação ou transferência). */
export function transferCategoryFor(typeA: string, typeB: string, current: (string | null)[] = []): string {
  const keep = current.find((k) => k === 'pagamento_fatura' || k === 'investimentos' || k === 'transferencias');
  if (keep) return keep;
  if (typeA === 'credit_card' || typeB === 'credit_card') return 'pagamento_fatura';
  if (typeA === 'investment' || typeB === 'investment') return 'investimentos';
  return 'transferencias';
}

/** Lançamento que pode ser metade de uma transferência automática. */
function eligible(t: TransferCandidate): boolean {
  // Classificado à mão como gasto/receita: o usuário já decidiu, não mexemos.
  if (t.category_source === 'user' && t.category_kind && t.category_kind !== 'transfer') return false;
  return t.amount_cents !== 0;
}

function looksLikeTransfer(t: TransferCandidate): boolean {
  return t.category_kind === 'transfer' || TRANSFER_HINT.test(normalizeText(`${t.description} ${t.memo ?? ''}`));
}

/**
 * Encontra pares saída/entrada entre contas diferentes: valores opostos,
 * datas próximas e ao menos um lado com cara de transferência. Só liga
 * quando o par é único dos dois lados (sem ambiguidade).
 */
export function findTransferPairs(txs: TransferCandidate[]): TransferPair[] {
  const pool = txs.filter(eligible);
  const incoming = new Map<number, TransferCandidate[]>();
  for (const t of pool) {
    if (t.amount_cents > 0) {
      const list = incoming.get(t.amount_cents) ?? [];
      list.push(t);
      incoming.set(t.amount_cents, list);
    }
  }
  const matchesOf = (o: TransferCandidate) => (incoming.get(-o.amount_cents) ?? []).filter(
    (i) => i.account_id !== o.account_id && daysBetween(i.date, o.date) <= TRANSFER_WINDOW_DAYS && (looksLikeTransfer(o) || looksLikeTransfer(i)),
  );
  const outgoing = pool.filter((t) => t.amount_cents < 0);
  const outsFor = new Map<number, number>();
  const candidates = outgoing.map((o) => ({ o, ins: matchesOf(o) }));
  for (const { ins } of candidates) for (const i of ins) outsFor.set(i.id, (outsFor.get(i.id) ?? 0) + 1);

  const pairs: TransferPair[] = [];
  for (const { o, ins } of candidates) {
    if (ins.length !== 1) continue;
    const i = ins[0];
    if (outsFor.get(i.id) !== 1) continue;
    pairs.push({ outId: o.id, inId: i.id, categoryKey: transferCategoryFor(o.account_type, i.account_type, [o.category_key, i.category_key]) });
  }
  return pairs;
}

/** Descrição do lançamento criado na outra conta. */
export function mirrorDescription(amountCents: number, accountName: string): string {
  // O espelho tem o sinal oposto: se saiu daqui, entra lá vindo "de" esta conta.
  return amountCents < 0 ? `Transferência de ${accountName}` : `Transferência para ${accountName}`;
}

/** Texto curto "Conta A → Conta B" de um lançamento de transferência. */
export function transferLabel(amountCents: number, accountName: string, otherName: string | null): string {
  if (!otherName) return amountCents < 0 ? `${accountName} → ?` : `? → ${accountName}`;
  return amountCents < 0 ? `${accountName} → ${otherName}` : `${otherName} → ${accountName}`;
}
