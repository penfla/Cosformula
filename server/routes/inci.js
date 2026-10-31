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

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { search, verify, status, live } from '../inci/cosing.js';
import multer from 'multer';
import { str, httpError } from '../security.js';
import { importCosingCsv, loadSeed } from '../inci/importer.js';

const up = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024, files: 1, fields: 3 } });

export const router = Router();
router.use(rateLimit({ windowMs: 60_000, limit: 600 }));

router.get('/status', (_req, res) => res.json(status()));
router.get('/search', (req, res) => res.json(search(str(req.query.q, 100))));
router.get('/verify', async (req, res) => {
  const name = str(req.query.name, 300);
  if (name.length < 2) return res.status(400).json({ error: 'Nome troppo corto' });
  const out = verify(name);
  if (req.query.live === '1') out.live = await live(name);
  res.json(out);
});

router.post('/dataset', (req, res, next) => {
  up.single('file')(req, res, err => {
    if (err) return next(err.code === 'LIMIT_FILE_SIZE' ? httpError(413, 'File troppo grande (max 100 MB)') : err);
    try {
      if (req.body?.seed === '1') { const n = loadSeed(); return res.json({ imported: n, ...status() }); }
      if (!req.file) throw httpError(400, 'Nessun file');
      const n = importCosingCsv(req.file.buffer, str(req.body?.label, 100) || str(req.file.originalname, 100));
      res.json({ imported: n, ...status() });
    } catch (e) { next(e); }
  });
});
