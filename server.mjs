import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError, checkedText, redact, mockAnalyze, newTicket, decide, event, LANGUAGES } from './core.js';
import { liveAnalyze, deliver } from './providers.mjs';
import { TicketStore } from './store.mjs';

export const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = new Set(['index.html', 'app.js', 'styles.css', 'core.js', 'portfolio.html', 'hr-assistant.html', 'crm-lead-assistant.html']);
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
function equal(a, b) {
  const left = Buffer.from(a || ''), right = Buffer.from(b || '');
  return left.length === right.length && timingSafeEqual(left, right);
}
function configFromEnv() {
  return { mode: process.env.LLM_MODE || 'mock', llmKey: process.env.LLM_API_KEY || '', llmModel: process.env.LLM_MODEL || '',
    crmUrl: process.env.CRM_WEBHOOK_URL || '', crmToken: process.env.CRM_WEBHOOK_TOKEN || '', apiToken: process.env.API_TOKEN || '',
    dataDir: path.resolve(ROOT, process.env.DATA_DIR || '.data'), timeoutMs: 20000 };
}
async function readJson(req) {
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw new AppError(415, 'Требуется application/json.');
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 32000) throw new AppError(413, 'Слишком большой запрос.');
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw new AppError(400, 'Некорректный JSON.'); }
}
export function createApp(options = {}) {
  const config = { ...configFromEnv(), ...options.config };
  if (!['mock', 'live'].includes(config.mode)) throw new Error('LLM_MODE must be mock or live');
  if (config.crmUrl) {
    const url = new URL(config.crmUrl);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('CRM_WEBHOOK_URL must use HTTPS without inline credentials');
  }
  const store = new TicketStore(config.dataDir);
  const session = randomBytes(32).toString('hex');
  const fetcher = options.fetcher || fetch;
  const pending = new Set();
  let windowStart = Date.now(), analyses = 0, inFlight = 0;
  function json(res, code, value) {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(value));
  }
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    try {
      const port = server.address().port;
      if (![ `localhost:${port}`, `127.0.0.1:${port}` ].includes(req.headers.host)) throw new AppError(403, 'Недопустимый адрес сервера.');
      const origin = `http://${req.headers.host}`;
      if ((req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site') throw new AppError(403, 'Разрешены только запросы с этой страницы.');
      const url = new URL(req.url, origin);
      if (url.pathname === '/api/health' && req.method === 'GET') {
        res.setHeader('Set-Cookie', `linguadesk=${session}; HttpOnly; SameSite=Strict; Path=/`);
        return json(res, 200, { ok: true, mode: config.mode, liveConfigured: Boolean(config.llmKey && config.llmModel), crmConfigured: Boolean(config.crmUrl), storage: 'metadata-only', version: '0.2.0' });
      }
      if (!url.pathname.startsWith('/api/')) {
        if (!['GET', 'HEAD'].includes(req.method)) throw new AppError(405, 'Метод не поддерживается.');
        const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        if (!PUBLIC.has(file)) throw new AppError(404, 'Страница не найдена.');
        const legacy = ['portfolio.html', 'hr-assistant.html', 'crm-lead-assistant.html'].includes(file);
        res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'${legacy ? " 'unsafe-inline'" : ''}; style-src 'self'${legacy ? " 'unsafe-inline'" : ''}; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`);
        const content = await readFile(path.join(ROOT, file));
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] });
        return res.end(req.method === 'HEAD' ? undefined : content);
      }
      const cookie = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('linguadesk='))?.slice(11);
      const token = req.headers.authorization?.replace(/^Bearer /, '');
      if (!equal(cookie, session) && !(config.apiToken && equal(token, config.apiToken))) throw new AppError(401, 'Откройте интерфейс для начала сессии.');
      if (url.pathname === '/api/logs' && req.method === 'GET') return json(res, 200, { records: store.list() });
      if (url.pathname.startsWith('/api/tickets/') && req.method === 'GET') return json(res, 200, store.get(url.pathname.slice('/api/tickets/'.length)));
      if (req.method !== 'POST') throw new AppError(405, 'Метод не поддерживается.');
      const body = await readJson(req);
      if (url.pathname === '/api/analyze') {
        if (body.synthetic !== true) throw new AppError(400, 'MVP предназначен для синтетических примеров.');
        const text = redact(checkedText(body.text));
        const hint = body.languageHint || '';
        if (typeof hint !== 'string' || (hint && (!Object.hasOwn(LANGUAGES, hint) || hint === 'und'))) throw new AppError(400, 'Некорректный язык.');
        if (body.mode && body.mode !== config.mode) throw new AppError(409, 'Режим задаётся на сервере, перезагрузите страницу.');
        if (store.active.size >= 200) throw new AppError(429, 'Достигнут лимит 200 обращений за запуск. Перезапустите demo-сервер.');
        if (Date.now() - windowStart > 60000) { windowStart = Date.now(); analyses = 0; }
        if (analyses >= 30 || inFlight >= 3) throw new AppError(429, 'Слишком много запросов. Повторите позже.');
        analyses++; inFlight++;
        try {
          const analysis = config.mode === 'live' ? await liveAnalyze(text, hint, config, fetcher) : mockAnalyze(text, hint);
          return json(res, 201, store.commit(newTicket(analysis, config.mode)));
        } finally { inFlight--; }
      }
      if (url.pathname === '/api/approve') {
        const ticket = store.get(body.id);
        if (pending.has(ticket.id)) throw new AppError(409, 'Доставка уже выполняется.');
        const next = decide(ticket, body, Boolean(config.crmUrl));
        if (next === ticket) return json(res, 200, ticket);
        store.commit(next);
        if (next.status !== 'delivering') return json(res, 200, next);
        pending.add(next.id);
        try {
          const ok = await deliver(next, config, fetcher);
          return json(res, 200, store.commit(event({ ...next, status: ok ? 'delivered' : 'delivery_failed' }, ok ? 'crm_accepted' : 'delivery_unconfirmed')));
        } finally { pending.delete(next.id); }
      }
      throw new AppError(404, 'Маршрут не найден.');
    } catch (error) {
      if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : 'Внутренняя ошибка. Действие не подтверждено.' });
      else res.end();
    }
  });
  server.requestTimeout = 30000;
  return { server, store };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (existsSync(path.join(ROOT, '.env'))) process.loadEnvFile(path.join(ROOT, '.env'));
  const { server } = createApp();
  const port = Number(process.env.PORT || 3000);
  server.listen(port, '127.0.0.1', () => console.log(`LinguaDesk: http://localhost:${port} — ${process.env.LLM_MODE || 'mock'}`));
}
