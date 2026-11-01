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
import fs from 'node:fs';
import path from 'node:path';
import { getDb, uploadsDir } from '../projects.js';
import { exact } from '../inci/cosing.js';
import { ID_RE, str, num, httpError } from '../security.js';

export const router = Router({ mergeParams: true });

const TEXT = { name: 200, inci: 300, cas: 200, ec: 200, supplier: 200, supplier_code: 100, function: 200, appearance: 200, ph: 100, density: 100,
  hazard: 1000, noael_ref: 300, allergens: 500, impurities: 1000, tds_notes: 5000, sds_notes: 5000 };
const NUM = ['active_pct', 'use_level_max', 'noael', 'dermal_abs'];
export const FIELDS = [...Object.keys(TEXT), 'inci_status', 'cosing_ref', ...NUM];

/** Normalizza i campi di una materia prima (INCI "verified" solo con match esatto nel dataset CosIng). */
export function cleanMaterial(b = {}) {
  const m = {};
  for (const [k, max] of Object.entries(TEXT)) m[k] = str(b[k], max);
  m.name = m.name || 'Materia prima';
  for (const k of NUM) m[k] = num(b[k]);
  if (m.active_pct == null || m.active_pct > 100 || m.active_pct <= 0) m.active_pct = 100;
  if (m.dermal_abs != null && m.dermal_abs > 100) m.dermal_abs = 100;
  m.inci_status = m.inci ? (['verified', 'unverified'].includes(b.inci_status) ? b.inci_status : 'unverified') : 'none';
  m.cosing_ref = '';
  if (m.inci_status === 'verified') { const x = exact(m.inci); if (x) { m.cosing_ref = x.ref || ''; if (!m.cas && x.cas) m.cas = x.cas.slice(0, 200); if (!m.ec && x.ec) m.ec = x.ec.slice(0, 200); } else m.inci_status = 'unverified'; }
  return m;
}

const mid = req => { if (!ID_RE.test(req.params.mid)) throw httpError(400, 'ID non valido'); return Number(req.params.mid); };
const DOC_COLS = 'id,material_id,doc_type,doc_date,revision,language,original_name,stored_name,mime,kind,size,caption,created_at';

export function loadMaterial(db, id) {
  const m = db.prepare('SELECT * FROM materials WHERE id=?').get(id);
  if (!m) throw httpError(404, 'Materia prima non trovata');
  m.docs = db.prepare(`SELECT ${DOC_COLS} FROM files WHERE material_id=? ORDER BY doc_type, doc_date DESC, id`).all(id);
  m.used_in = db.prepare('SELECT DISTINCT f.id, f.name, f.code FROM ingredients i JOIN formulas f ON f.id=i.formula_id WHERE i.material_id=? ORDER BY f.name').all(id);
  return m;
}

router.get('/', (req, res) => {
  const db = getDb(req.params.slug);
  res.json(db.prepare(`SELECT m.id,m.name,m.inci,m.inci_status,m.supplier,m.supplier_code,m.function,
    (SELECT COUNT(*) FROM files WHERE material_id=m.id AND doc_type='SDS') AS sds,
    (SELECT COUNT(*) FROM files WHERE material_id=m.id AND doc_type='TDS') AS tds,
    (SELECT COUNT(*) FROM ingredients WHERE material_id=m.id) AS used FROM materials m ORDER BY m.name COLLATE NOCASE`).all());
});

router.post('/', (req, res) => {
  const db = getDb(req.params.slug), m = cleanMaterial(req.body);
  const cols = FIELDS;
  const r = db.prepare(`INSERT INTO materials(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`).run(...cols.map(c => m[c]));
  res.status(201).json(loadMaterial(db, r.lastInsertRowid));
});

router.get('/:mid', (req, res) => res.json(loadMaterial(getDb(req.params.slug), mid(req))));

router.put('/:mid', (req, res) => {
  const db = getDb(req.params.slug), id = mid(req);
  loadMaterial(db, id);
  const m = cleanMaterial(req.body);
  db.prepare(`UPDATE materials SET ${FIELDS.map(c => c + '=?').join(',')}, updated_at=datetime('now') WHERE id=?`).run(...FIELDS.map(c => m[c]), id);
  res.json(loadMaterial(db, id));
});

router.delete('/:mid', (req, res) => {
  const db = getDb(req.params.slug), id = mid(req);
  const files = db.prepare('SELECT stored_name FROM files WHERE material_id=?').all(id);
  if (!db.prepare('DELETE FROM materials WHERE id=?').run(id).changes) throw httpError(404, 'Materia prima non trovata');
  for (const f of files) fs.rmSync(path.join(uploadsDir(req.params.slug), f.stored_name), { force: true });
  res.json({ ok: true });
});
