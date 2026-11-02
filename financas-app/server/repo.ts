import type { CategoryRule, ParsedStatement , CategoryKind } from '../src/core/types';
import { Classifier, type HistoryEntry } from '../src/core/classifier';
import { DEFAULT_RULES } from '../src/core/categories';
import { dedupeKeys } from '../src/core/importer';
import { descriptionKey, normalizeText } from '../src/core/text';
import type {
  Account, AccountType, AccountWithBalance, Category, ImportCandidate, ImportRecord, Rule, Transaction, TxFilter,
} from '../src/db/shared';
import type { Tx } from './db';

/**
 * Versão Postgres de `src/db/repo.ts`. Toda função recebe o `userId` da sessão
 * e todas as consultas filtram por ele. Além disso, elas rodam dentro de
 * `withUser`, com Row-Level Security: mesmo uma consulta sem o filtro só
 * enxergaria as linhas do próprio usuário.
 */

export class NotFoundError extends Error {
  constructor(what: string) { super(`${what} não encontrado(a).`); }
}

async function ensureAccount(tx: Tx, uid: number, accountId: number): Promise<void> {
  const r = await tx.query('SELECT 1 FROM accounts WHERE id = $1 AND user_id = $2', [accountId, uid]);
  if (!r.rowCount) throw new NotFoundError('Conta');
}

async function validCategory(tx: Tx, uid: number, key: string | null | undefined): Promise<string | null> {
  if (!key) return null;
  const r = await tx.query('SELECT 1 FROM categories WHERE key = $1 AND user_id = $2', [key, uid]);
  return r.rowCount ? key : null;
}

// ---------------- Contas ----------------

export async function listAccounts(tx: Tx, uid: number): Promise<AccountWithBalance[]> {
  const r = await tx.query(
    `SELECT a.id, a.name, a.type, a.bank, a.external_key, a.initial_balance_cents, a.color, a.archived,
            a.initial_balance_cents + COALESCE(SUM(t.amount_cents), 0) AS balance_cents,
            COUNT(t.id)::int AS tx_count
     FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id AND t.user_id = $1
     WHERE a.user_id = $1 AND a.archived = 0
     GROUP BY a.id ORDER BY lower(a.name)`,
    [uid],
  );
  return r.rows;
}

