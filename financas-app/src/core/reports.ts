import type { CategoryKind } from './types';

/** Lançamento no formato mínimo usado pelos relatórios. */
export interface ReportTx {
  date: string; // YYYY-MM-DD
  amountCents: number;
  categoryKey: string | null;
}

export interface ReportCategory {
  key: string;
  name: string;
  kind: CategoryKind;
  parent?: string | null;
  color: string;
  icon: string;
}

export interface MonthSummary {
  month: string; // YYYY-MM
  incomeCents: number;
  expenseCents: number; // positivo
  balanceCents: number;
}

/** Categoria-raiz de uma chave (subcategoria → categoria). */
export function rootKey(key: string, cats: Map<string, ReportCategory>): string {
  let cur = cats.get(key);
  const guard = new Set<string>();
  while (cur?.parent && !guard.has(cur.key)) {
    guard.add(cur.key);
    const p = cats.get(cur.parent);
    if (!p) break;
    cur = p;
  }
  return cur?.key ?? key;
}

function kindOf(tx: ReportTx, cats: Map<string, ReportCategory>): CategoryKind {
  const c = tx.categoryKey ? cats.get(tx.categoryKey) : undefined;
  return c?.kind ?? (tx.amountCents >= 0 ? 'income' : 'expense');
}

/**
 * Receitas e despesas por mês. Transferências (entre contas, pagamento de
 * fatura, aplicações) ficam de fora para não contar o mesmo dinheiro duas vezes.
 * Estornos em categorias de despesa reduzem a despesa (como no Minhas Economias).
 */
export function monthlySummary(txs: ReportTx[], cats: Map<string, ReportCategory>): MonthSummary[] {
  const map = new Map<string, MonthSummary>();
  for (const t of txs) {
    const kind = kindOf(t, cats);
    if (kind === 'transfer') continue;
    const month = t.date.slice(0, 7);
    const m = map.get(month) ?? { month, incomeCents: 0, expenseCents: 0, balanceCents: 0 };
    if (kind === 'income') m.incomeCents += t.amountCents;
    else m.expenseCents -= t.amountCents;
    m.balanceCents = m.incomeCents - m.expenseCents;
    map.set(month, m);
  }
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export interface CategoryTotal {
  key: string;
  name: string;
  color: string;
  icon: string;
  totalCents: number; // positivo para despesas
  share: number; // 0..1
  children: CategoryTotal[];
}

/** Total de despesas (ou receitas) por categoria e subcategoria. */
export function totalsByCategory(
  txs: ReportTx[],
  cats: Map<string, ReportCategory>,
  kind: 'expense' | 'income' = 'expense',
): CategoryTotal[] {
  const byLeaf = new Map<string, number>();
  for (const t of txs) {
    if (kindOf(t, cats) !== kind) continue;
    const key = t.categoryKey ?? (kind === 'expense' ? 'outros_gastos' : 'outras_receitas');
    const v = kind === 'expense' ? -t.amountCents : t.amountCents;
    byLeaf.set(key, (byLeaf.get(key) ?? 0) + v);
  }
  const roots = new Map<string, CategoryTotal>();
  for (const [key, total] of byLeaf) {
    const rk = rootKey(key, cats);
    const rc = cats.get(rk);
    const root = roots.get(rk) ?? {
      key: rk, name: rc?.name ?? rk, color: rc?.color ?? '#999', icon: rc?.icon ?? 'pricetag',
      totalCents: 0, share: 0, children: [],
    };
    root.totalCents += total;
    if (key !== rk) {
      const c = cats.get(key);
      root.children.push({ key, name: c?.name ?? key, color: c?.color ?? root.color, icon: c?.icon ?? root.icon, totalCents: total, share: 0, children: [] });
    }
    roots.set(rk, root);
  }
  const list = [...roots.values()].filter((r) => r.totalCents > 0).sort((a, b) => b.totalCents - a.totalCents);
  const sum = list.reduce((s, r) => s + r.totalCents, 0) || 1;
  for (const r of list) {
    r.share = r.totalCents / sum;
    r.children.sort((a, b) => b.totalCents - a.totalCents);
    for (const c of r.children) c.share = r.totalCents ? c.totalCents / r.totalCents : 0;
  }
  return list;
}

export interface BudgetProgress {
  categoryKey: string;
  limitCents: number;
  spentCents: number;
  ratio: number;
  status: 'ok' | 'warning' | 'over';
}

/** Compara gastos do mês com o orçamento definido por categoria-raiz. */
export function budgetProgress(
  budgets: { categoryKey: string; limitCents: number }[],
  txs: ReportTx[],
  cats: Map<string, ReportCategory>,
): BudgetProgress[] {
  const totals = totalsByCategory(txs, cats, 'expense');
  const spentBy = new Map<string, number>();
  for (const t of totals) {
    spentBy.set(t.key, t.totalCents);
    for (const c of t.children) spentBy.set(c.key, c.totalCents);
  }
  return budgets.map((b) => {
    const spent = spentBy.get(b.categoryKey) ?? 0;
    const ratio = b.limitCents > 0 ? spent / b.limitCents : 0;
    return {
      categoryKey: b.categoryKey,
      limitCents: b.limitCents,
      spentCents: spent,
      ratio,
      status: ratio > 1 ? 'over' : ratio >= 0.8 ? 'warning' : 'ok',
    };
  });
}

export function formatBRL(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const reais = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const c = String(abs % 100).padStart(2, '0');
  return `${neg ? '-' : ''}R$ ${reais},${c}`;
}

const MONTH_NAMES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MONTH_FULL = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

export function monthLabel(month: string, full = false): string {
  const [y, m] = month.split('-').map(Number);
  return full ? `${MONTH_FULL[m - 1]} de ${y}` : `${MONTH_NAMES[m - 1]}/${String(y).slice(2)}`;
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function formatDateBR(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
