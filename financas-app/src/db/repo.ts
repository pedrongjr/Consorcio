import type { SQLiteDatabase } from 'expo-sqlite';
import type { CategoryKind, CategoryRule, ParsedStatement, ParsedTransaction } from '../core/types';
import { Classifier, type HistoryEntry } from '../core/classifier';
import { DEFAULT_RULES } from '../core/categories';
import { dedupeKeys } from '../core/importer';
import { descriptionKey, normalizeText } from '../core/text';
import type { ReportCategory } from '../core/reports';

export type AccountType = 'checking' | 'savings' | 'credit_card' | 'cash' | 'investment';

export interface Account {
  id: number;
  name: string;
  type: AccountType;
  bank: string | null;
  external_key: string | null;
  initial_balance_cents: number;
  color: string;
  archived: number;
}

export interface AccountWithBalance extends Account {
  balance_cents: number;
  tx_count: number;
}

export interface Category {
  key: string;
  name: string;
  kind: CategoryKind;
  parent: string | null;
  icon: string;
  color: string;
  sort: number;
}

export interface Transaction {
  id: number;
  account_id: number;
  account_name: string;
  date: string;
  description: string;
  memo: string | null;
  notes: string | null;
  amount_cents: number;
  category_key: string | null;
  category_source: string;
}

export interface Rule {
  id: number;
  pattern: string;
  category_key: string;
  direction: 'in' | 'out' | null;
}

export const ACCOUNT_TYPES: { value: AccountType; label: string }[] = [
  { value: 'checking', label: 'Conta corrente' },
  { value: 'savings', label: 'Poupança' },
  { value: 'credit_card', label: 'Cartão de crédito' },
  { value: 'investment', label: 'Investimentos' },
  { value: 'cash', label: 'Carteira / dinheiro' },
];

/** Códigos COMPE dos bancos mais comuns, para nomear contas vindas do OFX. */
const BANKS: Record<string, string> = {
  '001': 'Banco do Brasil', '033': 'Santander', '104': 'Caixa', '237': 'Bradesco', '341': 'Itaú',
  '260': 'Nubank', '077': 'Inter', '336': 'C6 Bank', '212': 'Banco Original', '756': 'Sicoob',
  '748': 'Sicredi', '041': 'Banrisul', '422': 'Safra', '208': 'BTG Pactual', '655': 'Votorantim',
  '380': 'PicPay', '323': 'Mercado Pago', '290': 'PagBank', '403': 'Cora', '197': 'Stone', '070': 'BRB',
  '004': 'Banco do Nordeste', '021': 'Banestes', '637': 'Sofisa', '623': 'Pan', '746': 'Modal', '102': 'XP',
};

export function bankName(bankId?: string): string | undefined {
  if (!bankId) return undefined;
  const code = bankId.replace(/\D/g, '').slice(-3).padStart(3, '0');
  return BANKS[code];
}

// ---------------- Contas ----------------

export async function listAccounts(db: SQLiteDatabase): Promise<AccountWithBalance[]> {
  return db.getAllAsync<AccountWithBalance>(`
    SELECT a.*, a.initial_balance_cents + COALESCE(SUM(t.amount_cents), 0) AS balance_cents,
           COUNT(t.id) AS tx_count
    FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id
    WHERE a.archived = 0
    GROUP BY a.id ORDER BY a.name COLLATE NOCASE`);
}

export async function saveAccount(
  db: SQLiteDatabase,
  a: { id?: number; name: string; type: AccountType; bank?: string | null; initial_balance_cents?: number; color?: string; external_key?: string | null },
): Promise<number> {
  if (a.id) {
    await db.runAsync(
      'UPDATE accounts SET name = ?, type = ?, bank = ?, initial_balance_cents = ?, color = ? WHERE id = ?',
      a.name, a.type, a.bank ?? null, a.initial_balance_cents ?? 0, a.color ?? '#2A9D8F', a.id,
    );
    return a.id;
  }
  const r = await db.runAsync(
    'INSERT INTO accounts (name, type, bank, initial_balance_cents, color, external_key) VALUES (?, ?, ?, ?, ?, ?)',
    a.name, a.type, a.bank ?? null, a.initial_balance_cents ?? 0, a.color ?? '#2A9D8F', a.external_key ?? null,
  );
  return r.lastInsertRowId;
}