export async function saveAccount(
  tx: Tx, uid: number,
  a: { id?: number; name: string; type: AccountType; bank?: string | null; initial_balance_cents?: number; color?: string; external_key?: string | null },
): Promise<number> {
  if (a.id) {
    const r = await tx.query(
      `UPDATE accounts SET name = $1, type = $2, bank = $3, initial_balance_cents = $4, color = $5
       WHERE id = $6 AND user_id = $7`,
      [a.name, a.type, a.bank ?? null, a.initial_balance_cents ?? 0, a.color ?? '#2A9D8F', a.id, uid],
    );
    if (!r.rowCount) throw new NotFoundError('Conta');
    return a.id;
  }
  const r = await tx.query<{ id: number }>(
    `INSERT INTO accounts (user_id, name, type, bank, initial_balance_cents, color, external_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [uid, a.name, a.type, a.bank ?? null, a.initial_balance_cents ?? 0, a.color ?? '#2A9D8F', a.external_key ?? null],
  );
  return r.rows[0].id;
}

export async function deleteAccount(tx: Tx, uid: number, id: number): Promise<void> {
  await tx.query('DELETE FROM accounts WHERE id = $1 AND user_id = $2', [id, uid]);
}

export async function findAccountByExternalKey(tx: Tx, uid: number, key: string | null): Promise<Account | null> {
  if (!key) return null;
  const r = await tx.query(
    'SELECT id, name, type, bank, external_key, initial_balance_cents, color, archived FROM accounts WHERE external_key = $1 AND user_id = $2',
    [key, uid],
  );
  return r.rows[0] ?? null;
}

// ---------------- Categorias ----------------

export async function listCategories(tx: Tx, uid: number): Promise<Category[]> {
  const r = await tx.query(
    'SELECT key, name, kind, parent, icon, color, sort FROM categories WHERE user_id = $1 ORDER BY kind, sort, lower(name)',
    [uid],
  );
  return r.rows;
}

export async function saveCategory(
  tx: Tx, uid: number,
  c: { key?: string; name: string; kind: CategoryKind; parent: string | null; icon: string; color: string },
): Promise<string> {
  if (c.key) {
    const r = await tx.query('UPDATE categories SET name = $1, icon = $2, color = $3 WHERE key = $4 AND user_id = $5', [c.name, c.icon, c.color, c.key, uid]);
    if (!r.rowCount) throw new NotFoundError('Categoria');
    return c.key;
  }
  let kind = c.kind;
  if (c.parent) {
    const p = await tx.query<{ kind: CategoryKind }>('SELECT kind FROM categories WHERE key = $1 AND user_id = $2', [c.parent, uid]);
    if (!p.rowCount) throw new NotFoundError('Categoria-pai');
    kind = p.rows[0].kind;
  }
  const base = (c.parent ? `${c.parent}.` : '') + normalizeText(c.name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  let key = base || 'categoria';
  for (let i = 2; (await tx.query('SELECT 1 FROM categories WHERE key = $1 AND user_id = $2', [key, uid])).rowCount; i++) key = `${base}_${i}`;
  const sort = (await tx.query<{ s: number }>('SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM categories WHERE user_id = $1', [uid])).rows[0].s;
  await tx.query(
    'INSERT INTO categories (user_id, key, name, kind, parent, icon, color, sort) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [uid, key, c.name, kind, c.parent, c.icon, c.color, sort],
  );
  return key;
}

export async function deleteCategory(tx: Tx, uid: number, key: string): Promise<void> {
  await tx.query(
    `UPDATE transactions SET category_key = NULL, category_source = 'none'
     WHERE user_id = $1 AND category_key IN (SELECT key FROM categories WHERE user_id = $1 AND (key = $2 OR parent = $2))`,
    [uid, key],
  );
  await tx.query('DELETE FROM categories WHERE user_id = $1 AND (key = $2 OR parent = $2)', [uid, key]);
}

// ---------------- Regras ----------------

export async function listRules(tx: Tx, uid: number): Promise<Rule[]> {
  const r = await tx.query('SELECT id, pattern, category_key, direction FROM rules WHERE user_id = $1 ORDER BY pattern', [uid]);
  return r.rows;
}

export async function saveRule(tx: Tx, uid: number, pattern: string, categoryKey: string, direction: 'in' | 'out' | null): Promise<void> {
  const p = normalizeText(pattern);
  if (!p) return;
  if (!(await validCategory(tx, uid, categoryKey))) throw new NotFoundError('Categoria');
  await tx.query(
    `INSERT INTO rules (user_id, pattern, category_key, direction) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, pattern, direction) DO UPDATE SET category_key = EXCLUDED.category_key`,
    [uid, p, categoryKey, direction],
  );
}

export async function deleteRule(tx: Tx, uid: number, id: number): Promise<void> {
  await tx.query('DELETE FROM rules WHERE id = $1 AND user_id = $2', [id, uid]);
}

async function buildClassifier(tx: Tx, uid: number): Promise<Classifier> {
  const validKeys = new Set((await tx.query<{ key: string }>('SELECT key FROM categories WHERE user_id = $1', [uid])).rows.map((r) => r.key));
  const userRules: CategoryRule[] = (await listRules(tx, uid)).map((r) => ({
    pattern: r.pattern, categoryKey: r.category_key, direction: r.direction ?? undefined, source: 'user',
  }));
  const history = (await tx.query<HistoryEntry>(
    `SELECT description_key AS "descriptionKey", category_key AS "categoryKey",
            CASE WHEN amount_cents >= 0 THEN 'in' ELSE 'out' END AS direction
     FROM transactions
     WHERE user_id = $1 AND category_source = 'user' AND category_key IS NOT NULL AND description_key <> ''
     ORDER BY id`,
    [uid],
  )).rows;
  return new Classifier([...userRules, ...DEFAULT_RULES.filter((r) => validKeys.has(r.categoryKey))], history);
}

export async function reclassifyAll(tx: Tx, uid: number): Promise<number> {
  const classifier = await buildClassifier(tx, uid);
  const rows = (await tx.query<{ id: number; description: string; memo: string | null; amount_cents: number; category_key: string | null }>(
    "SELECT id, description, memo, amount_cents, category_key FROM transactions WHERE user_id = $1 AND category_source <> 'user'",
    [uid],
  )).rows;
  let changed = 0;
  for (const r of rows) {
    const c = classifier.classify({ description: r.description, memo: r.memo ?? undefined, amountCents: r.amount_cents });
    if (c.categoryKey !== r.category_key) {
      await tx.query('UPDATE transactions SET category_key = $1, category_source = $2 WHERE id = $3 AND user_id = $4', [c.categoryKey, c.confidence, r.id, uid]);
      changed++;
    }
  }
  return changed;
}

// ---------------- Lançamentos ----------------

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function listTransactions(tx: Tx, uid: number, f: TxFilter = {}): Promise<Transaction[]> {
  const where = ['t.user_id = $1'];
  const params: (string | number)[] = [uid];
  const p = (v: string | number) => { params.push(v); return `$${params.length}`; };
  if (f.month) where.push(`t.date LIKE ${p(`${f.month}-%`)}`);
  if (f.accountId) where.push(`t.account_id = ${p(f.accountId)}`);
  if (f.categoryKey) {
    const k = p(f.categoryKey);
    where.push(`(t.category_key = ${k} OR t.category_key IN (SELECT key FROM categories WHERE user_id = $1 AND parent = ${k}))`);
  }
  if (f.uncategorizedOnly) where.push("(t.category_key IS NULL OR t.category_key IN ('outros_gastos', 'outras_receitas'))");
  if (f.search?.trim()) {
    const s = p(`%${likeEscape(f.search.trim())}%`);
    where.push(`(t.description ILIKE ${s} OR t.notes ILIKE ${s} OR t.memo ILIKE ${s})`);
  }
  const r = await tx.query(
    `SELECT t.id, t.account_id, a.name AS account_name, t.date, t.description, t.memo, t.notes,
            t.amount_cents, t.category_key, t.category_source
     FROM transactions t JOIN accounts a ON a.id = t.account_id AND a.user_id = t.user_id
     WHERE ${where.join(' AND ')}
     ORDER BY t.date DESC, t.id DESC LIMIT 2000`,
    params,
  );
  return r.rows;
}

export async function getTransaction(tx: Tx, uid: number, id: number): Promise<Transaction | null> {
  const r = await tx.query(
    `SELECT t.id, t.account_id, a.name AS account_name, t.date, t.description, t.memo, t.notes,
            t.amount_cents, t.category_key, t.category_source
     FROM transactions t JOIN accounts a ON a.id = t.account_id AND a.user_id = t.user_id
     WHERE t.id = $1 AND t.user_id = $2`,
    [id, uid],
  );
  return r.rows[0] ?? null;
}

export async function updateTransaction(
  tx: Tx, uid: number, id: number,
  patch: { category_key?: string | null; notes?: string | null; description?: string; amount_cents?: number; date?: string },
): Promise<void> {
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  const p = (v: string | number | null) => { params.push(v); return `$${params.length}`; };
  if (patch.category_key !== undefined) sets.push(`category_key = ${p(await validCategory(tx, uid, patch.category_key))}, category_source = 'user'`);
  if (patch.notes !== undefined) sets.push(`notes = ${p(patch.notes)}`);
  if (patch.description !== undefined) sets.push(`description = ${p(patch.description)}, description_key = ${p(descriptionKey(patch.description))}`);
  if (patch.amount_cents !== undefined) sets.push(`amount_cents = ${p(patch.amount_cents)}`);
  if (patch.date !== undefined) sets.push(`date = ${p(patch.date)}`);
  if (!sets.length) return;
  const r = await tx.query(`UPDATE transactions SET ${sets.join(', ')} WHERE id = ${p(id)} AND user_id = ${p(uid)}`, params);
  if (!r.rowCount) throw new NotFoundError('Lançamento');
}

export async function applyCategoryToSimilar(tx: Tx, uid: number, txId: number, categoryKey: string): Promise<number> {
  const key = await validCategory(tx, uid, categoryKey);
  if (!key) throw new NotFoundError('Categoria');
  const t = (await tx.query<{ description_key: string; amount_cents: number }>(
    'SELECT description_key, amount_cents FROM transactions WHERE id = $1 AND user_id = $2', [txId, uid],
  )).rows[0];
  if (!t?.description_key) return 0;
  const r = await tx.query(
    `UPDATE transactions SET category_key = $1, category_source = 'user'
     WHERE user_id = $2 AND description_key = $3 AND id <> $4 AND (amount_cents >= 0) = ($5::bigint >= 0)`,
    [key, uid, t.description_key, txId, t.amount_cents],
  );
  return r.rowCount ?? 0;
}

export async function addManualTransaction(
  tx: Tx, uid: number,
  t: { accountId: number; date: string; description: string; amountCents: number; categoryKey: string | null; notes?: string },
): Promise<void> {
  await ensureAccount(tx, uid, t.accountId);
  await tx.query(
    `INSERT INTO transactions (user_id, account_id, date, description, amount_cents, category_key, category_source, description_key, dedupe_key, notes)
     VALUES ($1, $2, $3, $4, $5, $6, 'user', $7, $8, $9)`,
    [uid, t.accountId, t.date, t.description, t.amountCents, await validCategory(tx, uid, t.categoryKey), descriptionKey(t.description),
      `manual:${Date.now()}:${Math.random().toString(36).slice(2)}`, t.notes ?? null],
  );
}

export async function deleteTransaction(tx: Tx, uid: number, id: number): Promise<void> {
  await tx.query('DELETE FROM transactions WHERE id = $1 AND user_id = $2', [id, uid]);
}

// ---------------- Importação ----------------

export async function prepareImport(tx: Tx, uid: number, accountId: number, st: ParsedStatement): Promise<ImportCandidate[]> {
  await ensureAccount(tx, uid, accountId);
  const classifier = await buildClassifier(tx, uid);
  const keys = dedupeKeys(st.transactions);
  const existing = new Set(
    (await tx.query<{ dedupe_key: string }>('SELECT dedupe_key FROM transactions WHERE account_id = $1 AND user_id = $2', [accountId, uid])).rows.map((r) => r.dedupe_key),
  );
  return st.transactions.map((t, i) => {
    const c = classifier.classify(t);
    const duplicate = existing.has(keys[i]);
    return { ...t, dedupeKey: keys[i], categoryKey: c.categoryKey, categorySource: c.confidence, duplicate, selected: !duplicate };
  });
}

export async function commitImport(
  tx: Tx, uid: number,
  args: { accountId: number; fileName: string; format: string; candidates: ImportCandidate[] },
): Promise<{ imported: number; skipped: number }> {
  await ensureAccount(tx, uid, args.accountId);
  const validKeys = new Set((await tx.query<{ key: string }>('SELECT key FROM categories WHERE user_id = $1', [uid])).rows.map((r) => r.key));
  const imp = (await tx.query<{ id: number }>(
    'INSERT INTO imports (user_id, file_name, format, account_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [uid, args.fileName, args.format, args.accountId],
  )).rows[0].id;
  let imported = 0;
  let skipped = 0;
  for (const c of args.candidates) {
    if (!c.selected) { skipped++; continue; }
    const r = await tx.query(
      `INSERT INTO transactions
         (user_id, account_id, date, description, memo, amount_cents, category_key, category_source, description_key, dedupe_key, import_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (account_id, dedupe_key) DO NOTHING`,
      [uid, args.accountId, c.date, c.description, c.memo ?? null, c.amountCents,
        validKeys.has(c.categoryKey) ? c.categoryKey : null, c.categorySource, descriptionKey(c.description), c.dedupeKey, imp],
    );
    if (r.rowCount) imported++; else skipped++;
  }
  await tx.query('UPDATE imports SET imported_count = $1, skipped_count = $2 WHERE id = $3 AND user_id = $4', [imported, skipped, imp, uid]);
  return { imported, skipped };
}

export async function listImports(tx: Tx, uid: number): Promise<ImportRecord[]> {
  const r = await tx.query(
    `SELECT i.id, i.file_name, i.format, a.name AS account_name, i.imported_count, i.skipped_count,
            to_char(i.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS created_at
     FROM imports i JOIN accounts a ON a.id = i.account_id AND a.user_id = i.user_id
     WHERE i.user_id = $1 ORDER BY i.id DESC LIMIT 50`,
    [uid],
  );
  return r.rows;
}

export async function undoImport(tx: Tx, uid: number, importId: number): Promise<void> {
  await tx.query('DELETE FROM transactions WHERE import_id = $1 AND user_id = $2', [importId, uid]);
  await tx.query('DELETE FROM imports WHERE id = $1 AND user_id = $2', [importId, uid]);
}

// ---------------- Orçamentos e relatórios ----------------

export async function listBudgets(tx: Tx, uid: number): Promise<{ categoryKey: string; limitCents: number }[]> {
  const r = await tx.query('SELECT category_key AS "categoryKey", limit_cents AS "limitCents" FROM budgets WHERE user_id = $1', [uid]);
  return r.rows;
}

export async function setBudget(tx: Tx, uid: number, categoryKey: string, limitCents: number | null): Promise<void> {
  if (!limitCents || limitCents <= 0) {
    await tx.query('DELETE FROM budgets WHERE category_key = $1 AND user_id = $2', [categoryKey, uid]);
    return;
  }
  if (!(await validCategory(tx, uid, categoryKey))) throw new NotFoundError('Categoria');
  await tx.query(
    `INSERT INTO budgets (user_id, category_key, limit_cents) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, category_key) DO UPDATE SET limit_cents = EXCLUDED.limit_cents`,
    [uid, categoryKey, limitCents],
  );
}

export async function reportTransactions(tx: Tx, uid: number, fromMonth: string, toMonth: string) {
  const r = await tx.query<{ date: string; amountCents: number; categoryKey: string | null }>(
    `SELECT date, amount_cents AS "amountCents", category_key AS "categoryKey" FROM transactions
     WHERE user_id = $1 AND date >= $2 AND date < $3 ORDER BY date`,
    [uid, `${fromMonth}-01`, `${toMonth}-32`],
  );
  return r.rows;
}

export async function latestMonth(tx: Tx, uid: number): Promise<string | null> {
  const r = await tx.query<{ m: string | null }>('SELECT substr(MAX(date), 1, 7) AS m FROM transactions WHERE user_id = $1', [uid]);
  return r.rows[0]?.m ?? null;
}

export async function exportCsv(tx: Tx, uid: number): Promise<string> {
  const rows = (await tx.query<{ date: string; account: string; description: string; category: string | null; parent: string | null; amount_cents: number; notes: string | null }>(
    `SELECT t.date, a.name AS account, t.description, c.name AS category, p.name AS parent, t.amount_cents, t.notes
     FROM transactions t JOIN accounts a ON a.id = t.account_id AND a.user_id = t.user_id
     LEFT JOIN categories c ON c.key = t.category_key AND c.user_id = t.user_id
     LEFT JOIN categories p ON p.key = c.parent AND p.user_id = t.user_id
     WHERE t.user_id = $1 ORDER BY t.date, t.id`,
    [uid],
  )).rows;
  const q = (s: string | null) => `"${(s ?? '').replace(/"/g, '""')}"`;
  const lines = ['Data;Conta;Descrição;Categoria;Subcategoria;Valor;Observações'];
  for (const r of rows) {
    const [y, m, d] = r.date.split('-');
    const value = (r.amount_cents / 100).toFixed(2).replace('.', ',');
    lines.push([`${d}/${m}/${y}`, q(r.account), q(r.description), q(r.parent ?? r.category), q(r.parent ? r.category : ''), value, q(r.notes)].join(';'));
  }
  return lines.join('\n');
}
