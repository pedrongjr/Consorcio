'use strict';
/*
 * Servidor do Simulador de Consórcio — sem dependências externas.
 *   - Serve o front-end estático em /public
 *   - API pública:  GET  /api/public
 *   - API admin:    POST /api/admin/login, GET /api/admin/data,
 *                   PUT  /api/admin/config, PUT/DELETE /api/admin/grupos/:id
 * Os dados ficam em data/db.json (criado a partir de data/seed.json).
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DB_FILE = process.env.DB_FILE || path.join(ROOT, 'data', 'db.json');
const SEED_FILE = path.join(ROOT, 'data', 'seed.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

const TIPOS = ['imovel', 'veiculo', 'moto', 'pesados', 'servicos'];
const INDICES = ['IPCA', 'INCC', 'FIPE', 'IGP-M'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};

// ---------- Persistência ----------
function loadDb() {
  if (!fs.existsSync(DB_FILE)) {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    fs.copyFileSync(SEED_FILE, DB_FILE);
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}
let db = loadDb();
function saveDb() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

// ---------- Validação ----------
function n(v, { min = 0, max = Infinity, def = 0, allowNull = false } = {}) {
  if ((v === null || v === '' || v === undefined) && allowNull) return null;
  const x = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : Number(v);
  if (!Number.isFinite(x)) return def;
  return Math.min(max, Math.max(min, x));
}
function str(v, max = 120) { return String(v == null ? '' : v).trim().slice(0, max); }

function sanitizeGrupo(g, id) {
  const historico = Array.isArray(g.historicoLances)
    ? g.historicoLances.slice(0, 6).map((x) => n(x, { max: 100, allowNull: true }))
    : [];
  while (historico.length < 6) historico.push(null);
  const creditoMin = n(g.creditoMin, { def: 10000 });
  return {
    id,
    nome: str(g.nome) || id,
    tipo: TIPOS.includes(g.tipo) ? g.tipo : 'imovel',
    creditoMin,
    creditoMax: Math.max(creditoMin, n(g.creditoMax, { def: creditoMin })),
    prazo: Math.round(n(g.prazo, { min: 2, max: 420, def: 60 })),
    taxaAdm: n(g.taxaAdm, { max: 100 }),
    fundoReserva: n(g.fundoReserva, { max: 100 }),
    seguroMensal: n(g.seguroMensal, { max: 5 }),
    indice: INDICES.includes(g.indice) ? g.indice : 'IPCA',
    reajustePct: n(g.reajustePct, { min: -50, max: 100, allowNull: true }),
    parcelaReduzidaPct: n(g.parcelaReduzidaPct, { max: 100 }),
    lanceEmbutidoMax: n(g.lanceEmbutidoMax, { max: 100 }),
    mediaLance6m: n(g.mediaLance6m, { max: 100, allowNull: true }),
    historicoLances: historico,
    ativo: g.ativo !== false
  };
}

function sanitizeConfig(c) {
  const indices = {};
  for (const k of INDICES) indices[k] = n(c.indices && c.indices[k], { min: -50, max: 100, def: db.config.indices[k] || 0 });
  const juros = {};
  for (const k of TIPOS) juros[k] = n(c.jurosFinanciamento && c.jurosFinanciamento[k], { max: 20, def: db.config.jurosFinanciamento[k] || 1 });
  return {
    nomeConsultor: str(c.nomeConsultor, 80) || db.config.nomeConsultor,
    whatsapp: str(c.whatsapp, 20).replace(/\D/g, ''),
    indices,
    jurosFinanciamento: juros
  };
}

// ---------- Autenticação ----------
function sign(payload) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
function issueToken() {
  const payload = String(Date.now() + TOKEN_TTL_MS);
  return payload + '.' + sign(payload);
}
function validToken(token) {
  if (!token) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  return Number(payload) > Date.now();
}
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// ---------- HTTP helpers ----------
function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': typeof body === 'object' && !Buffer.isBuffer(body) ? MIME['.json'] : 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(data);
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 1e6) { reject(new Error('payload muito grande')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new Error('JSON inválido')); }
    });
    req.on('error', reject);
  });
}

function publicData() {
  return { config: db.config, grupos: db.grupos.filter((g) => g.ativo) };
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  if (rel === '/admin') rel = '/admin.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Proibido');
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'Não encontrado');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache'
    });
    res.end(buf);
  });
}

// ---------- Rotas ----------
async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (p === '/api/public' && req.method === 'GET') return send(res, 200, publicData());

  if (p === '/api/admin/login' && req.method === 'POST') {
    const body = await readJson(req);
    if (!safeEqual(body.password || '', ADMIN_PASSWORD)) return send(res, 401, { error: 'Senha inválida' });
    return send(res, 200, { token: issueToken() });
  }

  if (p.startsWith('/api/admin/')) {
    const auth = req.headers.authorization || '';
    if (!validToken(auth.replace(/^Bearer\s+/i, ''))) return send(res, 401, { error: 'Sessão expirada. Faça login novamente.' });

    if (p === '/api/admin/data' && req.method === 'GET') return send(res, 200, db);

    if (p === '/api/admin/config' && req.method === 'PUT') {
      db.config = sanitizeConfig(await readJson(req));
      saveDb();
      return send(res, 200, db.config);
    }

    const m = p.match(/^\/api\/admin\/grupos\/([a-z0-9-]{1,60})$/);
    if (m) {
      const id = m[1];
      const idx = db.grupos.findIndex((g) => g.id === id);
      if (req.method === 'PUT') {
        const grupo = sanitizeGrupo(await readJson(req), id);
        if (idx >= 0) db.grupos[idx] = grupo; else db.grupos.push(grupo);
        saveDb();
        return send(res, 200, grupo);
      }
      if (req.method === 'DELETE') {
        if (idx < 0) return send(res, 404, { error: 'Grupo não encontrado' });
        db.grupos.splice(idx, 1);
        saveDb();
        return send(res, 200, { ok: true });
      }
    }
    return send(res, 404, { error: 'Rota não encontrada' });
  }

  if (p.startsWith('/api/')) return send(res, 404, { error: 'Rota não encontrada' });
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Método não permitido');
  return serveStatic(req, res, p);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => send(res, 400, { error: err.message || 'Erro' }));
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Simulador de Consórcio rodando em http://localhost:${PORT}`);
    console.log(`Painel do administrador: http://localhost:${PORT}/admin`);
    if (!process.env.ADMIN_PASSWORD) console.warn('ATENÇÃO: defina ADMIN_PASSWORD (senha padrão "admin123" em uso).');
  });
}

module.exports = { server, sanitizeGrupo };