export async function deleteAccount(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM accounts WHERE id = ?', id);
}

export function accountExternalKey(acc: ParsedStatement['account']): string | null {
  if (!acc?.accountId) return null;
  return [acc.bankId ?? '', acc.branchId ?? '', acc.accountId].join('|');
}

export async function findAccountByExternalKey(db: SQLiteDatabase, key: string | null): Promise<Account | null> {
  if (!key) return null;
  return db.getFirstAsync<Account>('SELECT * FROM accounts WHERE external_key = ?', key);
}

// ---------------- Categorias ----------------

export async function listCategories(db: SQLiteDatabase): Promise<Category[]> {
  return db.getAllAsync<Category>('SELECT * FROM categories ORDER BY kind, sort, name COLLATE NOCASE');
}

export function categoryMap(cats: Category[]): Map<string, ReportCategory> {
  return new Map(cats.map((c) => [c.key, c]));
}

export async function saveCategory(
  db: SQLiteDatabase,
  c: { key?: string; name: string; kind: CategoryKind; parent: string | null; icon: string; color: string },
): Promise<string> {
  if (c.key) {
    await db.runAsync('UPDATE categories SET name = ?, icon = ?, color = ? WHERE key = ?', c.name, c.icon, c.color, c.key);
    return c.key;
  }
  const base = (c.parent ? `${c.parent}.` : '') + normalizeText(c.name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  let key = base || 'categoria';
  for (let i = 2; await db.getFirstAsync('SELECT 1 FROM categories WHERE key = ?', key); i++) key = `${base}_${i}`;
  const sort = (await db.getFirstAsync<{ s: number }>('SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM categories'))?.s ?? 0;
  await db.runAsync(
    'INSERT INTO categories (key, name, kind, parent, icon, color, sort) VALUES (?, ?, ?, ?, ?, ?, ?)',
    key, c.name, c.kind, c.parent, c.icon, c.color, sort,
  );
  return key;
}

/** Apaga a categoria; os lançamentos ficam sem categoria (ON DELETE SET NULL). */
export async function deleteCategory(db: SQLiteDatabase, key: string): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync("UPDATE transactions SET category_key = NULL, category_source = 'none' WHERE category_key IN (SELECT key FROM categories WHERE key = ? OR parent = ?)", key, key);
    await db.runAsync('DELETE FROM categories WHERE key = ? OR parent = ?', key, key);
  });
}

// ---------------- Regras e classificação ----------------

export async function listRules(db: SQLiteDatabase): Promise<Rule[]> {
  return db.getAllAsync<Rule>('SELECT id, pattern, category_key, direction FROM rules ORDER BY pattern');
}

export async function saveRule(db: SQLiteDatabase, pattern: string, categoryKey: string, direction: 'in' | 'out' | null): Promise<void> {
  const p = normalizeText(pattern);
  if (!p) return;
  await db.runAsync(
    `INSERT INTO rules (pattern, category_key, direction) VALUES (?, ?, ?)
     ON CONFLICT(pattern, direction) DO UPDATE SET category_key = excluded.category_key`,
    p, categoryKey, direction,
  );
}

export async function deleteRule(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM rules WHERE id = ?', id);
}

