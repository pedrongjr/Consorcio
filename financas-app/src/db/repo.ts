import type { SQLiteDatabase } from 'expo-sqlite';
import type { CategoryKind, CategoryRule, ParsedStatement } from '../core/types';
import { Classifier, displayDescription, isGenericText, similarityKey, type HistoryEntry } from '../core/classifier';
import { DEFAULT_RULES } from '../core/categories';
import { dedupeKeys } from '../core/importer';
import { descriptionKey, normalizeText } from '../core/text';
import {
  RULE_TOO_GENERIC,
  type Account, type AccountType, type AccountWithBalance, type Category, type ClassificationAction, type ClassificationLogEntry,
  type ClassifyResult, type ImportCandidate, type ImportRecord, type Rule, type RulePreview, type SimilarPreview, type Transaction,
  type TxFilter,
} from './shared';

export * from './shared';

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


export async function findAccountByExternalKey(db: SQLiteDatabase, key: string | null): Promise<Account | null> {
  if (!key) return null;
  return db.getFirstAsync<Account>('SELECT * FROM accounts WHERE external_key = ?', key);
}

// ---------------- Categorias ----------------

export async function listCategories(db: SQLiteDatabase): Promise<Category[]> {
  return db.getAllAsync<Category>('SELECT * FROM categories ORDER BY kind, sort, name COLLATE NOCASE');
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
  if (isGenericText(p)) throw new Error(RULE_TOO_GENERIC);
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
  const history: HistoryEntry[] = (await db.getAllAsync<{ description: string; memo: string | null; category_key: string; amount_cents: number }>(`
    SELECT description, memo, category_key, amount_cents FROM transactions
    WHERE category_source = 'user' AND category_key IS NOT NULL
    ORDER BY id`)).map((r) => ({
    key: similarityKey(r.description, r.memo), categoryKey: r.category_key, direction: r.amount_cents >= 0 ? 'in' : 'out',
  }));
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

// ---------------- Classificação (com histórico para desfazer) ----------------

type TxRow = { id: number; description: string; memo: string | null; amount_cents: number; category_key: string | null; category_source: string };
const TX_COLS = 'id, description, memo, amount_cents, category_key, category_source';

async function txRow(db: SQLiteDatabase, id: number): Promise<TxRow> {
  const r = await db.getFirstAsync<TxRow>(`SELECT ${TX_COLS} FROM transactions WHERE id = ?`, id);
  if (!r) throw new Error('Lançamento não encontrado.');
  return r;
}

async function validCategory(db: SQLiteDatabase, key: string | null): Promise<string | null> {
  if (!key) return null;
  return (await db.getFirstAsync('SELECT 1 FROM categories WHERE key = ?', key)) ? key : null;
}

/** Lançamentos com a mesma descrição (e mesmo sentido) — vazio se a descrição for genérica. */
async function similarRows(db: SQLiteDatabase, t: TxRow): Promise<TxRow[]> {
  const key = similarityKey(t.description, t.memo);
  if (!key) return [];
  const rows = await db.getAllAsync<TxRow>(
    `SELECT ${TX_COLS} FROM transactions WHERE description_key = ? AND id <> ? AND (amount_cents >= 0) = (? >= 0)`,
    descriptionKey(t.description), t.id, t.amount_cents,
  );
  return rows.filter((x) => similarityKey(x.description, x.memo) === key);
}

async function ruleRows(db: SQLiteDatabase, pattern: string, direction: 'in' | 'out' | null, onlyAuto: boolean): Promise<TxRow[]> {
  const c = new Classifier([{ pattern, categoryKey: '_', direction: direction ?? undefined, source: 'user' }]);
  const rows = await db.getAllAsync<TxRow>(
    `SELECT ${TX_COLS} FROM transactions ${onlyAuto ? "WHERE category_source <> 'user'" : ''} ORDER BY date DESC, id DESC`,
  );
  return rows.filter((x) => c.classify({ description: x.description, memo: x.memo ?? undefined, amountCents: x.amount_cents }).rule);
}

export async function previewSimilar(db: SQLiteDatabase, txId: number): Promise<SimilarPreview> {
  const t = await txRow(db, txId);
  if (!similarityKey(t.description, t.memo)) return { count: 0, generic: true };
  return { count: (await similarRows(db, t)).length, generic: false };
}

export async function previewRule(db: SQLiteDatabase, pattern: string, direction: 'in' | 'out' | null): Promise<RulePreview> {
  const p = normalizeText(pattern);
  if (!p) return { count: 0, generic: false, examples: [] };
  if (isGenericText(p)) return { count: 0, generic: true, examples: [] };
  const rows = await ruleRows(db, p, direction, false);
  return { count: rows.length, generic: false, examples: [...new Set(rows.map((r) => displayDescription(r.description, r.memo)))].slice(0, 3) };
}

class LogWriter {
  private items: { id: number; oldCat: string | null; oldSource: string; newCat: string | null }[] = [];
  private seen = new Set<number>();
  constructor(private db: SQLiteDatabase) {}

  async set(row: TxRow, categoryKey: string | null, source: string): Promise<boolean> {
    if (this.seen.has(row.id)) return false;
    if (row.category_key === categoryKey && row.category_source === source) return false;
    this.seen.add(row.id);
    await this.db.runAsync('UPDATE transactions SET category_key = ?, category_source = ? WHERE id = ?', categoryKey, source, row.id);
    this.items.push({ id: row.id, oldCat: row.category_key, oldSource: row.category_source, newCat: categoryKey });
    return true;
  }

  get count() { return this.items.length; }

  async save(entry: {
    action: ClassificationAction; categoryKey: string | null; label: string;
    rule?: { id: number; pattern: string; direction: 'in' | 'out' | null; prevCategory: string | null };
  }): Promise<number | null> {
    if (!this.items.length && !entry.rule) return null;
    const r = await this.db.runAsync(
      `INSERT INTO class_log (action, category_key, label, rule_id, rule_pattern, rule_direction, rule_prev_category, tx_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      entry.action, entry.categoryKey, entry.label.slice(0, 300), entry.rule?.id ?? null, entry.rule?.pattern ?? null,
      entry.rule?.direction ?? null, entry.rule?.prevCategory ?? null, this.items.length,
    );
    const id = r.lastInsertRowId;
    for (const it of this.items) {
      await this.db.runAsync(
        'INSERT INTO class_log_items (log_id, transaction_id, old_category_key, old_source, new_category_key) VALUES (?, ?, ?, ?, ?)',
        id, it.id, it.oldCat, it.oldSource, it.newCat,
      );
    }
    await this.db.runAsync('DELETE FROM class_log WHERE id NOT IN (SELECT id FROM class_log ORDER BY id DESC LIMIT 200)');
    return id;
  }
}

async function applyNewRule(
  db: SQLiteDatabase, log: LogWriter, pattern: string, categoryKey: string, direction: 'in' | 'out' | null,
): Promise<{ id: number; pattern: string; direction: 'in' | 'out' | null; prevCategory: string | null; applied: number }> {
  const p = normalizeText(pattern);
  if (!p || isGenericText(p)) throw new Error(RULE_TOO_GENERIC);
  const prev = await db.getFirstAsync<{ category_key: string }>('SELECT category_key FROM rules WHERE pattern = ? AND direction IS ?', p, direction);
  await saveRule(db, p, categoryKey, direction);
  const id = (await db.getFirstAsync<{ id: number }>('SELECT id FROM rules WHERE pattern = ? AND direction IS ?', p, direction))!.id;
  let applied = 0;
  for (const r of await ruleRows(db, p, direction, true)) if (await log.set(r, categoryKey, 'user')) applied++;
  return { id, pattern: p, direction, prevCategory: prev?.category_key ?? null, applied };
}

/**
 * Muda a categoria de um lançamento e, opcionalmente, dos semelhantes e/ou
 * cria uma regra. Tudo fica registrado no histórico para poder ser desfeito.
 */
export async function classifyTransaction(
  db: SQLiteDatabase,
  args: { txId: number; categoryKey: string; applySimilar: boolean; rule?: { pattern: string; direction: 'in' | 'out' | null } | null },
): Promise<ClassifyResult> {
  if (args.rule && isGenericText(args.rule.pattern)) throw new Error(RULE_TOO_GENERIC);
  let out: ClassifyResult = { logId: null, changed: 0, similar: 0, byRule: 0 };
  await db.withTransactionAsync(async () => {
    const t = await txRow(db, args.txId);
    const log = new LogWriter(db);
    await log.set(t, args.categoryKey, 'user');
    let similar = 0;
    if (args.applySimilar) for (const r of await similarRows(db, t)) if (await log.set(r, args.categoryKey, 'user')) similar++;
    const rule = args.rule ? await applyNewRule(db, log, args.rule.pattern, args.categoryKey, args.rule.direction) : undefined;
    const logId = await log.save({
      action: rule ? 'rule' : similar ? 'similar' : 'manual', categoryKey: args.categoryKey, label: displayDescription(t.description, t.memo), rule,
    });
    out = { logId, changed: log.count, similar, byRule: rule?.applied ?? 0 };
  });
  return out;
}

/** Cria uma regra (tela de regras) e a aplica aos lançamentos não categorizados à mão. */
export async function createRule(
  db: SQLiteDatabase, pattern: string, categoryKey: string, direction: 'in' | 'out' | null,
): Promise<ClassifyResult> {
  let out: ClassifyResult = { logId: null, changed: 0, similar: 0, byRule: 0 };
  await db.withTransactionAsync(async () => {
    const log = new LogWriter(db);
    const rule = await applyNewRule(db, log, pattern, categoryKey, direction);
    const logId = await log.save({ action: 'rule', categoryKey, label: `Regra “${rule.pattern}”`, rule });
    out = { logId, changed: log.count, similar: 0, byRule: rule.applied };
  });
  return out;
}

/** Descarta a categoria escolhida à mão destes lançamentos e os classifica de novo automaticamente. */
export async function resetClassification(db: SQLiteDatabase, ids: number[]): Promise<ClassifyResult> {
  const unique = [...new Set(ids)];
  let out: ClassifyResult = { logId: null, changed: 0, similar: 0, byRule: 0 };
  await db.withTransactionAsync(async () => {
    const rows: TxRow[] = [];
    for (let i = 0; i < unique.length; i += 500) {
      const chunk = unique.slice(i, i + 500);
      const marks = chunk.map(() => '?').join(',');
      rows.push(...await db.getAllAsync<TxRow>(`SELECT ${TX_COLS} FROM transactions WHERE id IN (${marks})`, chunk));
      await db.runAsync(`UPDATE transactions SET category_source = 'none' WHERE id IN (${marks}) AND category_source = 'user'`, chunk);
    }
    const classifier = await buildClassifier(db);
    const log = new LogWriter(db);
    for (const r of rows) {
      const c = classifier.classify({ description: r.description, memo: r.memo ?? undefined, amountCents: r.amount_cents });
      if (!(await log.set(r, c.categoryKey, c.confidence))) {
        await db.runAsync('UPDATE transactions SET category_source = ? WHERE id = ?', r.category_source, r.id);
      }
    }
    const logId = await log.save({ action: 'reset', categoryKey: null, label: `${rows.length} lançamento(s) reclassificados automaticamente` });
    out = { logId, changed: log.count, similar: 0, byRule: 0 };
  });
  return out;
}

export async function listClassificationLog(db: SQLiteDatabase): Promise<ClassificationLogEntry[]> {
  return db.getAllAsync<ClassificationLogEntry>(
    'SELECT id, action, category_key, label, rule_pattern, tx_count, undone, created_at FROM class_log ORDER BY id DESC LIMIT 200',
  );
}

/** Desfaz um registro do histórico (ver a versão do servidor). Retorna quantos lançamentos voltaram. */
export async function undoClassification(db: SQLiteDatabase, logId: number): Promise<number> {
  let restored = 0;
  await db.withTransactionAsync(async () => {
    const log = await db.getFirstAsync<{ undone: number; category_key: string | null; rule_id: number | null; rule_pattern: string | null; rule_prev_category: string | null }>(
      'SELECT undone, category_key, rule_id, rule_pattern, rule_prev_category FROM class_log WHERE id = ?', logId,
    );
    if (!log) throw new Error('Registro não encontrado.');
    if (log.undone) return;
    const items = await db.getAllAsync<{ transaction_id: number; old_category_key: string | null; old_source: string; new_category_key: string | null }>(
      'SELECT transaction_id, old_category_key, old_source, new_category_key FROM class_log_items WHERE log_id = ?', logId,
    );
    for (const it of items) {
      const r = await db.runAsync(
        'UPDATE transactions SET category_key = ?, category_source = ? WHERE id = ? AND category_key IS ?',
        await validCategory(db, it.old_category_key), it.old_source, it.transaction_id, it.new_category_key,
      );
      restored += r.changes;
    }
    if (log.rule_id && log.rule_pattern) {
      if (log.rule_prev_category && (await validCategory(db, log.rule_prev_category))) {
        await db.runAsync('UPDATE rules SET category_key = ? WHERE id = ? AND category_key = ?', log.rule_prev_category, log.rule_id, log.category_key);
      } else {
        await db.runAsync('DELETE FROM rules WHERE id = ? AND pattern = ? AND category_key IS ?', log.rule_id, log.rule_pattern, log.category_key);
      }
    }
    await db.runAsync('UPDATE class_log SET undone = 1 WHERE id = ?', logId);
  });
  return restored;
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
