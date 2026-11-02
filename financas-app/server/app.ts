import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { buildReaderHtml } from '../src/core/pdfReaderHtml';
import {
  clearSessionCookie, createSession, csrfGuard, destroyOtherSessions, destroySession, getDummyHash, hashPassword,
  passwordProblem, RateLimiter, readCookie, sessionUser, SESSION_COOKIE, setSessionCookie, verifyPassword,
} from './auth';
import { seedCategories, withUser, type Db } from './db';
import * as repo from './repo';

export interface AppOptions {
  db: Db;
  /** Cookies com `Secure` (HTTPS). Ligado em produção. */
  secureCookies: boolean;
  /** Pasta com o build web (`expo export --platform web`). */
  staticDir?: string;
  /** Número de proxies na frente (Render, Fly, Nginx...) para ler o IP real. */
  trustProxy?: number;
  /** Origens extras aceitas em requisições que alteram dados. */
  allowedOrigins?: string[];
  limits?: { loginPerIp: number; loginPerEmail: number; registerPerIp: number; windowMs: number };
}

type AuthedRequest = Request & { user?: { id: number; email: string; name: string } };

// ---------------- Validação ----------------

const id = z.number().int().positive().max(2_147_483_647);
const cents = z.number().int().min(-1e13).max(1e13);
const text = (max: number) => z.string().max(max);
const month = z.string().regex(/^\d{4}-\d{2}$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const accountType = z.enum(['checking', 'savings', 'credit_card', 'cash', 'investment']);
const kind = z.enum(['expense', 'income', 'transfer']);
const direction = z.enum(['in', 'out']).nullable();
const catKey = text(200).min(1);
const color = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
const icon = text(60).regex(/^[a-z0-9-]+$/);

const parsedTx = z.object({
  date: isoDate,
  description: text(500),
  amountCents: cents,
  externalId: text(300).optional(),
  memo: text(1000).optional(),
});
const statement = z.object({
  format: z.enum(['ofx', 'csv', 'qif', 'xlsx', 'ods', 'pdf', 'image']),
  transactions: z.array(parsedTx).max(20_000),
  account: z.object({
    bankId: text(50).optional(), branchId: text(50).optional(), accountId: text(100).optional(),
    type: z.enum(['checking', 'savings', 'credit_card']).optional(), currency: text(10).optional(),
  }).optional(),
  balanceCents: cents.optional(),
  warnings: z.array(text(1000)).max(200),
});
const candidate = parsedTx.extend({
  dedupeKey: text(1000),
  categoryKey: catKey,
  categorySource: z.enum(['user', 'rule', 'history', 'none']),
  duplicate: z.boolean(),
  selected: z.boolean(),
});

/**
 * Funções expostas pela API. Os argumentos são validados antes de chegar ao
 * banco, e o `userId` vem sempre da sessão — nunca do cliente.
 */
const RPC = {
  listAccounts: { args: z.tuple([]), run: repo.listAccounts },
  saveAccount: {
    args: z.tuple([z.object({
      id: id.optional(), name: text(120).min(1), type: accountType, bank: text(120).nullable().optional(),
      initial_balance_cents: cents.optional(), color: color.optional(), external_key: text(300).nullable().optional(),
    })]),
    run: repo.saveAccount,
  },
  deleteAccount: { args: z.tuple([id]), run: repo.deleteAccount },
  findAccountByExternalKey: { args: z.tuple([text(300).nullable()]), run: repo.findAccountByExternalKey },
  listCategories: { args: z.tuple([]), run: repo.listCategories },
  saveCategory: {
    args: z.tuple([z.object({ key: catKey.optional(), name: text(120).min(1), kind, parent: catKey.nullable(), icon, color })]),
    run: repo.saveCategory,
  },
  deleteCategory: { args: z.tuple([catKey]), run: repo.deleteCategory },
  listRules: { args: z.tuple([]), run: repo.listRules },
  saveRule: { args: z.tuple([text(200).min(1), catKey, direction]), run: repo.saveRule },
  deleteRule: { args: z.tuple([id]), run: repo.deleteRule },
  reclassifyAll: { args: z.tuple([]), run: repo.reclassifyAll },
  listTransactions: {
    args: z.tuple([z.object({
      month: month.optional(), accountId: id.optional(), categoryKey: catKey.optional(),
      search: text(200).optional(), uncategorizedOnly: z.boolean().optional(),
    }).optional()]),
    run: repo.listTransactions,
  },
  getTransaction: { args: z.tuple([id]), run: repo.getTransaction },
  updateTransaction: {
    args: z.tuple([id, z.object({
      category_key: catKey.nullable().optional(), notes: text(2000).nullable().optional(), description: text(500).min(1).optional(),
      amount_cents: cents.optional(), date: isoDate.optional(),
    })]),
    run: repo.updateTransaction,
  },
  applyCategoryToSimilar: { args: z.tuple([id, catKey]), run: repo.applyCategoryToSimilar },
  addManualTransaction: {
    args: z.tuple([z.object({
      accountId: id, date: isoDate, description: text(500).min(1), amountCents: cents, categoryKey: catKey.nullable(), notes: text(2000).optional(),
    })]),
    run: repo.addManualTransaction,
  },
  deleteTransaction: { args: z.tuple([id]), run: repo.deleteTransaction },
  prepareImport: { args: z.tuple([id, statement]), run: repo.prepareImport },
  commitImport: {
    args: z.tuple([z.object({ accountId: id, fileName: text(300), format: text(20), candidates: z.array(candidate).max(20_000) })]),
    run: repo.commitImport,
  },
  listImports: { args: z.tuple([]), run: repo.listImports },
  undoImport: { args: z.tuple([id]), run: repo.undoImport },
  listBudgets: { args: z.tuple([]), run: repo.listBudgets },
  setBudget: { args: z.tuple([catKey, cents.nullable()]), run: repo.setBudget },
  reportTransactions: { args: z.tuple([month, month]), run: repo.reportTransactions },
  latestMonth: { args: z.tuple([]), run: repo.latestMonth },
  exportCsv: { args: z.tuple([]), run: repo.exportCsv },
} as const;

export type RpcName = keyof typeof RPC;
export const RPC_NAMES = Object.keys(RPC) as RpcName[];

const credentials = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  password: z.string().min(1).max(200),
});