/** Monta o classificador com regras padrão + regras e histórico do usuário. */
export async function buildClassifier(db: SQLiteDatabase): Promise<Classifier> {
  const validKeys = new Set((await db.getAllAsync<{ key: string }>('SELECT key FROM categories')).map((r) => r.key));
  const userRules: CategoryRule[] = (await listRules(db)).map((r) => ({
    pattern: r.pattern,
    categoryKey: r.category_key,
    direction: r.direction ?? undefined,
    source: 'user',
  }));
  const history = await db.getAllAsync<HistoryEntry>(`
    SELECT description_key AS descriptionKey, category_key AS categoryKey,
           CASE WHEN amount_cents >= 0 THEN 'in' ELSE 'out' END AS direction
    FROM transactions
    WHERE category_source = 'user' AND category_key IS NOT NULL AND description_key <> ''
    ORDER BY id`);
  // Regras padrão de categorias apagadas pelo usuário são descartadas.
  return new Classifier([...userRules, ...DEFAULT_RULES.filter((r) => validKeys.has(r.categoryKey))], history);
}

/** Reclassifica lançamentos que não foram categorizados manualmente. */
export async function reclassifyAll(db: SQLiteDatabase): Promise<number> {
  const classifier = await buildClassifier(db);
  const rows = await db.getAllAsync<{ id: number; description: string; memo: string | null; amount_cents: number; category_key: string | null }>(
    "SELECT id, description, memo, amount_cents, category_key FROM transactions WHERE category_source <> 'user'",
  );
  let changed = 0;
  await db.withTransactionAsync(async () => {
    for (const r of rows) {
      const c = classifier.classify({ description: r.description, memo: r.memo ?? undefined, amountCents: r.amount_cents });
      if (c.categoryKey !== r.category_key) {
        await db.runAsync('UPDATE transactions SET category_key = ?, category_source = ? WHERE id = ?', c.categoryKey, c.confidence, r.id);
        changed++;
      }
    }
  });
  return changed;
}

// ---------------- Lançamentos ----------------

export interface TxFilter {
  month?: string; // YYYY-MM
  accountId?: number;
  categoryKey?: string; // inclui subcategorias
  search?: string;
  uncategorizedOnly?: boolean;
}

export async function listTransactions(db: SQLiteDatabase, f: TxFilter = {}): Promise<Transaction[]> {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.month) { where.push('t.date LIKE ?'); params.push(`${f.month}-%`); }
  if (f.accountId) { where.push('t.account_id = ?'); params.push(f.accountId); }
  if (f.categoryKey) {
    where.push('(t.category_key = ? OR t.category_key IN (SELECT key FROM categories WHERE parent = ?))');
    params.push(f.categoryKey, f.categoryKey);
  }
  if (f.uncategorizedOnly) where.push("(t.category_key IS NULL OR t.category_key IN ('outros_gastos', 'outras_receitas'))");
  if (f.search?.trim()) {
    where.push('(t.description LIKE ? OR t.notes LIKE ? OR t.memo LIKE ?)');
    const s = `%${f.search.trim()}%`;
    params.push(s, s, s);
  }
  return db.getAllAsync<Transaction>(
    `SELECT t.id, t.account_id, a.name AS account_name, t.date, t.description, t.memo, t.notes,
            t.amount_cents, t.category_key, t.category_source
     FROM transactions t JOIN accounts a ON a.id = t.account_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY t.date DESC, t.id DESC LIMIT 2000`,
    params,
  );
}

export async function getTransaction(db: SQLiteDatabase, id: number): Promise<Transaction | null> {
  return db.getFirstAsync<Transaction>(
    `SELECT t.*, a.name AS account_name FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE t.id = ?`, id,
  );
}

