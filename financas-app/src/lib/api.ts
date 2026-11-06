/**
 * Cliente HTTP da versão web. A sessão fica num cookie HttpOnly (o JavaScript
 * da página não tem acesso ao token). O cabeçalho `X-Requested-With` é exigido
 * pelo servidor como proteção contra CSRF.
 */

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export interface SessionUser {
  id: number;
  email: string;
  name: string;
}

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();

/** Avisado quando a sessão expira, para voltar à tela de login. */
export function onUnauthorized(fn: Listener): () => void {
  unauthorizedListeners.add(fn);
  return () => unauthorizedListeners.delete(fn);
}

export async function apiRequest<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Sem conexão com o servidor. Verifique a internet.');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) unauthorizedListeners.forEach((fn) => fn());
    throw new ApiError(res.status, json?.error ?? `Erro ${res.status}`);
  }
  return json as T;
}

export async function rpc<T>(fn: string, ...args: unknown[]): Promise<T> {
  // `undefined` vira `null` no JSON; removemos argumentos finais indefinidos.
  while (args.length && args[args.length - 1] === undefined) args.pop();
  const r = await apiRequest<{ result: T }>('POST', `/rpc/${fn}`, { args });
  return r.result;
}

export const auth = {
  me: () => apiRequest<{ user: SessionUser }>('GET', '/auth/me').then((r) => r.user),
  login: (email: string, password: string) => apiRequest<{ user: SessionUser }>('POST', '/auth/login', { email, password }).then((r) => r.user),
  register: (email: string, password: string, name: string) =>
    apiRequest<{ user: SessionUser }>('POST', '/auth/register', { email, password, name }).then((r) => r.user),
  logout: () => apiRequest('POST', '/auth/logout'),
  changePassword: (current: string, next: string) => apiRequest('POST', '/auth/password', { current, next }),
  deleteAccount: (password: string) => apiRequest('POST', '/auth/delete-account', { password }),
};
