import type { CategoryRule, ParsedStatement , CategoryKind } from '../src/core/types';
import { Classifier, displayDescription, isGenericText, similarityKey, type HistoryEntry } from '../src/core/classifier';
import { DEFAULT_RULES } from '../src/core/categories';
import { dedupeKeys } from '../src/core/importer';
import { descriptionKey, normalizeText } from '../src/core/text';
import {
  RULE_TOO_GENERIC,
  type Account, type AccountType, type AccountWithBalance, type Category, type ClassificationAction, type ClassificationLogEntry,
  type ClassifyResult, type ImportCandidate, type ImportRecord, type Rule, type RulePreview, type SimilarPreview, type Transaction,
  type TxFilter,
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

/** Pedido válido no formato, mas recusado (a mensagem é mostrada ao usuário). */
export class ValidationError extends Error {}

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
  if (isGenericText(p)) throw new ValidationError(RULE_TOO_GENERIC);
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
  const history: HistoryEntry[] = (await tx.query<{ description: string; memo: string | null; category_key: string; amount_cents: number }>(
    `SELECT description, memo, category_key, amount_cents FROM transactions
     WHERE user_id = $1 AND category_source = 'user' AND category_key IS NOT NULL
     ORDER BY id`,
    [uid],
  )).rows.map((r) => ({
    key: similarityKey(r.description, r.memo), categoryKey: r.category_key, direction: r.amount_cents >= 0 ? 'in' : 'out',
  }));
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

// ---------------- Classificação (com histórico para desfazer) ----------------

type TxRow = { id: number; description: string; memo: string | null; amount_cents: number; category_key: string | null; category_source: string };

async function txRow(tx: Tx, uid: number, id: number): Promise<TxRow> {
  const r = await tx.query<TxRow>(
    'SELECT id, description, memo, amount_cents, category_key, category_source FROM transactions WHERE id = $1 AND user_id = $2',
    [id, uid],
  );
  if (!r.rowCount) throw new NotFoundError('Lançamento');
  return r.rows[0];
}

/** Lançamentos com a mesma descrição (e mesmo sentido) — vazio se a descrição for genérica. */
async function similarRows(tx: Tx, uid: number, t: TxRow): Promise<TxRow[]> {
  const key = similarityKey(t.description, t.memo);
  if (!key) return [];
  const r = await tx.query<TxRow>(
    `SELECT id, description, memo, amount_cents, category_key, category_source FROM transactions
     WHERE user_id = $1 AND description_key = $2 AND id <> $3 AND (amount_cents >= 0) = ($4::bigint >= 0)`,
    [uid, descriptionKey(t.description), t.id, t.amount_cents],
  );
  return r.rows.filter((x) => similarityKey(x.description, x.memo) === key);
}

/** Lançamentos ainda não categorizados à mão que o padrão alcança. */
async function ruleRows(tx: Tx, uid: number, pattern: string, direction: 'in' | 'out' | null, onlyAuto: boolean): Promise<TxRow[]> {
  const c = new Classifier([{ pattern, categoryKey: '_', direction: direction ?? undefined, source: 'user' }]);
  const r = await tx.query<TxRow>(
    `SELECT id, description, memo, amount_cents, category_key, category_source FROM transactions
     WHERE user_id = $1 ${onlyAuto ? "AND category_source <> 'user'" : ''} ORDER BY date DESC, id DESC`,
    [uid],
  );
  return r.rows.filter((x) => c.classify({ description: x.description, memo: x.memo ?? undefined, amountCents: x.amount_cents }).rule);
}

export async function previewSimilar(tx: Tx, uid: number, txId: number): Promise<SimilarPreview> {
  const t = await txRow(tx, uid, txId);
  if (!similarityKey(t.description, t.memo)) return { count: 0, generic: true };
  return { count: (await similarRows(tx, uid, t)).length, generic: false };
}

export async function previewRule(tx: Tx, uid: number, pattern: string, direction: 'in' | 'out' | null): Promise<RulePreview> {
  const p = normalizeText(pattern);
  if (!p) return { count: 0, generic: false, examples: [] };
  if (isGenericText(p)) return { count: 0, generic: true, examples: [] };
  const rows = await ruleRows(tx, uid, p, direction, false);
  return { count: rows.length, generic: false, examples: [...new Set(rows.map((r) => displayDescription(r.description, r.memo)))].slice(0, 3) };
}

class LogWriter {
  private items: { id: number; oldCat: string | null; oldSource: string; newCat: string | null }[] = [];
  private seen = new Set<number>();
  constructor(private tx: Tx, private uid: number) {}

  async set(row: TxRow, categoryKey: string | null, source: string): Promise<boolean> {
    if (this.seen.has(row.id)) return false;
    if (row.category_key === categoryKey && row.category_source === source) return false;
    this.seen.add(row.id);
    await this.tx.query('UPDATE transactions SET category_key = $1, category_source = $2 WHERE id = $3 AND user_id = $4',
      [categoryKey, source, row.id, this.uid]);
    this.items.push({ id: row.id, oldCat: row.category_key, oldSource: row.category_source, newCat: categoryKey });
    return true;
  }

  get count() { return this.items.length; }

  async save(entry: {
    action: ClassificationAction; categoryKey: string | null; label: string;
    rule?: { id: number; pattern: string; direction: 'in' | 'out' | null; prevCategory: string | null };
  }): Promise<number | null> {
    if (!this.items.length && !entry.rule) return null;
    const id = (await this.tx.query<{ id: number }>(
      `INSERT INTO class_log (user_id, action, category_key, label, rule_id, rule_pattern, rule_direction, rule_prev_category, tx_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [this.uid, entry.action, entry.categoryKey, entry.label.slice(0, 300), entry.rule?.id ?? null, entry.rule?.pattern ?? null,
        entry.rule?.direction ?? null, entry.rule?.prevCategory ?? null, this.items.length],
    )).rows[0].id;
    for (const it of this.items) {
      await this.tx.query(
        `INSERT INTO class_log_items (log_id, user_id, transaction_id, old_category_key, old_source, new_category_key)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, this.uid, it.id, it.oldCat, it.oldSource, it.newCat],
      );
    }
    // Mantém só os 200 registros mais recentes.
    await this.tx.query(
      'DELETE FROM class_log WHERE user_id = $1 AND id NOT IN (SELECT id FROM class_log WHERE user_id = $1 ORDER BY id DESC LIMIT 200)',
      [this.uid],
    );
    return id;
  }
}