export async function updateTransaction(
  db: SQLiteDatabase,
  id: number,
  patch: { category_key?: string | null; notes?: string | null; description?: string; amount_cents?: number; date?: string },
): Promise<void> {
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  if (patch.category_key !== undefined) { sets.push("category_key = ?, category_source = 'user'"); params.push(patch.category_key); }
  if (patch.notes !== undefined) { sets.push('notes = ?'); params.push(patch.notes); }
  if (patch.description !== undefined) {
    sets.push('description = ?, description_key = ?');
    params.push(patch.description, descriptionKey(patch.description));
  }
  if (patch.amount_cents !== undefined) { sets.push('amount_cents = ?'); params.push(patch.amount_cents); }
  if (patch.date !== undefined) { sets.push('date = ?'); params.push(patch.date); }
  if (!sets.length) return;
  params.push(id);
  await db.runAsync(`UPDATE transactions SET ${sets.join(', ')} WHERE id = ?`, params);
}

/**
 * Aplica a categoria a todos os lançamentos com a mesma descrição normalizada
 * que não foram categorizados manualmente. Retorna quantos mudaram.
 */
export async function applyCategoryToSimilar(db: SQLiteDatabase, txId: number, categoryKey: string): Promise<number> {
  const tx = await db.getFirstAsync<{ description_key: string; amount_cents: number }>(
    'SELECT description_key, amount_cents FROM transactions WHERE id = ?', txId,
  );
  if (!tx?.description_key) return 0;
  const r = await db.runAsync(
    `UPDATE transactions SET category_key = ?, category_source = 'user'
     WHERE description_key = ? AND id <> ? AND (amount_cents >= 0) = (? >= 0)`,
    categoryKey, tx.description_key, txId, tx.amount_cents,
  );
  return r.changes;
}

export async function addManualTransaction(
  db: SQLiteDatabase,
  t: { accountId: number; date: string; description: string; amountCents: number; categoryKey: string | null; notes?: string },
): Promise<void> {
  await db.runAsync(
    `INSERT INTO transactions (account_id, date, description, amount_cents, category_key, category_source, description_key, dedupe_key, notes)
     VALUES (?, ?, ?, ?, ?, 'user', ?, ?, ?)`,
    t.accountId, t.date, t.description, t.amountCents, t.categoryKey, descriptionKey(t.description),
    `manual:${Date.now()}:${Math.random().toString(36).slice(2)}`, t.notes ?? null,
  );
}

export async function deleteTransaction(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM transactions WHERE id = ?', id);
}

// ---------------- Importação ----------------

export interface ImportCandidate extends ParsedTransaction {
  dedupeKey: string;
  categoryKey: string;
  categorySource: string;
  duplicate: boolean;
  selected: boolean;
}

/** Classifica e marca duplicados antes de mostrar a revisão ao usuário. */
export async function prepareImport(db: SQLiteDatabase, accountId: number, st: ParsedStatement): Promise<ImportCandidate[]> {
  const classifier = await buildClassifier(db);
  const keys = dedupeKeys(st.transactions);
  const existing = new Set(
    (await db.getAllAsync<{ dedupe_key: string }>('SELECT dedupe_key FROM transactions WHERE account_id = ?', accountId)).map((r) => r.dedupe_key),
  );
  return st.transactions.map((t, i) => {
    const c = classifier.classify(t);
    const duplicate = existing.has(keys[i]);
    return { ...t, dedupeKey: keys[i], categoryKey: c.categoryKey, categorySource: c.confidence, duplicate, selected: !duplicate };
  });
}

