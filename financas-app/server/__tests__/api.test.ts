import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { createPool, migrate, withUser, type Db } from '../db';

/**
 * Testes de ponta a ponta da API contra um Postgres real.
 * Defina TEST_DATABASE_URL (ex.: postgres://postgres:senha@localhost:5432/postgres);
 * um banco temporário é criado e apagado ao final.
 */
const ADMIN_URL = process.env.TEST_DATABASE_URL;
const suite = ADMIN_URL ? describe : describe.skip;

let db: Db;
/** Conexão de verificação (superusuário no banco de teste), para inspecionar as tabelas. */
let raw: Db;
let server: Server;
let base: string;
let dbName: string;

class Client {
  cookie = '';
  constructor(public origin?: string) {}
  async call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-requested-with': 'fetch',
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(this.origin ? { origin: this.origin } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    const json = await res.json().catch(() => null);
    return { status: res.status, body: json, headers: res.headers };
  }
  post(path: string, body?: unknown, headers?: Record<string, string>) { return this.call('POST', path, body ?? {}, headers); }
  async rpc<T = unknown>(fn: string, ...args: unknown[]): Promise<{ status: number; result: T; error?: string }> {
    const r = await this.post(`/api/rpc/${fn}`, { args });
    return { status: r.status, result: r.body?.result, error: r.body?.error };
  }
}

const STRONG = 'Cavalo-Bateria-42';

const statement = (desc: string) => ({
  format: 'csv',
  warnings: [],
  transactions: [
    { date: '2025-01-05', description: `SUPERMERCADO ${desc}`, amountCents: -12345 },
    { date: '2025-01-06', description: `SALARIO ${desc}`, amountCents: 500000 },
    { date: '2025-01-07', description: `NETFLIX ${desc}`, amountCents: -3990 },
  ],
});

async function registerWithData(email: string, tag: string) {
  const c = new Client();
  const r = await c.post('/api/auth/register', { email, password: STRONG, name: tag });
  expect(r.status).toBe(201);
  const accountId = (await c.rpc<number>('saveAccount', { name: `Conta ${tag}`, type: 'checking' })).result;
  const candidates = (await c.rpc<{ selected: boolean }[]>('prepareImport', accountId, statement(tag))).result;
  const commit = await c.rpc<{ imported: number }>('commitImport', { accountId, fileName: `${tag}.csv`, format: 'csv', candidates });
  expect(commit.result.imported).toBe(3);
  await c.rpc('saveRule', 'PADARIA', 'alimentacao.padaria', 'out');
  await c.rpc('setBudget', 'alimentacao', 50000);
  const catKey = (await c.rpc<string>('saveCategory', { name: `Minha ${tag}`, kind: 'expense', parent: null, icon: 'pricetag', color: '#123456' })).result;
  const txs = (await c.rpc<{ id: number; description: string; amount_cents: number }[]>('listTransactions', {})).result;
  const imports = (await c.rpc<{ id: number }[]>('listImports')).result;
  const rules = (await c.rpc<{ id: number }[]>('listRules')).result;
  return { c, accountId, txs, txIds: txs.map((t) => t.id), importId: imports[0].id, ruleId: rules[0].id, catKey };
}