/** Cria/atualiza a regra e a aplica aos lançamentos não categorizados à mão. */
async function applyNewRule(
  tx: Tx, uid: number, log: LogWriter, pattern: string, categoryKey: string, direction: 'in' | 'out' | null,
): Promise<{ id: number; pattern: string; direction: 'in' | 'out' | null; prevCategory: string | null; applied: number }> {
  const p = normalizeText(pattern);
  if (!p || isGenericText(p)) throw new ValidationError(RULE_TOO_GENERIC);
  const prev = await tx.query<{ category_key: string }>(
    'SELECT category_key FROM rules WHERE user_id = $1 AND pattern = $2 AND direction IS NOT DISTINCT FROM $3', [uid, p, direction],
  );
  await saveRule(tx, uid, p, categoryKey, direction);
  const id = (await tx.query<{ id: number }>(
    'SELECT id FROM rules WHERE user_id = $1 AND pattern = $2 AND direction IS NOT DISTINCT FROM $3', [uid, p, direction],
  )).rows[0].id;
  let applied = 0;
  for (const r of await ruleRows(tx, uid, p, direction, true)) if (await log.set(r, categoryKey, 'user')) applied++;
  return { id, pattern: p, direction, prevCategory: prev.rows[0]?.category_key ?? null, applied };
}

/**
 * Muda a categoria de um lançamento e, opcionalmente, dos semelhantes e/ou
 * cria uma regra. Tudo fica registrado no histórico para poder ser desfeito.
 */
export async function classifyTransaction(
  tx: Tx, uid: number,
  args: { txId: number; categoryKey: string; applySimilar: boolean; rule?: { pattern: string; direction: 'in' | 'out' | null } | null },
): Promise<ClassifyResult> {
  const key = await validCategory(tx, uid, args.categoryKey);
  if (!key) throw new NotFoundError('Categoria');
  if (args.rule && isGenericText(args.rule.pattern)) throw new ValidationError(RULE_TOO_GENERIC);
  const t = await txRow(tx, uid, args.txId);
  const log = new LogWriter(tx, uid);
  await log.set(t, key, 'user');
  let similar = 0;
  if (args.applySimilar) for (const r of await similarRows(tx, uid, t)) if (await log.set(r, key, 'user')) similar++;
  const rule = args.rule ? await applyNewRule(tx, uid, log, args.rule.pattern, key, args.rule.direction) : undefined;
  const logId = await log.save({
    action: rule ? 'rule' : similar ? 'similar' : 'manual', categoryKey: key, label: displayDescription(t.description, t.memo), rule,
  });
  return { logId, changed: log.count, similar, byRule: rule?.applied ?? 0 };
}

