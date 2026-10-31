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
import { renderDocument } from '../print.js';
import { getDb } from '../projects.js';
import { ID_RE, SLUG_RE, httpError } from '../security.js';

export const router = Router();

// GET /api/projects/:slug/print?ids=1,2,3|all&size=A4&cover=1&toc=1&attachments=1[&download=1]
router.get('/projects/:slug/print', (req, res) => {
  const slug = req.params.slug;
  getDb(slug);
  const q = req.query;
  let ids = 'all';
  if (q.ids && q.ids !== 'all') {
    const parts = String(q.ids).split(',').slice(0, 5000);
    if (!parts.every(p => ID_RE.test(p))) throw httpError(400, 'ids non validi');
    ids = parts.map(Number);
  }
  const download = q.download === '1';
  const html = renderDocument(slug, ids, {
    size: String(q.size || 'A4'), cover: q.cover === '1', toc: q.toc === '1', attachments: q.attachments !== '0', embed: download, download,
  });
  res.set('Content-Type', 'text/html; charset=utf-8');
  if (download) res.set('Content-Disposition', `attachment; filename="${SLUG_RE.test(slug) ? slug : 'cosformula'}-${ids === 'all' || ids.length > 1 ? 'booklet' : 'scheda-' + ids[0]}.html"`);
  res.send(html);
});