export async function commitImport(
  db: SQLiteDatabase,
  args: { accountId: number; fileName: string; format: string; candidates: ImportCandidate[] },
): Promise<{ imported: number; skipped: number }> {
  let imported = 0;
  let skipped = 0;
  await db.withTransactionAsync(async () => {
    const imp = await db.runAsync('INSERT INTO imports (file_name, format, account_id) VALUES (?, ?, ?)', args.fileName, args.format, args.accountId);
    for (const c of args.candidates) {
      if (!c.selected) { skipped++; continue; }
      const r = await db.runAsync(
        `INSERT OR IGNORE INTO transactions
           (account_id, date, description, memo, amount_cents, category_key, category_source, description_key, dedupe_key, import_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args.accountId, c.date, c.description, c.memo ?? null, c.amountCents, c.categoryKey, c.categorySource,
        descriptionKey(c.description), c.dedupeKey, imp.lastInsertRowId,
      );
      if (r.changes) imported++; else skipped++;
    }
    await db.runAsync('UPDATE imports SET imported_count = ?, skipped_count = ? WHERE id = ?', imported, skipped, imp.lastInsertRowId);
  });
  return { imported, skipped };
}

export interface ImportRecord {
  id: number;
  file_name: string;
  format: string;
  account_name: string;
  imported_count: number;
  skipped_count: number;
  created_at: string;
}

export async function listImports(db: SQLiteDatabase): Promise<ImportRecord[]> {
  return db.getAllAsync<ImportRecord>(
    `SELECT i.*, a.name AS account_name FROM imports i JOIN accounts a ON a.id = i.account_id ORDER BY i.id DESC LIMIT 50`,
  );
}

/** Desfaz uma importação inteira (apaga os lançamentos que vieram dela). */
export async function undoImport(db: SQLiteDatabase, importId: number): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM transactions WHERE import_id = ?', importId);
    await db.runAsync('DELETE FROM imports WHERE id = ?', importId);
  });
}

// ---------------- Orçamentos e relatórios ----------------

export async function listBudgets(db: SQLiteDatabase): Promise<{ categoryKey: string; limitCents: number }[]> {
  return db.getAllAsync('SELECT category_key AS categoryKey, limit_cents AS limitCents FROM budgets');
}

export async function setBudget(db: SQLiteDatabase, categoryKey: string, limitCents: number | null): Promise<void> {
  if (!limitCents || limitCents <= 0) await db.runAsync('DELETE FROM budgets WHERE category_key = ?', categoryKey);
  else {
    await db.runAsync(
      'INSERT INTO budgets (category_key, limit_cents) VALUES (?, ?) ON CONFLICT(category_key) DO UPDATE SET limit_cents = excluded.limit_cents',
      categoryKey, limitCents,
    );
  }
}

export async function reportTransactions(db: SQLiteDatabase, fromMonth: string, toMonth: string) {
  return db.getAllAsync<{ date: string; amountCents: number; categoryKey: string | null }>(
    `SELECT date, amount_cents AS amountCents, category_key AS categoryKey FROM transactions
     WHERE date >= ? AND date < ? ORDER BY date`,
    `${fromMonth}-01`, `${toMonth}-32`,
  );
}

export async function latestMonth(db: SQLiteDatabase): Promise<string | null> {
  const r = await db.getFirstAsync<{ m: string | null }>('SELECT substr(MAX(date), 1, 7) AS m FROM transactions');
  return r?.m ?? null;
}

/** Exporta todos os lançamentos em CSV (separador `;`, padrão brasileiro). */
export async function exportCsv(db: SQLiteDatabase): Promise<string> {
  const rows = await db.getAllAsync<{ date: string; account: string; description: string; category: string | null; parent: string | null; amount_cents: number; notes: string | null }>(`
    SELECT t.date, a.name AS account, t.description, c.name AS category, p.name AS parent, t.amount_cents, t.notes
    FROM transactions t JOIN accounts a ON a.id = t.account_id
    LEFT JOIN categories c ON c.key = t.category_key LEFT JOIN categories p ON p.key = c.parent
    ORDER BY t.date, t.id`);
  const q = (s: string | null) => `"${(s ?? '').replace(/"/g, '""')}"`;
  const lines = ['Data;Conta;Descrição;Categoria;Subcategoria;Valor;Observações'];
  for (const r of rows) {
    const [y, m, d] = r.date.split('-');
    const value = (r.amount_cents / 100).toFixed(2).replace('.', ',');
    lines.push([`${d}/${m}/${y}`, q(r.account), q(r.description), q(r.parent ?? r.category), q(r.parent ? r.category : ''), value, q(r.notes)].join(';'));
  }
  return lines.join('\n');
}
