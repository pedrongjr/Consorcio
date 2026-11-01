import type { SQLiteDatabase } from 'expo-sqlite';
import { DEFAULT_CATEGORIES } from '../core/categories';

export const DB_NAME = 'financas.db';
const SCHEMA_VERSION = 1;

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
  await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}