// Dois cenários: conexão como superusuário (usa o papel restrito) e como dono
// comum das tabelas, sem privilégios especiais (como no Render/Neon), onde vale
// o FORCE ROW LEVEL SECURITY.
for (const asOwner of [false, true]) suite(`API web (${asOwner ? 'dono comum' : 'superusuário'}): autenticação e isolamento entre usuários`, () => {
  let rls: Awaited<ReturnType<typeof migrate>>;
  beforeAll(async () => {
    dbName = `financas_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    if (asOwner) {
      const exists = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = 'financas_owner_test'");
      if (!exists.rowCount) await admin.query("CREATE ROLE financas_owner_test LOGIN PASSWORD 'owner-pw' NOSUPERUSER NOCREATEROLE NOBYPASSRLS");
      await admin.query(`CREATE DATABASE ${dbName} OWNER financas_owner_test`);
    } else {
      await admin.query(`CREATE DATABASE ${dbName}`);
    }
    await admin.end();
    const url = new URL(ADMIN_URL!);
    url.pathname = `/${dbName}`;
    raw = createPool(url.toString());
    if (asOwner) {
      // O dono comum precisa poder criar tabelas no schema public do banco.
      await raw.query('GRANT ALL ON SCHEMA public TO financas_owner_test');
      url.username = 'financas_owner_test';
      url.password = 'owner-pw';
    }
    db = createPool(url.toString());
    rls = await migrate(db);
    expect(rls.connectionBypassesRls).toBe(!asOwner);
    const app = createApp({ db, secureCookies: false, limits: { loginPerIp: 1000, loginPerEmail: 1000, registerPerIp: 1000, windowMs: 60_000 } });
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server?.close();
    await db?.end();
    await raw?.end();
    if (ADMIN_URL && dbName) {
      const admin = new pg.Client({ connectionString: ADMIN_URL });
      await admin.connect();
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await admin.end();
    }
  });

  describe('cadastro e login', () => {
    it('cadastra, mantém a sessão e recusa e-mail repetido (sem diferenciar maiúsculas)', async () => {
      const c = new Client();
      const r = await c.post('/api/auth/register', { email: 'Maria@Exemplo.com', password: STRONG, name: 'Maria' });
      expect(r.status).toBe(201);
      expect(r.body.user.email).toBe('maria@exemplo.com');
      expect((await c.call('GET', '/api/auth/me')).body.user.email).toBe('maria@exemplo.com');
      expect((await new Client().post('/api/auth/register', { email: 'MARIA@exemplo.com', password: STRONG })).status).toBe(409);
      // Categorias padrão criadas para o novo usuário.
      expect((await c.rpc<unknown[]>('listCategories')).result.length).toBeGreaterThan(40);
    });

    it('recusa senha fraca e e-mail inválido', async () => {
      expect((await new Client().post('/api/auth/register', { email: 'fraca@x.com', password: '1234567' })).status).toBe(400);
      expect((await new Client().post('/api/auth/register', { email: 'fraca@x.com', password: '12345678' })).body.error).toMatch(/comum/);
      expect((await new Client().post('/api/auth/register', { email: 'nao-e-email', password: STRONG })).status).toBe(400);
    });

    it('não guarda a senha em texto e usa scrypt com sal', async () => {
      const r = await raw.query<{ password_hash: string }>("SELECT password_hash FROM users WHERE email = 'maria@exemplo.com'");
      expect(r.rows[0].password_hash).toMatch(/^scrypt\$32768\$8\$1\$/);
      expect(r.rows[0].password_hash).not.toContain(STRONG);
    });

    it('login com senha errada e com e-mail inexistente dá a mesma resposta', async () => {
      const wrong = await new Client().post('/api/auth/login', { email: 'maria@exemplo.com', password: 'errada-123' });
      const unknown = await new Client().post('/api/auth/login', { email: 'ninguem@exemplo.com', password: 'errada-123' });
      expect(wrong.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect(wrong.body.error).toBe(unknown.body.error);
      const ok = new Client();
      expect((await ok.post('/api/auth/login', { email: 'MARIA@exemplo.com', password: STRONG })).status).toBe(200);
    });

    it('cookie de sessão é HttpOnly e SameSite, e só o hash do token vai para o banco', async () => {
      const c = new Client();
      const r = await c.post('/api/auth/login', { email: 'maria@exemplo.com', password: STRONG });
      const set = r.headers.get('set-cookie')!;
      expect(set).toMatch(/HttpOnly/);
      expect(set).toMatch(/SameSite=Lax/);
      const token = c.cookie.split('=')[1];
      const s = await raw.query('SELECT 1 FROM sessions WHERE token_hash = $1', [token]);
      expect(s.rowCount).toBe(0);
    });

    it('logout invalida a sessão no servidor', async () => {
      const c = new Client();
      await c.post('/api/auth/login', { email: 'maria@exemplo.com', password: STRONG });
      const stolen = c.cookie;
      await c.post('/api/auth/logout');
      const replay = new Client();
      replay.cookie = stolen;
      expect((await replay.rpc('listAccounts')).status).toBe(401);
    });

    it('trocar a senha derruba as outras sessões', async () => {
      const a = new Client();
      await a.post('/api/auth/register', { email: 'troca@exemplo.com', password: STRONG });
      const other = new Client();
      await other.post('/api/auth/login', { email: 'troca@exemplo.com', password: STRONG });
      expect((await a.post('/api/auth/password', { current: STRONG, next: 'Outra-Senha-Forte-9' })).status).toBe(200);
      expect((await other.rpc('listAccounts')).status).toBe(401);
      expect((await a.rpc('listAccounts')).status).toBe(200);
      expect((await new Client().post('/api/auth/login', { email: 'troca@exemplo.com', password: STRONG })).status).toBe(401);
    });

    it('bloqueia a conta após 10 senhas erradas', async () => {
      await new Client().post('/api/auth/register', { email: 'alvo@exemplo.com', password: STRONG });
      for (let i = 0; i < 10; i++) await new Client().post('/api/auth/login', { email: 'alvo@exemplo.com', password: `errada-${i}-xx` });
      const r = await new Client().post('/api/auth/login', { email: 'alvo@exemplo.com', password: STRONG });
      expect(r.status).toBe(429);
    });
  });

  describe('proteções da API', () => {
    it('exige login para qualquer dado', async () => {
      const anon = new Client();
      for (const fn of ['listAccounts', 'listTransactions', 'exportCsv', 'listImports']) {
        expect((await anon.rpc(fn)).status).toBe(401);
      }
    });

    it('bloqueia CSRF: sem o cabeçalho próprio ou com origem de outro site', async () => {
      const c = new Client();
      await c.post('/api/auth/login', { email: 'maria@exemplo.com', password: STRONG });
      expect((await c.post('/api/rpc/listAccounts', { args: [] }, { 'x-requested-with': '' })).status).toBe(403);
      expect((await c.post('/api/rpc/listAccounts', { args: [] }, { origin: 'https://site-malicioso.com' })).status).toBe(403);
      expect((await c.post('/api/rpc/listAccounts', { args: [] })).status).toBe(200);
    });

    it('recusa funções desconhecidas e parâmetros inválidos', async () => {
      const c = new Client();
      await c.post('/api/auth/login', { email: 'maria@exemplo.com', password: STRONG });
      for (const fn of ['__proto__', 'constructor', 'toString', 'migrate', 'withUser']) expect((await c.rpc(fn)).status).toBe(404);
      expect((await c.rpc('getTransaction', 'abc')).status).toBe(400);
      expect((await c.rpc('listTransactions', { month: "2025-01' OR 1=1 --" })).status).toBe(400);
      expect((await c.rpc('saveAccount', { name: 'x', type: 'checking', color: 'red;}' })).status).toBe(400);
    });

    it('envia cabeçalhos de segurança', async () => {
      const r = await new Client().call('GET', '/api/auth/me');
      expect(r.headers.get('content-security-policy')).toMatch(/frame-ancestors 'none'/);
      expect(r.headers.get('x-content-type-options')).toBe('nosniff');
      expect(r.headers.get('x-frame-options')).toBe('DENY');
      expect(r.headers.get('cache-control')).toBe('no-store');
    });

    it('a busca trata % e _ literalmente e não quebra com aspas', async () => {
      const c = new Client();
      await c.post('/api/auth/login', { email: 'maria@exemplo.com', password: STRONG });
      expect((await c.rpc<unknown[]>('listTransactions', { search: "%' OR '1'='1" })).result).toEqual([]);
    });
  });

  describe('isolamento: um usuário não acessa os dados de outro', () => {
    let A: Awaited<ReturnType<typeof registerWithData>>;
    let B: Awaited<ReturnType<typeof registerWithData>>;

    beforeAll(async () => {
      A = await registerWithData('ana@exemplo.com', 'ANA');
      B = await registerWithData('bruno@exemplo.com', 'BRUNO');
    });

    it('cada um só lista o que é seu', async () => {
      const accA = (await A.c.rpc<{ name: string }[]>('listAccounts')).result;
      const accB = (await B.c.rpc<{ name: string }[]>('listAccounts')).result;
      expect(accA.map((a) => a.name)).toEqual(['Conta ANA']);
      expect(accB.map((a) => a.name)).toEqual(['Conta BRUNO']);
      const txB = (await B.c.rpc<{ description: string }[]>('listTransactions', {})).result;
      expect(txB).toHaveLength(3);
      expect(txB.every((t) => t.description.includes('BRUNO'))).toBe(true);
      expect((await B.c.rpc<unknown[]>('listImports')).result).toHaveLength(1);
      expect((await B.c.rpc<{ pattern: string }[]>('listRules')).result).toHaveLength(1);
      const csvB = (await B.c.rpc<string>('exportCsv')).result;
      expect(csvB).not.toContain('ANA');
      const catsB = (await B.c.rpc<{ key: string }[]>('listCategories')).result.map((c) => c.key);
      expect(catsB).toContain(B.catKey);
      expect(catsB).not.toContain(A.catKey);
      const report = (await B.c.rpc<unknown[]>('reportTransactions', '2025-01', '2025-01')).result;
      expect(report).toHaveLength(3);
    });

    it('B não lê lançamentos de A, mesmo adivinhando o ID', async () => {
      for (const id of A.txIds) expect((await B.c.rpc('getTransaction', id)).result).toBeNull();
      const byAccount = (await B.c.rpc<unknown[]>('listTransactions', { accountId: A.accountId })).result;
      expect(byAccount).toEqual([]);
      expect((await B.c.rpc('findAccountByExternalKey', 'qualquer')).result).toBeNull();
    });

    it('B não altera nem apaga dados de A', async () => {
      const [t1, t2] = A.txIds;
      expect((await B.c.rpc('updateTransaction', t1, { description: 'HACK', amount_cents: 1 })).status).toBe(404);
      expect((await B.c.rpc('classifyTransaction', { txId: t1, categoryKey: 'lazer', applySimilar: true })).status).toBe(404);
      expect((await B.c.rpc<{ changed: number }>('resetClassification', [t1, t2])).result.changed).toBe(0);
      expect((await B.c.rpc('previewSimilar', t1)).status).toBe(404);
      const aLog = (await A.c.rpc<{ logId: number }>('classifyTransaction', { txId: t1, categoryKey: 'lazer', applySimilar: false })).result.logId;
      expect((await B.c.rpc('undoClassification', aLog)).status).toBe(404);
      expect((await B.c.rpc<unknown[]>('listClassificationLog')).result).toEqual([]);
      expect((await A.c.rpc<number>('undoClassification', aLog)).result).toBe(1);
      await B.c.rpc('deleteTransaction', t2);
      await B.c.rpc('deleteAccount', A.accountId);
      await B.c.rpc('undoImport', A.importId);
      await B.c.rpc('deleteRule', A.ruleId);
      await B.c.rpc('deleteCategory', 'alimentacao');
      await B.c.rpc('setBudget', 'alimentacao', null);
      expect((await B.c.rpc('saveAccount', { id: A.accountId, name: 'Roubada', type: 'checking' })).status).toBe(404);

      const txA = (await A.c.rpc<{ id: number; description: string; amount_cents: number }[]>('listTransactions', {})).result;
      // Tudo de A continua exatamente como antes do ataque.
      expect(txA).toEqual(A.txs.map((t) => expect.objectContaining({ id: t.id, description: t.description, amount_cents: t.amount_cents })));
      expect((await A.c.rpc<{ name: string }[]>('listAccounts')).result[0].name).toBe('Conta ANA');
      expect((await A.c.rpc<unknown[]>('listImports')).result).toHaveLength(1);
      expect((await A.c.rpc<unknown[]>('listRules')).result).toHaveLength(1);
      expect((await A.c.rpc<{ categoryKey: string }[]>('listBudgets')).result).toEqual([{ categoryKey: 'alimentacao', limitCents: 50000 }]);
      expect((await A.c.rpc<{ key: string }[]>('listCategories')).result.some((c) => c.key === 'alimentacao')).toBe(true);
    });

    it('B não importa nem lança na conta de A', async () => {
      expect((await B.c.rpc('prepareImport', A.accountId, statement('INVASOR'))).status).toBe(404);
      const fake = statement('INVASOR').transactions.map((t, i) => ({ ...t, dedupeKey: `x${i}`, categoryKey: 'lazer', categorySource: 'rule', duplicate: false, selected: true }));
      expect((await B.c.rpc('commitImport', { accountId: A.accountId, fileName: 'x.csv', format: 'csv', candidates: fake })).status).toBe(404);
      expect((await B.c.rpc('addManualTransaction', { accountId: A.accountId, date: '2025-01-09', description: 'INVASOR', amountCents: -1, categoryKey: null })).status).toBe(404);
      expect((await A.c.rpc<unknown[]>('listTransactions', {})).result).toHaveLength(3);
    });

    it('o banco (Row-Level Security) esconde linhas de outros mesmo sem filtro na consulta', async () => {
      const aId = (await raw.query<{ id: number }>("SELECT id FROM users WHERE email = 'ana@exemplo.com'")).rows[0].id;
      const bId = (await raw.query<{ id: number }>("SELECT id FROM users WHERE email = 'bruno@exemplo.com'")).rows[0].id;
      await withUser(db, bId, async (tx) => {
        const all = await tx.query('SELECT user_id FROM transactions');
        expect(all.rows.every((r) => r.user_id === bId)).toBe(true);
        expect((await tx.query('SELECT 1 FROM accounts WHERE user_id = $1', [aId])).rowCount).toBe(0);
        expect((await tx.query('UPDATE transactions SET description = $1 WHERE user_id = $2', ['X', aId])).rowCount).toBe(0);
        expect((await tx.query('DELETE FROM accounts WHERE user_id = $1', [aId])).rowCount).toBe(0);
      });
      // Gravar uma linha em nome de outro usuário é recusado pela política.
      await expect(withUser(db, bId, (tx) =>
        tx.query("INSERT INTO accounts (user_id, name) VALUES ($1, 'falsa')", [aId]),
      )).rejects.toThrow(/row-level security/);
      // Pendurar um lançamento próprio na conta de outro é recusado pela chave estrangeira.
      await expect(withUser(db, bId, (tx) =>
        tx.query("INSERT INTO transactions (user_id, account_id, date, description, amount_cents, dedupe_key) VALUES ($1, $2, '2025-01-01', 'x', 1, 'k')", [bId, A.accountId]),
      )).rejects.toThrow();
      // Sem usuário definido, nada é visível (nem para o dono das tabelas).
      const c = await db.connect();
      try {
        await c.query('BEGIN');
        if (rls.restrictedRole) await c.query('SET LOCAL ROLE financas_rls');
        expect((await c.query('SELECT 1 FROM transactions')).rowCount).toBe(0);
        await c.query('ROLLBACK');
      } finally { c.release(); }
    });

    it('excluir a conta apaga todos os dados do usuário e só dele', async () => {
      const z = await registerWithData('zeca@exemplo.com', 'ZECA');
      expect((await z.c.post('/api/auth/delete-account', { password: 'errada' })).status).toBe(401);
      expect((await z.c.post('/api/auth/delete-account', { password: STRONG })).status).toBe(200);
      const left = await raw.query("SELECT count(*)::int AS n FROM transactions WHERE description LIKE '%ZECA%'");
      // Confere que a verificação enxerga dados de verdade (A continua com 3).
      expect((await raw.query("SELECT count(*)::int AS n FROM transactions WHERE description LIKE '%ANA%'")).rows[0].n).toBe(3);
      expect(left.rows[0].n).toBe(0);
      expect((await A.c.rpc<unknown[]>('listTransactions', {})).result).toHaveLength(3);
      expect((await new Client().post('/api/auth/login', { email: 'zeca@exemplo.com', password: STRONG })).status).toBe(401);
    });
  });

  describe('classificação: semelhantes, regras e histórico', () => {
    const pix = (desc: string, memo: string | undefined, cents: number, day: number) =>
      ({ date: `2025-03-${String(day).padStart(2, '0')}`, description: desc, memo, amountCents: cents });
    let C: Client;
    let ids: Record<string, number>;
    const cat = async () => Object.fromEntries((await C.rpc<{ id: number; category_key: string | null; category_source: string }[]>('listTransactions', {}))
      .result.map((t) => [t.id, `${t.category_key}|${t.category_source}`]));

    beforeAll(async () => {
      C = new Client();
      await C.post('/api/auth/register', { email: 'carla@exemplo.com', password: STRONG, name: 'Carla' });
      const accountId = (await C.rpc<number>('saveAccount', { name: 'Conta', type: 'checking' })).result;
      const st = { format: 'csv', warnings: [], transactions: [
        pix('PIX ENVIADO 01/03 10:00', 'NUCLEO CAMALEAO', -25000, 1),
        pix('PIX ENVIADO 02/03 11:00', 'JOAO DA SILVA', -5000, 2),
        pix('PIX ENVIADO 03/03 12:00', undefined, -7000, 3),
        pix('PIX ENVIADO 08/03 10:00', 'NUCLEO CAMALEAO', -25000, 8),
        pix('PIX ENVIADO NUCLEO CAMALEAO', undefined, -25000, 9),
        pix('PADARIA DOCE', undefined, -1500, 10),
      ] };
      const candidates = (await C.rpc<unknown[]>('prepareImport', accountId, st)).result;
      await C.rpc('commitImport', { accountId, fileName: 'pix.csv', format: 'csv', candidates });
      const txs = (await C.rpc<{ id: number; description: string; memo: string | null; date: string }[]>('listTransactions', {})).result;
      ids = Object.fromEntries(txs.map((t) => [t.date.slice(8), t.id]));
    });

    it('"PIX ENVIADO" sozinho não é tratado como mesma descrição', async () => {
      expect((await C.rpc('previewSimilar', ids['03'])).result).toEqual({ count: 0, generic: true });
      // Com o nome no complemento, só os PIX para o mesmo destinatário contam.
      expect((await C.rpc('previewSimilar', ids['01'])).result).toEqual({ count: 1, generic: false });
      const before = await cat();
      const r = (await C.rpc<{ changed: number; similar: number; logId: number }>('classifyTransaction', { txId: ids['01'], categoryKey: 'saude', applySimilar: true })).result;
      expect(r).toMatchObject({ changed: 2, similar: 1 });
      const after = await cat();
      expect(after[ids['01']]).toBe('saude|user');
      expect(after[ids['08']]).toBe('saude|user');
      for (const d of ['02', '03', '09', '10']) expect(after[ids[d]]).toBe(before[ids[d]]);
    });

    it('recusa regra genérica e mostra o alcance de uma regra específica', async () => {
      const g = await C.rpc('classifyTransaction', { txId: ids['09'], categoryKey: 'saude', applySimilar: false, rule: { pattern: 'PIX ENVIADO', direction: 'out' } });
      expect(g.status).toBe(400);
      expect(g.error).toMatch(/genérico/);
      expect((await C.rpc('saveRule', 'pix enviado', 'saude', 'out')).status).toBe(400);
      expect((await C.rpc('createRule', 'TED', 'saude', null)).status).toBe(400);
      expect((await C.rpc<{ generic: boolean }>('previewRule', 'Pix Enviado', 'out')).result.generic).toBe(true);
      const p = (await C.rpc<{ count: number; examples: string[] }>('previewRule', 'NUCLEO CAMALEAO', 'out')).result;
      expect(p.count).toBe(3); // a regra olha descrição + complemento: dias 01, 08 e 09
    });

    it('regra específica + histórico: desfazer volta tudo e apaga a regra', async () => {
      const before = await cat();
      const r = (await C.rpc<{ logId: number; byRule: number }>('classifyTransaction', {
        txId: ids['10'], categoryKey: 'alimentacao.padaria', applySimilar: false, rule: { pattern: 'NUCLEO CAMALEAO', direction: 'out' },
      })).result;
      expect(r.byRule).toBe(1); // 01 e 08 já foram categorizados à mão e não mudam
      expect((await cat())[ids['09']]).toBe('alimentacao.padaria|user');
      const log = (await C.rpc<{ id: number; action: string; rule_pattern: string; tx_count: number }[]>('listClassificationLog')).result;
      expect(log[0]).toMatchObject({ id: r.logId, action: 'rule', rule_pattern: 'NUCLEO CAMALEAO', tx_count: 2 });
      expect((await C.rpc<number>('undoClassification', r.logId)).result).toBe(2);
      expect(await cat()).toEqual(before);
      expect((await C.rpc<{ pattern: string }[]>('listRules')).result.map((x) => x.pattern)).not.toContain('NUCLEO CAMALEAO');
      // Desfazer de novo não faz nada.
      expect((await C.rpc<number>('undoClassification', r.logId)).result).toBe(0);
    });

    it('desfazer preserva o que foi alterado depois', async () => {
      const a = (await C.rpc<{ logId: number }>('classifyTransaction', { txId: ids['02'], categoryKey: 'lazer', applySimilar: false })).result;
      await C.rpc('classifyTransaction', { txId: ids['02'], categoryKey: 'educacao', applySimilar: false });
      expect((await C.rpc<number>('undoClassification', a.logId)).result).toBe(0);
      expect((await cat())[ids['02']]).toBe('educacao|user');
    });

    it('refazer a classificação automática corrige uma alteração em massa', async () => {
      // Simula o estrago antigo: todos os PIX marcados à mão como "saude".
      for (const d of ['01', '02', '03', '08', '09']) await C.rpc('classifyTransaction', { txId: ids[d], categoryKey: 'saude', applySimilar: false });
      const all = [ids['01'], ids['02'], ids['03'], ids['08'], ids['09']];
      const r = (await C.rpc<{ logId: number; changed: number }>('resetClassification', all)).result;
      expect(r.changed).toBe(5);
      const after = await cat();
      for (const id of all) expect(after[id].endsWith('|user')).toBe(false);
      expect(after[ids['02']].startsWith('saude|')).toBe(false);
      expect((await C.rpc<number>('undoClassification', r.logId)).result).toBe(5);
      for (const id of all) expect((await cat())[id]).toBe('saude|user');
    });
  });

  describe('limite de tentativas', () => {
    it('limita tentativas de login por e-mail', async () => {
      const app = createApp({ db, secureCookies: false, limits: { loginPerIp: 100, loginPerEmail: 3, registerPerIp: 100, windowMs: 60_000 } });
      const s = app.listen(0);
      const url = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
      const attempt = () => fetch(`${url}/api/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch' },
        body: JSON.stringify({ email: 'maria@exemplo.com', password: 'chute-errado' }),
      }).then((r) => r.status);
      expect([await attempt(), await attempt(), await attempt()]).toEqual([401, 401, 401]);
      expect(await attempt()).toBe(429);
      s.close();
    });
  });
});
