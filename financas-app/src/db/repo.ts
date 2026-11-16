import type { SQLiteDatabase } from 'expo-sqlite';
import type { CategoryKind, CategoryRule, ParsedStatement } from '../core/types';
import { Classifier, displayDescription, isGenericText, similarityKey, type HistoryEntry } from '../core/classifier';
import { DEFAULT_RULES } from '../core/categories';
import { dedupeKeys } from '../core/importer';
import { descriptionKey, normalizeText } from '../core/text';
import { cleanNames, cpfMiddleDigits, isSelfTransfer, type Holder } from '../core/holder';
import { findTransferPairs, mirrorDescription, transferCategoryFor, TRANSFER_WINDOW_DAYS, type TransferCandidate } from '../core/transfers';
import {
  RULE_TOO_GENERIC,
  type Account, type AccountType, type AccountWithBalance, type Category, type ClassificationAction, type ClassificationLogEntry,
  type ClassifyResult, type Goal, type GoalEntry, type GoalInput, type ImportCandidate, type ImportRecord, type Rule, type RulePreview, type SimilarPreview, type Transaction,
  type HolderInfo, type SelfTransferResult, type TransferInput, type TransferResult, type TxFilter,
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
  return new Classifier([...userRules, ...DEFAULT_RULES.filter((r) => validKeys.has(r.categoryKey))], history, {
    holder: await loadHolder(db),
    selfCategory: validKeys.has('transferencias') ? 'transferencias' : null,
  });
}

// ---------------- Titular (transferências para si mesmo) ----------------

async function loadHolder(db: SQLiteDatabase): Promise<Holder | null> {
  const r = await db.getFirstAsync<{ names: string; cpf_middle: string | null }>('SELECT names, cpf_middle FROM holder_settings WHERE id = 1');
  if (!r) return null;
  const names = r.names.split('\n').filter(Boolean);
  return names.length || r.cpf_middle ? { names, cpfMiddle: r.cpf_middle } : null;
}

export async function getHolder(db: SQLiteDatabase): Promise<HolderInfo> {
  const h = await loadHolder(db);
  return { names: h?.names ?? [], cpfMasked: h?.cpfMiddle ? `***.${h.cpfMiddle.slice(0, 3)}.${h.cpfMiddle.slice(3)}-**` : null };
}

async function storeHolder(db: SQLiteDatabase, names: string[], cpfMiddle: string | null): Promise<void> {
  await db.runAsync(
    `INSERT INTO holder_settings (id, names, cpf_middle) VALUES (1, ?, ?)
     ON CONFLICT (id) DO UPDATE SET names = excluded.names, cpf_middle = excluded.cpf_middle`,
    names.join('\n'), cpfMiddle,
  );
}

export async function saveHolder(db: SQLiteDatabase, input: { names: string[]; cpf?: string }): Promise<SelfTransferResult> {
  const names = cleanNames(input.names);
  let cpfMiddle = (await loadHolder(db))?.cpfMiddle ?? null;
  if (input.cpf !== undefined) {
    if (!input.cpf.trim()) cpfMiddle = null;
    else {
      cpfMiddle = cpfMiddleDigits(input.cpf);
      if (!cpfMiddle) throw new Error('CPF inválido: informe os 11 dígitos (ou os 6 do meio, como aparecem no extrato).');
    }
  }
  if (input.names.some((n) => n.trim()) && !names.length) throw new Error('Informe o nome completo (nome e sobrenome).');
  let out: SelfTransferResult = { logId: null, classified: 0, linked: 0 };
  await db.withTransactionAsync(async () => {
    await storeHolder(db, names, cpfMiddle);
    out = await applySelfTransfers(db);
  });
  return out;
}

