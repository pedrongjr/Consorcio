import pg from 'pg';
import { DEFAULT_CATEGORIES } from '../src/core/categories';

// BIGINT (somas de centavos) chega como string por padrão; os valores cabem em Number.
pg.types.setTypeParser(20, (v) => Number(v));

export type Db = pg.Pool;
export type Tx = pg.PoolClient;

/** Papel sem privilégios especiais usado em todas as consultas de dados (ver `withUser`). */
export const RLS_ROLE = 'financas_rls';

/** Tabelas com dados de usuário. Todas têm `user_id` e Row-Level Security forçado. */
const USER_TABLES = ['accounts', 'categories', 'imports', 'transactions', 'rules', 'budgets'] as const;

export function createPool(connectionString: string): Db {
  const ssl = /sslmode=(require|verify)/.test(connectionString) || process.env.PGSSL === '1' ? { rejectUnauthorized: false } : undefined;
  return new pg.Pool({ connectionString, ssl, max: Number(process.env.PG_POOL_MAX ?? 10) });
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower ON users (lower(email));

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);

CREATE TABLE IF NOT EXISTS accounts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'checking',
  bank TEXT,
  external_key TEXT,
  initial_balance_cents BIGINT NOT NULL DEFAULT 0,
  color TEXT NOT NULL DEFAULT '#2A9D8F',
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, external_key),
  UNIQUE (id, user_id)
);

CREATE TABLE IF NOT EXISTS categories (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  parent TEXT,
  icon TEXT NOT NULL DEFAULT 'pricetag',
  color TEXT NOT NULL DEFAULT '#9E9E9E',
  sort INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, key),
  FOREIGN KEY (user_id, parent) REFERENCES categories(user_id, key) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS imports (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  format TEXT NOT NULL,
  account_id INTEGER NOT NULL,
  imported_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, user_id),
  FOREIGN KEY (account_id, user_id) REFERENCES accounts(id, user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  description TEXT NOT NULL,
  memo TEXT,
  notes TEXT,
  amount_cents BIGINT NOT NULL,
  category_key TEXT,
  category_source TEXT NOT NULL DEFAULT 'none',
  description_key TEXT NOT NULL DEFAULT '',
  dedupe_key TEXT NOT NULL,
  import_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, dedupe_key),
  -- As chaves estrangeiras incluem user_id: não dá para pendurar um lançamento
  -- na conta, categoria ou importação de outro usuário.
  FOREIGN KEY (account_id, user_id) REFERENCES accounts(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, category_key) REFERENCES categories(user_id, key) ON DELETE SET NULL (category_key),
  FOREIGN KEY (import_id, user_id) REFERENCES imports(id, user_id) ON DELETE SET NULL (import_id)
);
CREATE INDEX IF NOT EXISTS tx_user_date ON transactions (user_id, date);
CREATE INDEX IF NOT EXISTS tx_user_desc_key ON transactions (user_id, description_key);

CREATE TABLE IF NOT EXISTS rules (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pattern TEXT NOT NULL,
  category_key TEXT NOT NULL,
  direction TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (user_id, pattern, direction),
  FOREIGN KEY (user_id, category_key) REFERENCES categories(user_id, key) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS budgets (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_key TEXT NOT NULL,
  limit_cents BIGINT NOT NULL,
  PRIMARY KEY (user_id, category_key),
  FOREIGN KEY (user_id, category_key) REFERENCES categories(user_id, key) ON DELETE CASCADE
);
`;

export interface RlsStatus {
  /** As consultas de dados rodam com o papel restrito `financas_rls`. */
  restrictedRole: boolean;
  /** O usuário da conexão ignoraria RLS (superusuário/BYPASSRLS) se não houvesse o papel restrito. */
  connectionBypassesRls: boolean;
}

let rlsStatus: RlsStatus = { restrictedRole: false, connectionBypassesRls: false };
export const getRlsStatus = () => rlsStatus;

/** Cria as tabelas e liga o Row-Level Security. Idempotente. */
export async function migrate(db: Db): Promise<RlsStatus> {
  const c = await db.connect();
  try {
    await c.query('SELECT pg_advisory_lock(424242)');
    await c.query(SCHEMA);
    for (const t of USER_TABLES) {
      await c.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`);
      // FORCE: vale também para o dono da tabela (o usuário da conexão).
      await c.query(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY`);
      await c.query(`DROP POLICY IF EXISTS user_isolation ON ${t}`);
      await c.query(`CREATE POLICY user_isolation ON ${t}
        USING (user_id = NULLIF(current_setting('app.user_id', true), '')::int)
        WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::int)`);
    }

    // Papel restrito: superusuários e papéis com BYPASSRLS ignoram RLS. Para que o
    // isolamento valha mesmo assim, as consultas de dados trocam para este papel.
    let restrictedRole = false;
    try {
      const exists = await c.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [RLS_ROLE]);
      if (!exists.rowCount) await c.query(`CREATE ROLE ${RLS_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS`);
      await c.query(`GRANT ${RLS_ROLE} TO CURRENT_USER`).catch(() => undefined);
      await c.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${USER_TABLES.join(', ')} TO ${RLS_ROLE}`);
      await c.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${RLS_ROLE}`);
      // Confirma que conseguimos assumir o papel.
      await c.query('BEGIN');
      await c.query(`SET LOCAL ROLE ${RLS_ROLE}`);
      await c.query('ROLLBACK');
      restrictedRole = true;
    } catch {
      await c.query('ROLLBACK').catch(() => undefined);
      restrictedRole = false;
    }
    const me = await c.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
    );
    const bypass = !!(me.rows[0]?.rolsuper || me.rows[0]?.rolbypassrls);
    rlsStatus = { restrictedRole, connectionBypassesRls: bypass };
    return rlsStatus;
  } finally {
    await c.query('SELECT pg_advisory_unlock(424242)').catch(() => undefined);
    c.release();
  }
}

/**
 * Executa `fn` numa transação em nome de um usuário. Dentro dela:
 *  - `app.user_id` identifica o usuário para as políticas de RLS;
 *  - se disponível, o papel restrito é assumido (RLS vale mesmo para superusuário).
 * Qualquer linha de outro usuário fica invisível e não pode ser gravada.
 */
export async function withUser<T>(db: Db, userId: number, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!Number.isInteger(userId) || userId <= 0) throw new Error('Usuário inválido');
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    if (rlsStatus.restrictedRole) await c.query(`SET LOCAL ROLE ${RLS_ROLE}`);
    await c.query("SELECT set_config('app.user_id', $1, true)", [String(userId)]);
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

/** Plano de categorias padrão para um usuário novo. */
export async function seedCategories(tx: Tx, userId: number): Promise<void> {
  // Pais antes dos filhos, por causa da chave estrangeira `parent`.
  const ordered = [...DEFAULT_CATEGORIES].sort((a, b) => Number(!!a.parent) - Number(!!b.parent));
  const sortIndex = new Map(DEFAULT_CATEGORIES.map((c, i) => [c.key, i]));
  for (const c of ordered) {
    await tx.query(
      `INSERT INTO categories (user_id, key, name, kind, parent, icon, color, sort)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING`,
      [userId, c.key, c.name, c.kind, c.parent ?? null, c.icon, c.color, sortIndex.get(c.key)],
    );
  }
}