/** Cria uma regra (tela de regras) e a aplica aos lançamentos não categorizados à mão. */
export async function createRule(
  tx: Tx, uid: number, pattern: string, categoryKey: string, direction: 'in' | 'out' | null,
): Promise<ClassifyResult> {
  if (!(await validCategory(tx, uid, categoryKey))) throw new NotFoundError('Categoria');
  const log = new LogWriter(tx, uid);
  const rule = await applyNewRule(tx, uid, log, pattern, categoryKey, direction);
  const logId = await log.save({ action: 'rule', categoryKey, label: `Regra “${rule.pattern}”`, rule });
  return { logId, changed: log.count, similar: 0, byRule: rule.applied };
}

/**
 * Descarta a categoria escolhida à mão destes lançamentos e os classifica de
 * novo automaticamente (regras + aprendizado). Útil para corrigir uma
 * alteração em massa feita por engano.
 */
export async function resetClassification(tx: Tx, uid: number, ids: number[]): Promise<ClassifyResult> {
  const unique = [...new Set(ids)];
  const rows = (await tx.query<TxRow>(
    `SELECT id, description, memo, amount_cents, category_key, category_source FROM transactions
     WHERE user_id = $1 AND id = ANY($2::int[])`,
    [uid, unique],
  )).rows;
  // O classificador não deve aprender com os próprios lançamentos que estão sendo refeitos.
  await tx.query("UPDATE transactions SET category_source = 'none' WHERE user_id = $1 AND id = ANY($2::int[]) AND category_source = 'user'", [uid, unique]);
  const classifier = await buildClassifier(tx, uid);
  const log = new LogWriter(tx, uid);
  for (const r of rows) {
    const c = classifier.classify({ description: r.description, memo: r.memo ?? undefined, amountCents: r.amount_cents });
    // `r` ainda tem os valores originais: o histórico guarda a origem verdadeira.
    if (!(await log.set(r, c.categoryKey, c.confidence))) {
      await tx.query('UPDATE transactions SET category_source = $1 WHERE id = $2 AND user_id = $3', [r.category_source, r.id, uid]);
    }
  }
  const logId = await log.save({ action: 'reset', categoryKey: null, label: `${rows.length} lançamento(s) reclassificados automaticamente` });
  return { logId, changed: log.count, similar: 0, byRule: 0 };
}

export async function listClassificationLog(tx: Tx, uid: number): Promise<ClassificationLogEntry[]> {
  const r = await tx.query<ClassificationLogEntry>(
    `SELECT id, action, category_key, label, rule_pattern, tx_count, undone,
            to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
     FROM class_log WHERE user_id = $1 ORDER BY id DESC LIMIT 200`,
    [uid],
  );
  return r.rows;
}

/**
 * Desfaz um registro do histórico: devolve a categoria anterior aos
 * lançamentos que ainda estão como ele deixou (alterações posteriores são
 * preservadas) e desfaz a regra criada. Retorna quantos lançamentos voltaram.
 */
export async function undoClassification(tx: Tx, uid: number, logId: number): Promise<number> {
  const log = (await tx.query<{ undone: number; category_key: string | null; rule_id: number | null; rule_pattern: string | null; rule_direction: 'in' | 'out' | null; rule_prev_category: string | null }>(
    'SELECT undone, category_key, rule_id, rule_pattern, rule_direction, rule_prev_category FROM class_log WHERE id = $1 AND user_id = $2 FOR UPDATE',
    [logId, uid],
  )).rows[0];
  if (!log) throw new NotFoundError('Registro');
  if (log.undone) return 0;
  const items = (await tx.query<{ transaction_id: number; old_category_key: string | null; old_source: string; new_category_key: string | null }>(
    'SELECT transaction_id, old_category_key, old_source, new_category_key FROM class_log_items WHERE log_id = $1 AND user_id = $2',
    [logId, uid],
  )).rows;
  let restored = 0;
  for (const it of items) {
    const r = await tx.query(
      `UPDATE transactions SET category_key = $1, category_source = $2
       WHERE id = $3 AND user_id = $4 AND category_key IS NOT DISTINCT FROM $5`,
      [await validCategory(tx, uid, it.old_category_key), it.old_source, it.transaction_id, uid, it.new_category_key],
    );
    restored += r.rowCount ?? 0;
  }
  if (log.rule_id && log.rule_pattern) {
    if (log.rule_prev_category && (await validCategory(tx, uid, log.rule_prev_category))) {
      await tx.query('UPDATE rules SET category_key = $1 WHERE id = $2 AND user_id = $3 AND category_key = $4',
        [log.rule_prev_category, log.rule_id, uid, log.category_key]);
    } else {
      await tx.query('DELETE FROM rules WHERE id = $1 AND user_id = $2 AND pattern = $3 AND category_key IS NOT DISTINCT FROM $4',
        [log.rule_id, uid, log.rule_pattern, log.category_key]);
    }
  }
  await tx.query('UPDATE class_log SET undone = 1 WHERE id = $1 AND user_id = $2', [logId, uid]);
  return restored;
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
