import type { SQLiteDatabase } from 'expo-sqlite';
import { DEFAULT_CATEGORIES } from '../core/categories';

export const DB_NAME = 'financas.db';
const SCHEMA_VERSION = 5;

/** Cria/migra o banco local. Tudo fica só no aparelho do usuário. */
export async function migrate(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  if (current >= SCHEMA_VERSION) return;

  if (current < 1) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'checking',      -- checking | savings | credit_card | cash | investment
        bank TEXT,
        external_key TEXT UNIQUE,                    -- banco|agência|conta vindo do OFX
        initial_balance_cents INTEGER NOT NULL DEFAULT 0,
        color TEXT NOT NULL DEFAULT '#2A9D8F',
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS categories (
        key TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,                          -- expense | income | transfer
        parent TEXT REFERENCES categories(key) ON DELETE CASCADE,
        icon TEXT NOT NULL DEFAULT 'pricetag',
        color TEXT NOT NULL DEFAULT '#9E9E9E',
        sort INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS imports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_name TEXT NOT NULL,
        format TEXT NOT NULL,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        imported_count INTEGER NOT NULL DEFAULT 0,
        skipped_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        description TEXT NOT NULL,
        memo TEXT,
        notes TEXT,
        amount_cents INTEGER NOT NULL,
        category_key TEXT REFERENCES categories(key) ON DELETE SET NULL,
        category_source TEXT NOT NULL DEFAULT 'none', -- user | rule | history | none
        description_key TEXT NOT NULL DEFAULT '',
        dedupe_key TEXT NOT NULL,
        import_id INTEGER REFERENCES imports(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (account_id, dedupe_key)
      );
      CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date);
      CREATE INDEX IF NOT EXISTS idx_tx_category ON transactions(category_key);
      CREATE INDEX IF NOT EXISTS idx_tx_desc_key ON transactions(description_key);
      CREATE TABLE IF NOT EXISTS rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pattern TEXT NOT NULL,
        category_key TEXT NOT NULL REFERENCES categories(key) ON DELETE CASCADE,
        direction TEXT,                              -- in | out | NULL
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (pattern, direction)
      );
      CREATE TABLE IF NOT EXISTS budgets (
        category_key TEXT PRIMARY KEY REFERENCES categories(key) ON DELETE CASCADE,
        limit_cents INTEGER NOT NULL
      );
    `);
    let sort = 0;
    for (const c of DEFAULT_CATEGORIES) {
      await db.runAsync(
        'INSERT OR IGNORE INTO categories (key, name, kind, parent, icon, color, sort) VALUES (?, ?, ?, ?, ?, ?, ?)',
        c.key, c.name, c.kind, c.parent ?? null, c.icon, c.color, sort++,
      );
    }
  }
  if (current < 2) {
    // Histórico de classificações (para desfazer alterações de categoria).
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS class_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,                        -- manual | similar | rule | reset
        category_key TEXT,
        label TEXT NOT NULL,
        rule_id INTEGER,
        rule_pattern TEXT,
        rule_direction TEXT,
        rule_prev_category TEXT,
        tx_count INTEGER NOT NULL DEFAULT 0,
        undone INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      );
      CREATE TABLE IF NOT EXISTS class_log_items (
        log_id INTEGER NOT NULL REFERENCES class_log(id) ON DELETE CASCADE,
        transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
        old_category_key TEXT,
        old_source TEXT NOT NULL,
        new_category_key TEXT,
        PRIMARY KEY (log_id, transaction_id)
      );
    `);
  }
  if (current < 3) {
    // Objetivos ("sonhos") e os depósitos/retiradas de cada um.
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS goals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        template TEXT NOT NULL DEFAULT 'outro',
        icon TEXT NOT NULL DEFAULT 'star',
        color TEXT NOT NULL DEFAULT '#74B816',
        target_cents INTEGER NOT NULL,
        deadline TEXT,                               -- YYYY-MM
        created_at TEXT NOT NULL DEFAULT (date('now'))
      );
      CREATE TABLE IF NOT EXISTS goal_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        goal_id INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        note TEXT,
        initial INTEGER NOT NULL DEFAULT 0          -- já estava guardado ao criar
      );
      CREATE INDEX IF NOT EXISTS idx_goal_entries_goal ON goal_entries(goal_id);
    `);
  }
  if (current < 4) {
    // Transferências entre contas (par de lançamentos) e conta vinculada ao sonho.
    await db.execAsync(`
      ALTER TABLE transactions ADD COLUMN transfer_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL;
      ALTER TABLE transactions ADD COLUMN transfer_peer_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL;
      ALTER TABLE transactions ADD COLUMN mirror INTEGER NOT NULL DEFAULT 0;
      CREATE INDEX IF NOT EXISTS idx_tx_peer ON transactions(transfer_peer_id);
      ALTER TABLE goals ADD COLUMN account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL;
    `);
  }
  if (current < 5) {
    // Titular das contas (nomes e 6 dígitos do meio do CPF).
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS holder_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        names TEXT NOT NULL DEFAULT '',
        cpf_middle TEXT
      );
    `);
  }
  await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}
