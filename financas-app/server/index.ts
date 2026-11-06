import path from 'node:path';
import { createApp } from './app';
import { createPool, migrate } from './db';

/**
 * Servidor da versão web: API autenticada + arquivos do front-end.
 *
 * Variáveis de ambiente:
 *   DATABASE_URL   conexão Postgres (obrigatória)
 *   PORT           porta HTTP (padrão 3000)
 *   NODE_ENV       "production" liga cookies Secure e HSTS
 *   TRUST_PROXY    nº de proxies na frente (padrão 1 em produção)
 *   WEB_DIR        pasta do build web (padrão ./dist-web)
 *   ALLOWED_ORIGINS origens extras aceitas, separadas por vírgula
 */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Defina DATABASE_URL (Postgres).');
    process.exit(1);
  }
  const production = process.env.NODE_ENV === 'production';
  const db = createPool(url);
  const rls = await migrate(db);
  if (!rls.restrictedRole && rls.connectionBypassesRls) {
    console.warn('[segurança] O usuário do banco ignora Row-Level Security e não foi possível criar o papel restrito. ' +
      'O isolamento continua garantido pelos filtros por usuário em todas as consultas, mas use um usuário sem SUPERUSER/BYPASSRLS.');
  } else {
    console.log(`[segurança] Row-Level Security ativo (${rls.restrictedRole ? 'papel restrito' : 'usuário da conexão'}).`);
  }

  const app = createApp({
    db,
    secureCookies: production,
    trustProxy: Number(process.env.TRUST_PROXY ?? (production ? 1 : 0)),
    staticDir: path.resolve(process.env.WEB_DIR ?? 'dist-web'),
    allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  });
  const port = Number(process.env.PORT ?? 3000);
  const server = app.listen(port, () => console.log(`Minhas Finanças web ouvindo na porta ${port}`));
  const stop = () => server.close(() => db.end().then(() => process.exit(0)));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
