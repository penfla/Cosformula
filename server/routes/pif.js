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
import { getDb } from '../projects.js';
import { ID_RE, httpError } from '../security.js';
import { buildContext, savePifData, savePifSection, SECTIONS } from '../pifctx.js';

export const router = Router({ mergeParams: true });
const fid = req => { if (!ID_RE.test(req.params.fid)) throw httpError(400, 'ID non valido'); return Number(req.params.fid); };

router.get('/formulas/:fid/pif', (req, res) => res.json({ ...buildContext(getDb(req.params.slug), fid(req)), sectionDefs: SECTIONS }));
router.put('/formulas/:fid/pif/data', (req, res) => {
  const db = getDb(req.params.slug), id = fid(req);
  savePifData(db, id, req.body?.data); res.json({ data: buildContext(db, id).data });
});
router.put('/formulas/:fid/pif/sections/:key', (req, res) => {
  const html = savePifSection(getDb(req.params.slug), fid(req), req.params.key, req.body?.html);
  res.json({ html });
});