async function applySelfTransfers(db: SQLiteDatabase): Promise<SelfTransferResult> {
  const holder = await loadHolder(db);
  const target = await validCategory(db, 'transferencias');
  let logId: number | null = null;
  let classified = 0;
  if (holder && target) {
    const rows = await db.getAllAsync<TxRow & { kind: string | null }>(
      `SELECT t.id, t.description, t.memo, t.amount_cents, t.category_key, t.category_source, c.kind
       FROM transactions t LEFT JOIN categories c ON c.key = t.category_key
       WHERE t.category_source <> 'user' AND t.mirror = 0`,
    );
    const log = new LogWriter(db);
    for (const r of rows) {
      if (r.kind === 'transfer') continue;
      if (isSelfTransfer({ description: r.description, memo: r.memo, amountCents: r.amount_cents }, holder)) await log.set(r, target, 'rule');
    }
    classified = log.count;
    logId = await log.save({ action: 'self', categoryKey: target, label: 'Transferências para você mesmo (nome/CPF do titular)' });
  }
  const linked = await linkDetectedTransfers(db);
  return { logId, classified, linked };
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
  if (f.accountIds?.length) { where.push(`t.account_id IN (${f.accountIds.map(() => '?').join(', ')})`); params.push(...f.accountIds); }
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
            t.amount_cents, t.category_key, t.category_source,
            t.transfer_account_id, ta.name AS transfer_account_name, t.transfer_peer_id, t.mirror
     FROM transactions t JOIN accounts a ON a.id = t.account_id
     LEFT JOIN accounts ta ON ta.id = t.transfer_account_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY t.date DESC, t.id DESC LIMIT 2000`,
    params,
  );
}

export async function getTransaction(db: SQLiteDatabase, id: number): Promise<Transaction | null> {
  return db.getFirstAsync<Transaction>(
    `SELECT t.*, a.name AS account_name, ta.name AS transfer_account_name
     FROM transactions t JOIN accounts a ON a.id = t.account_id LEFT JOIN accounts ta ON ta.id = t.transfer_account_id
     WHERE t.id = ?`, id,
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
    if ((await db.getFirstAsync<{ kind: string }>('SELECT kind FROM categories WHERE key = ?', args.categoryKey))?.kind !== 'transfer') {
      await unlinkTransfer(db, t.id, true);
    }
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
  await db.withTransactionAsync(async () => {
    // O lançamento criado como contrapartida não faz sentido sozinho.
    await db.runAsync('DELETE FROM transactions WHERE mirror = 1 AND transfer_peer_id = ?', id);
    await db.runAsync('DELETE FROM transactions WHERE id = ?', id);
  });
}

// ---------------- Transferências entre contas ----------------

/** Desfaz a ligação com a outra conta (apaga a contrapartida criada automaticamente). */
async function unlinkTransfer(db: SQLiteDatabase, id: number, clearAccount: boolean): Promise<void> {
  const t = await db.getFirstAsync<{ transfer_peer_id: number | null }>('SELECT transfer_peer_id FROM transactions WHERE id = ?', id);
  if (t?.transfer_peer_id) {
    const peer = await db.getFirstAsync<{ id: number; mirror: number }>('SELECT id, mirror FROM transactions WHERE id = ?', t.transfer_peer_id);
    if (peer?.mirror) await db.runAsync('DELETE FROM transactions WHERE id = ?', peer.id);
    else if (peer) await db.runAsync('UPDATE transactions SET transfer_peer_id = NULL, transfer_account_id = NULL WHERE id = ?', peer.id);
  }
  await db.runAsync(
    `UPDATE transactions SET transfer_peer_id = NULL${clearAccount ? ', transfer_account_id = NULL' : ''} WHERE id = ?`, id,
  );
}

async function linkPair(db: SQLiteDatabase, a: { id: number; account_id: number }, b: { id: number; account_id: number }, categoryKey: string, source: string) {
  await db.runAsync(
    'UPDATE transactions SET transfer_peer_id = ?, transfer_account_id = ?, category_key = ?, category_source = ? WHERE id = ?',
    b.id, b.account_id, categoryKey, source, a.id,
  );
  await db.runAsync(
    'UPDATE transactions SET transfer_peer_id = ?, transfer_account_id = ?, category_key = ?, category_source = ? WHERE id = ?',
    a.id, a.account_id, categoryKey, source, b.id,
  );
}

/**
 * Marca um lançamento como transferência de/para outra conta. Procura o
 * lançamento correspondente já importado na outra conta (valor oposto, data
 * próxima); se não houver e `createMirror`, cria a contrapartida.
 */
export async function setTransfer(db: SQLiteDatabase, txId: number, input: TransferInput): Promise<TransferResult> {
  let out: TransferResult = { peerId: null, matched: false, created: false };
  await db.withTransactionAsync(async () => {
    const t = await db.getFirstAsync<{ id: number; account_id: number; account_type: string; account_name: string; date: string; amount_cents: number; category_key: string | null }>(
      `SELECT t.id, t.account_id, a.type AS account_type, a.name AS account_name, t.date, t.amount_cents, t.category_key
       FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE t.id = ?`, txId,
    );
    if (!t) throw new Error('Lançamento não encontrado.');
    await unlinkTransfer(db, t.id, true);
    if (input.accountId === null) return;
    if (input.accountId === t.account_id) throw new Error('Escolha uma conta diferente da conta do lançamento.');
    const other = await db.getFirstAsync<{ id: number; type: string; name: string }>('SELECT id, type, name FROM accounts WHERE id = ?', input.accountId);
    if (!other) throw new Error('Conta não encontrada.');
    const requested = input.categoryKey
      ? await db.getFirstAsync<{ key: string }>("SELECT key FROM categories WHERE key = ? AND kind = 'transfer'", input.categoryKey)
      : null;
    const categoryKey = requested?.key ?? transferCategoryFor(t.account_type, other.type, [t.category_key]);

    const peer = await db.getFirstAsync<{ id: number; account_id: number }>(
      `SELECT id, account_id FROM transactions
       WHERE account_id = ? AND amount_cents = ? AND transfer_peer_id IS NULL AND id <> ?
         AND ABS(julianday(date) - julianday(?)) <= ?
       ORDER BY ABS(julianday(date) - julianday(?)), id LIMIT 1`,
      other.id, -t.amount_cents, t.id, t.date, TRANSFER_WINDOW_DAYS, t.date,
    );
    if (peer) {
      await linkPair(db, t, peer, categoryKey, 'user');
      out = { peerId: peer.id, matched: true, created: false };
      return;
    }
    if (input.createMirror) {
      const desc = mirrorDescription(t.amount_cents, t.account_name);
      const r = await db.runAsync(
        `INSERT INTO transactions (account_id, date, description, amount_cents, category_key, category_source, description_key, dedupe_key, mirror)
         VALUES (?, ?, ?, ?, ?, 'user', ?, ?, 1)`,
        other.id, t.date, desc, -t.amount_cents, categoryKey, descriptionKey(desc), `transfer:${t.id}:${Date.now()}`,
      );
      await linkPair(db, t, { id: r.lastInsertRowId, account_id: other.id }, categoryKey, 'user');
      out = { peerId: r.lastInsertRowId, matched: false, created: true };
      return;
    }
    await db.runAsync("UPDATE transactions SET transfer_account_id = ?, category_key = ?, category_source = 'user' WHERE id = ?", other.id, categoryKey, t.id);
  });
  return out;
}

/** Liga automaticamente saídas e entradas entre as contas do usuário. */
async function linkDetectedTransfers(db: SQLiteDatabase): Promise<number> {
  const rows = await db.getAllAsync<TransferCandidate>(
    `SELECT t.id, t.account_id, a.type AS account_type, t.date, t.amount_cents, t.description, t.memo,
            t.category_key, c.kind AS category_kind, t.category_source
     FROM transactions t JOIN accounts a ON a.id = t.account_id LEFT JOIN categories c ON c.key = t.category_key
     WHERE t.transfer_peer_id IS NULL AND t.mirror = 0`,
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  const pairs = findTransferPairs(rows);
  for (const p of pairs) {
    const o = byId.get(p.outId)!;
    const i = byId.get(p.inId)!;
    await linkPair(db, o, i, p.categoryKey, o.category_source === 'user' || i.category_source === 'user' ? 'user' : 'rule');
  }
  return pairs.length;
}

/** Procura transferências entre contas em todos os lançamentos já importados. */
export async function detectTransfers(db: SQLiteDatabase): Promise<SelfTransferResult> {
  let out: SelfTransferResult = { logId: null, classified: 0, linked: 0 };
  await db.withTransactionAsync(async () => { out = await applySelfTransfers(db); });
  return out;
}

// ---------------- Importação ----------------


/** Classifica e marca duplicados antes de mostrar a revisão ao usuário. */
export async function prepareImport(db: SQLiteDatabase, accountId: number, st: ParsedStatement): Promise<ImportCandidate[]> {
  if (st.holderName) {
    const h = await loadHolder(db);
    const names = cleanNames([st.holderName]);
    if (names.length && !h?.names.length) await storeHolder(db, names, h?.cpfMiddle ?? null);
  }
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
): Promise<{ imported: number; skipped: number; transfers: number }> {
  let imported = 0;
  let skipped = 0;
  let transfers = 0;
  await db.withTransactionAsync(async () => {
    const imp = await db.runAsync('INSERT INTO imports (file_name, format, account_id) VALUES (?, ?, ?)', args.fileName, args.format, args.accountId);
    for (const c of args.candidates) {
      if (!c.selected) { skipped++; continue; }
      // Contrapartida de transferência lançada antes: o extrato a substitui (sem duplicar).
      const mirror = await db.getFirstAsync<{ id: number }>(
        `SELECT id FROM transactions WHERE account_id = ? AND mirror = 1 AND amount_cents = ?
         AND ABS(julianday(date) - julianday(?)) <= ? ORDER BY ABS(julianday(date) - julianday(?)), id LIMIT 1`,
        args.accountId, c.amountCents, c.date, TRANSFER_WINDOW_DAYS, c.date,
      );
      if (mirror) {
        const u = await db.runAsync(
          `UPDATE OR IGNORE transactions SET date = ?, description = ?, memo = ?, description_key = ?, dedupe_key = ?, import_id = ?, mirror = 0
           WHERE id = ?`,
          c.date, c.description, c.memo ?? null, descriptionKey(c.description), c.dedupeKey, imp.lastInsertRowId, mirror.id,
        );
        if (u.changes) { imported++; transfers++; continue; }
      }
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
    transfers += await linkDetectedTransfers(db);
  });
  return { imported, skipped, transfers };
}


export async function listImports(db: SQLiteDatabase): Promise<ImportRecord[]> {
  return db.getAllAsync<ImportRecord>(
    `SELECT i.*, a.name AS account_name FROM imports i JOIN accounts a ON a.id = i.account_id ORDER BY i.id DESC LIMIT 50`,
  );
}

/** Desfaz uma importação inteira (apaga os lançamentos que vieram dela). */
export async function undoImport(db: SQLiteDatabase, importId: number): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM transactions WHERE mirror = 1 AND transfer_peer_id IN (SELECT id FROM transactions WHERE import_id = ?)', importId);
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

// ---------------- Objetivos ----------------

// Com conta vinculada, as movimentações dela desde a criação do sonho contam como depósitos.
const GOAL_SQL = `SELECT g.*, a.name AS account_name,
  COALESCE((SELECT SUM(e.amount_cents) FROM goal_entries e WHERE e.goal_id = g.id), 0)
    + COALESCE((SELECT SUM(t.amount_cents) FROM transactions t WHERE t.account_id = g.account_id AND t.date >= substr(g.created_at, 1, 10)), 0) AS saved_cents,
  COALESCE((SELECT SUM(e.amount_cents) FROM goal_entries e WHERE e.goal_id = g.id AND e.date >= ?1 AND e.initial = 0), 0)
    + COALESCE((SELECT SUM(t.amount_cents) FROM transactions t WHERE t.account_id = g.account_id AND t.date >= substr(g.created_at, 1, 10) AND t.date >= ?1), 0) AS recent_cents
  FROM goals g LEFT JOIN accounts a ON a.id = g.account_id`;

export async function listGoals(db: SQLiteDatabase, since: string): Promise<Goal[]> {
  return db.getAllAsync<Goal>(`${GOAL_SQL} ORDER BY g.deadline IS NULL, g.deadline, g.id`, since);
}

export async function getGoal(db: SQLiteDatabase, id: number, since: string): Promise<Goal | null> {
  return db.getFirstAsync<Goal>(`${GOAL_SQL} WHERE g.id = ?2`, since, id);
}

export async function saveGoal(db: SQLiteDatabase, g: GoalInput): Promise<number> {
  if (g.id) {
    await db.runAsync(
      'UPDATE goals SET name = ?, template = ?, icon = ?, color = ?, target_cents = ?, deadline = ?, account_id = ? WHERE id = ?',
      g.name, g.template, g.icon, g.color, g.target_cents, g.deadline, g.account_id ?? null, g.id,
    );
    return g.id;
  }
  const r = await db.runAsync(
    'INSERT INTO goals (name, template, icon, color, target_cents, deadline, account_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    g.name, g.template, g.icon, g.color, g.target_cents, g.deadline, g.account_id ?? null,
  );
  return r.lastInsertRowId;
}

export async function deleteGoal(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM goals WHERE id = ?', id);
}

export async function listGoalEntries(db: SQLiteDatabase, goalId: number): Promise<GoalEntry[]> {
  return db.getAllAsync<GoalEntry>(
    `SELECT id, goal_id, date, amount_cents, note, 0 AS auto FROM goal_entries WHERE goal_id = ?1
     UNION ALL
     SELECT t.id, g.id, t.date, t.amount_cents, t.description, 1 FROM goals g JOIN transactions t ON t.account_id = g.account_id
     WHERE g.id = ?1 AND t.date >= substr(g.created_at, 1, 10)
     ORDER BY date DESC, id DESC`, goalId,
  );
}

export async function addGoalEntry(
  db: SQLiteDatabase, goalId: number, e: { date: string; amountCents: number; note?: string | null; initial?: boolean },
): Promise<void> {
  await db.runAsync('INSERT INTO goal_entries (goal_id, date, amount_cents, note, initial) VALUES (?, ?, ?, ?, ?)',
    goalId, e.date, e.amountCents, e.note?.trim() || null, e.initial ? 1 : 0);
}

export async function deleteGoalEntry(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM goal_entries WHERE id = ?', id);
}
