// License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Flavio Pendolino
// https://polyformproject.org/licenses/noncommercial/1.0.0
// 
// Author: Flavio Pendolino
// Version: 0.1.0
// License: PolyForm Noncommercial 1.0.0
// Commercial use: penfla@me.com
// Purpose: Cosformula - archivio locale di formulazioni cosmetiche
// Method: Node.js + SQLite; verifica INCI su dataset CosIng locale
// Disclaimer: validate the results against your own reference samples before any analytical, engineering, safety or regulatory use.
// AI disclosure: questo strumento esegue calcoli deterministici; non genera contenuto tramite IA generativa (art. 50 AI Act non applicabile).

import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { listProjects, createProject, renameProject, deleteProject, getDb } from './projects.js';
import { SLUG_RE, httpError, str } from './security.js';
import { router as formulas } from './routes/formulas.js';
import { router as files } from './routes/files.js';
import { router as inci } from './routes/inci.js';
import { router as backup } from './routes/backup.js';
import { router as setup } from './routes/setup.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

export function createApp({ port = 3000, host = '127.0.0.1' } = {}) {
  const app = express();
  app.disable('x-powered-by');
  const allowedHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`, ...(process.env.COSFORMULA_ALLOWED_HOSTS || '').split(',').filter(Boolean)]);

  // Anti DNS-rebinding + CSRF: Host in allowlist; per metodi non sicuri Origin deve coincidere con Host.
  app.use((req, _res, next) => {
    if (!allowedHosts.has(req.headers.host || '')) return next(httpError(403, 'Host non consentito'));
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const o = req.headers.origin;
      let oh = null;
      try { oh = o ? new URL(o).host : null; } catch { /* Origin: null o malformato */ }
      if (!oh || oh !== req.headers.host) return next(httpError(403, 'Origin non consentito'));
    }
    next();
  });
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'], mediaSrc: ["'self'"], connectSrc: ["'self'"], frameSrc: ["'self'"],
        objectSrc: ["'none'"], baseUri: ["'none'"], formAction: ["'self'"], frameAncestors: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-origin' },
  }));
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 3000 }));
  app.use(express.json({ limit: '2mb' }));

  const api = express.Router();
  api.get('/projects', (_q, r) => r.json(listProjects()));
  api.post('/projects', (q, r) => r.status(201).json(createProject(q.body?.name)));
  api.patch('/projects/:slug', (q, r) => { renameProject(q.params.slug, q.body?.name); r.json({ ok: true }); });
  api.delete('/projects/:slug', (q, r) => {
    if (q.query.confirm !== q.params.slug) throw httpError(400, 'Conferma mancante');
    deleteProject(q.params.slug); r.json({ ok: true });
  });
  api.get('/projects/:slug', (q, r) => { getDb(q.params.slug); r.json(listProjects().find(p => p.slug === q.params.slug)); });
  api.use('/projects/:slug/formulas', formulas);
  api.use('/projects/:slug', files);
  api.use('/setup', setup);
  api.use('/inci', inci);
  api.use('/', backup);
  app.use('/api', api);
  app.use('/api', (_q, _r, next) => next(httpError(404, 'Endpoint non trovato')));

  app.use('/vendor/quill', express.static(path.join(root, 'node_modules/quill/dist'), { index: false, dotfiles: 'deny' }));
  app.use('/vendor/dompurify', express.static(path.join(root, 'node_modules/dompurify/dist'), { index: false, dotfiles: 'deny' }));
  app.use(express.static(path.join(root, 'public'), { index: 'index.html', dotfiles: 'deny' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status && err.status < 600 ? err.status : err.type === 'entity.too.large' ? 413 : 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: status === 500 ? 'Errore interno' : str(err.message, 200) });
  });
  return app;
}

function openBrowser(url) {
  try {
    const [cmd, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
    const c = spawn(cmd, args, { stdio: 'ignore', detached: true });
    c.on('error', () => {}); c.unref();
  } catch { /* browser non disponibile: l'URL è stampato in console */ }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const host = process.env.HOST || '127.0.0.1';
  const first = Number(process.env.PORT) || 3000;
  const tryListen = port => {
    const server = createApp({ port }).listen(port, host);
    server.once('listening', () => {
      const url = `http://localhost:${port}`;
      console.log(`\nCosformula pronto su ${url}  (Ctrl+C per chiudere)\n`);
      if (process.argv.includes('--open')) openBrowser(url);
    });
    server.once('error', e => {
      if (e.code === 'EADDRINUSE' && !process.env.PORT && port < first + 20) { console.log(`Porta ${port} occupata, provo ${port + 1}…`); tryListen(port + 1); }
      else { console.error(e.code === 'EADDRINUSE' ? `Porta ${port} occupata (PORT=...)` : e); process.exit(1); }
    });
  };
  tryListen(first);
}
