import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Db } from './db';

const scrypt = (pw: string, salt: Buffer, keylen: number, opts: ScryptOptions) =>
  new Promise<Buffer>((ok, fail) => scryptCb(pw, salt, keylen, opts, (err, key) => (err ? fail(err) : ok(key))));

// ---------------- Senhas ----------------

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keylen: 64 };

/** Formato: scrypt$N$r$p$salt(base64)$hash(base64). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 128 * 1024 * 1024 });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, saltB64, hashB64] = stored.split('$');
  if (alg !== 'scrypt' || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const key = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: 128 * 1024 * 1024,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

// Hash de uma senha qualquer: usado quando o e-mail não existe, para que o tempo
// de resposta não revele quais e-mails estão cadastrados.
let dummyHash: Promise<string> | null = null;
export const getDummyHash = () => (dummyHash ??= hashPassword(randomBytes(16).toString('hex')));

const COMMON_PASSWORDS = new Set([
  '12345678', '123456789', '1234567890', 'password', 'password1', 'senha123', 'senha1234', 'qwerty123', '11111111',
  '00000000', '87654321', 'abc12345', 'abcd1234', 'iloveyou', 'brasil123', 'mudar123', 'admin123', 'teste123',
]);

/** Retorna a mensagem de erro, ou `null` se a senha for aceitável. */
export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
  if (password.length > 200) return 'A senha pode ter no máximo 200 caracteres.';
  if (COMMON_PASSWORDS.has(password.toLowerCase())) return 'Essa senha é muito comum. Escolha outra.';
  if (/^(.)\1+$/.test(password)) return 'A senha não pode ser um caractere repetido.';
  if (email && password.toLowerCase() === email.toLowerCase()) return 'A senha não pode ser igual ao e-mail.';
  return null;
}

// ---------------- Sessões ----------------

export const SESSION_COOKIE = 'fin_session';
const SESSION_DAYS = 30;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Cria a sessão e devolve o token (só o hash fica no banco). */
export async function createSession(db: Db, userId: number, userAgent?: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.query(
    `INSERT INTO sessions (token_hash, user_id, expires_at, user_agent) VALUES ($1, $2, now() + $3::interval, $4)`,
    [hashToken(token), userId, `${SESSION_DAYS} days`, (userAgent ?? '').slice(0, 300)],
  );
  // Limpeza oportunista de sessões vencidas.
  await db.query('DELETE FROM sessions WHERE expires_at < now()');
  return token;
}

export async function sessionUser(db: Db, token: string | undefined): Promise<{ id: number; email: string; name: string } | null> {
  if (!token || token.length > 100) return null;
  const r = await db.query<{ id: number; email: string; name: string }>(
    `SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  );
  return r.rows[0] ?? null;
}

export async function destroySession(db: Db, token: string | undefined): Promise<void> {
  if (token) await db.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
}

export async function destroyOtherSessions(db: Db, userId: number, keepToken?: string): Promise<void> {
  await db.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [userId, keepToken ? hashToken(keepToken) : '']);
}

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

export function setSessionCookie(res: Response, token: string, secure: boolean): void {
  res.setHeader('Set-Cookie', [
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`,
  ]);
}

export function clearSessionCookie(res: Response, secure: boolean): void {
  res.setHeader('Set-Cookie', [`${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`]);
}

// ---------------- Limite de tentativas ----------------

/** Janela deslizante simples em memória (suficiente para uma instância). */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private readonly max: number, private readonly windowMs: number) {}

  /** Registra uma tentativa; retorna `false` se o limite foi excedido. */
  take(key: string, now = Date.now()): boolean {
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length >= this.max) {
      this.hits.set(key, list);
      return false;
    }
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > 50_000) this.prune(now);
    return true;
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  private prune(now: number) {
    for (const [k, v] of this.hits) if (v.every((t) => now - t >= this.windowMs)) this.hits.delete(k);
  }
}

// ---------------- CSRF ----------------

/**
 * Requisições que alteram dados precisam do cabeçalho `X-Requested-With`
 * (um site de terceiros não consegue enviá-lo sem CORS, que não habilitamos)
 * e, se o navegador mandar `Origin`, ele precisa ser o próprio site.
 */
export function csrfGuard(allowedOrigins: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    if (req.get('x-requested-with') !== 'fetch') return res.status(403).json({ error: 'Requisição bloqueada.' });
    const origin = req.get('origin');
    if (origin) {
      const self = `${req.protocol}://${req.get('host')}`;
      if (origin !== self && !allowedOrigins.includes(origin)) return res.status(403).json({ error: 'Origem não permitida.' });
    }
    return next();
  };
}