// ---------------- Cabeçalhos de segurança ----------------

const CDN = 'https://cdnjs.cloudflare.com https://cdn.jsdelivr.net';

function securityHeaders(secure: boolean) {
  return (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '));
    next();
  };
}

/** CSP da página isolada do leitor de PDF/OCR (iframe em sandbox, sem acesso ao app). */
const READER_CSP = [
  "default-src 'none'",
  `script-src 'unsafe-inline' 'wasm-unsafe-eval' blob: ${CDN}`,
  `worker-src blob: ${CDN}`,
  `connect-src blob: data: ${CDN}`,
  'img-src data: blob:',
  "style-src 'unsafe-inline'",
  "frame-ancestors 'self'",
].join('; ');

// ---------------- App ----------------

export function createApp(opts: AppOptions) {
  const { db } = opts;
  const limits = opts.limits ?? { loginPerIp: 30, loginPerEmail: 8, registerPerIp: 10, windowMs: 15 * 60_000 };
  const loginIp = new RateLimiter(limits.loginPerIp, limits.windowMs);
  const loginEmail = new RateLimiter(limits.loginPerEmail, limits.windowMs);
  const registerIp = new RateLimiter(limits.registerPerIp, limits.windowMs * 4);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', opts.trustProxy ?? 0);
  app.use(securityHeaders(opts.secureCookies));

  const api = express.Router();
  api.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  api.use(express.json({ limit: '15mb' }));
  api.use(csrfGuard(opts.allowedOrigins ?? []));

  const loadUser = async (req: AuthedRequest, _res: Response, next: NextFunction) => {
    try {
      req.user = (await sessionUser(db, readCookie(req, SESSION_COOKIE))) ?? undefined;
      next();
    } catch (e) { next(e); }
  };
  const requireUser = (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Faça login para continuar.' });
    next();
  };
  api.use(loadUser);

  // ----- Cadastro -----
  api.post('/auth/register', async (req: AuthedRequest, res, next) => {
    try {
      if (!registerIp.take(req.ip ?? '')) return res.status(429).json({ error: 'Muitos cadastros a partir deste endereço. Tente mais tarde.' });
      const body = credentials.extend({ name: z.string().trim().max(120).optional() }).safeParse(req.body);
      if (!body.success) return res.status(400).json({ error: 'Informe um e-mail válido e uma senha.' });
      const { email, password, name } = body.data;
      const problem = passwordProblem(password, email);
      if (problem) return res.status(400).json({ error: problem });
      const hash = await hashPassword(password);
      const ins = await db.query<{ id: number }>(
        'INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING id',
        [email, name ?? '', hash],
      );
      if (!ins.rowCount) return res.status(409).json({ error: 'Este e-mail já está cadastrado. Faça login.' });
      const uid = ins.rows[0].id;
      try {
        await withUser(db, uid, (tx) => seedCategories(tx, uid));
      } catch (e) {
        await db.query('DELETE FROM users WHERE id = $1', [uid]);
        throw e;
      }
      setSessionCookie(res, await createSession(db, uid, req.get('user-agent')), opts.secureCookies);
      res.status(201).json({ user: { id: uid, email, name: name ?? '' } });
    } catch (e) { next(e); }
  });

  // ----- Login -----
  api.post('/auth/login', async (req: AuthedRequest, res, next) => {
    try {
      const body = credentials.safeParse(req.body);
      if (!body.success) return res.status(400).json({ error: 'Informe e-mail e senha.' });
      const { email, password } = body.data;
      if (!loginIp.take(req.ip ?? '') || !loginEmail.take(email)) {
        return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' });
      }
      const u = (await db.query<{ id: number; email: string; name: string; password_hash: string; locked: boolean }>(
        `SELECT id, email, name, password_hash, (locked_until IS NOT NULL AND locked_until > now()) AS locked
         FROM users WHERE lower(email) = $1`,
        [email],
      )).rows[0];
      const ok = await verifyPassword(password, u?.password_hash ?? (await getDummyHash()));
      if (u?.locked) return res.status(429).json({ error: 'Conta bloqueada temporariamente por excesso de tentativas. Tente em 15 minutos.' });
      if (!u || !ok) {
        if (u) {
          await db.query(
            `UPDATE users SET failed_logins = failed_logins + 1,
               locked_until = CASE WHEN failed_logins + 1 >= 10 THEN now() + interval '15 minutes' ELSE locked_until END
             WHERE id = $1`,
            [u.id],
          );
        }
        return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
      }
      await db.query('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1', [u.id]);
      loginEmail.reset(email);
      setSessionCookie(res, await createSession(db, u.id, req.get('user-agent')), opts.secureCookies);
      res.json({ user: { id: u.id, email: u.email, name: u.name } });
    } catch (e) { next(e); }
  });

  api.post('/auth/logout', async (req, res, next) => {
    try {
      await destroySession(db, readCookie(req, SESSION_COOKIE));
      clearSessionCookie(res, opts.secureCookies);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  api.get('/auth/me', (req: AuthedRequest, res) => {
    if (!req.user) return res.status(401).json({ error: 'Não autenticado.' });
    res.json({ user: req.user });
  });

  api.post('/auth/password', requireUser, async (req: AuthedRequest, res, next) => {
    try {
      const body = z.object({ current: z.string().max(200), next: z.string().max(200) }).safeParse(req.body);
      if (!body.success) return res.status(400).json({ error: 'Dados inválidos.' });
      const u = (await db.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [req.user!.id])).rows[0];
      if (!u || !(await verifyPassword(body.data.current, u.password_hash))) return res.status(401).json({ error: 'Senha atual incorreta.' });
      const problem = passwordProblem(body.data.next, req.user!.email);
      if (problem) return res.status(400).json({ error: problem });
      await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await hashPassword(body.data.next), req.user!.id]);
      // Encerra as outras sessões (outros aparelhos) ao trocar a senha.
      await destroyOtherSessions(db, req.user!.id, readCookie(req, SESSION_COOKIE));
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  api.post('/auth/delete-account', requireUser, async (req: AuthedRequest, res, next) => {
    try {
      const body = z.object({ password: z.string().max(200) }).safeParse(req.body);
      const u = (await db.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [req.user!.id])).rows[0];
      if (!body.success || !u || !(await verifyPassword(body.data.password, u.password_hash))) return res.status(401).json({ error: 'Senha incorreta.' });
      await db.query('DELETE FROM users WHERE id = $1', [req.user!.id]); // apaga tudo em cascata
      clearSessionCookie(res, opts.secureCookies);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  // ----- Dados -----
  api.post('/rpc/:fn', requireUser, async (req: AuthedRequest, res, next) => {
    try {
      const name = String(req.params.fn);
      if (!Object.prototype.hasOwnProperty.call(RPC, name)) return res.status(404).json({ error: 'Função desconhecida.' });
      const def = RPC[name as RpcName];
      const parsed = def.args.safeParse(req.body?.args ?? []);
      if (!parsed.success) return res.status(400).json({ error: 'Parâmetros inválidos.', details: parsed.error.issues.slice(0, 5) });
      const uid = req.user!.id;
      const result = await withUser(db, uid, (tx) =>
        (def.run as (tx: unknown, uid: number, ...a: unknown[]) => Promise<unknown>)(tx, uid, ...(parsed.data as unknown[])),
      );
      res.json({ result: result ?? null });
    } catch (e) {
      if (e instanceof repo.NotFoundError) return res.status(404).json({ error: e.message });
      next(e);
    }
  });

  api.use((_req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
  api.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = (err as { status?: number; type?: string })?.status;
    if (status === 413) return res.status(413).json({ error: 'Arquivo grande demais.' });
    if (status === 400) return res.status(400).json({ error: 'Requisição inválida.' });
    console.error('[api]', err);
    res.status(500).json({ error: 'Erro interno. Tente novamente.' });
  });

  app.use('/api', api);

  app.get('/healthz', async (_req, res) => {
    try { await db.query('SELECT 1'); res.json({ ok: true }); } catch { res.status(503).json({ ok: false }); }
  });

  // Página do leitor de PDF/OCR para o iframe isolado da versão web.
  const readerHtml = buildReaderHtml(undefined, { bridge: 'parent' });
  app.get('/reader.html', (_req, res) => {
    res.setHeader('Content-Security-Policy', READER_CSP);
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(readerHtml);
  });

  // ----- Front-end web -----
  if (opts.staticDir && fs.existsSync(opts.staticDir)) {
    const dir = opts.staticDir;
    app.use(express.static(dir, {
      index: false,
      setHeaders: (res, file) => {
        res.setHeader('Cache-Control', file.includes(`${path.sep}_expo${path.sep}`) || file.includes(`${path.sep}assets${path.sep}`)
          ? 'public, max-age=31536000, immutable'
          : 'no-cache');
      },
    }));
    const index = path.join(dir, 'index.html');
    app.get(/.*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(index);
    });
  }

  return app;
}
