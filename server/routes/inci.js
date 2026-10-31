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
import { str } from '../security.js';

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
