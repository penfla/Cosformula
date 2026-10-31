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
import { ID_RE, str, num, cleanHtml, httpError } from '../security.js';

export const router = Router({ mergeParams: true });

const STATUS = new Set(['verified', 'unverified', 'none']);

function fid(req) {
  if (!ID_RE.test(req.params.fid)) throw httpError(400, 'ID non valido');
  return Number(req.params.fid);
}

export function loadFormula(db, id) {
  const f = db.prepare('SELECT * FROM formulas WHERE id=?').get(id);
  if (!f) throw httpError(404, 'Formula non trovata');
  f.ingredients = db.prepare('SELECT * FROM ingredients WHERE formula_id=? ORDER BY position, id').all(id);
  f.files = db.prepare('SELECT id,original_name,mime,kind,size,caption,created_at FROM files WHERE formula_id=? ORDER BY id').all(id);
  return f;
}

function writeIngredients(db, id, list) {
  if (!Array.isArray(list) || list.length > 500) throw httpError(400, 'Ingredienti non validi');
  db.prepare('DELETE FROM ingredients WHERE formula_id=?').run(id);
  const ins = db.prepare(`INSERT INTO ingredients(formula_id,position,trade_name,inci,inci_status,cosing_ref,phase,function,percent,grams,supplier,note)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
  list.forEach((i, pos) => {
    const inci = str(i.inci, 300);
    let status = STATUS.has(i.inci_status) ? i.inci_status : 'unverified';
    if (!inci) status = 'none';
    else if (status === 'none') status = 'unverified';
    // 'verified' è concesso solo se l'INCI coincide esattamente con una voce del dataset CosIng locale.
    let ref = '';
    if (status === 'verified') {
      const m = exact(inci);
      if (m) ref = m.ref || ''; else status = 'unverified';
    }
    ins.run(id, pos, str(i.trade_name, 200), inci, status, ref,
      str(i.phase, 20), str(i.function, 200), num(i.percent), num(i.grams), str(i.supplier, 200), str(i.note, 1000));
  });
}

router.get('/', (req, res) => {
  const db = getDb(req.params.slug);
  res.json(db.prepare(`SELECT f.id,f.code,f.name,f.version,f.updated_at,
    (SELECT COUNT(*) FROM ingredients WHERE formula_id=f.id) AS ingredients,
    (SELECT COUNT(*) FROM files WHERE formula_id=f.id) AS files FROM formulas f ORDER BY f.updated_at DESC, f.id DESC`).all());
});

router.post('/', (req, res) => {
  const db = getDb(req.params.slug);
  const b = req.body || {};
  const r = db.prepare('INSERT INTO formulas(code,name,version,batch_g) VALUES(?,?,?,?)')
    .run(str(b.code, 40), str(b.name, 200) || 'Nuova formula', str(b.version, 20) || '1.0', num(b.batch_g) ?? 100);
  res.status(201).json(loadFormula(db, r.lastInsertRowid));
});

router.get('/:fid', (req, res) => res.json(loadFormula(getDb(req.params.slug), fid(req))));

router.put('/:fid', (req, res) => {
  const db = getDb(req.params.slug);
  const id = fid(req);
  const b = req.body || {};
  db.transaction(() => {
    loadFormula(db, id);
    db.prepare("UPDATE formulas SET code=?,name=?,version=?,batch_g=?,notes=?,updated_at=datetime('now') WHERE id=?")
      .run(str(b.code, 40), str(b.name, 200) || 'Senza nome', str(b.version, 20), num(b.batch_g), str(b.notes, 5000), id);
    if (b.ingredients !== undefined) writeIngredients(db, id, b.ingredients);
  })();
  res.json(loadFormula(db, id));
});

router.put('/:fid/process', (req, res) => {
  const db = getDb(req.params.slug);
  const id = fid(req);
  const html = cleanHtml(req.body?.html);
  const r = db.prepare("UPDATE formulas SET process_html=?,updated_at=datetime('now') WHERE id=?").run(html, id);
  if (!r.changes) throw httpError(404, 'Formula non trovata');
  res.json({ html });
});

router.post('/:fid/duplicate', (req, res) => {
  const db = getDb(req.params.slug);
  const src = loadFormula(db, fid(req));
  const newId = db.transaction(() => {
    const r = db.prepare('INSERT INTO formulas(code,name,version,batch_g,notes,process_html) VALUES(?,?,?,?,?,?)')
      .run(src.code, `${src.name} (copia)`.slice(0, 200), src.version, src.batch_g, src.notes, src.process_html);
    writeIngredients(db, r.lastInsertRowid, src.ingredients);
    return r.lastInsertRowid;
  })();
  res.status(201).json(loadFormula(db, newId));
});

router.delete('/:fid', (req, res) => {
  const db = getDb(req.params.slug);
  const id = fid(req);
  const files = db.prepare('SELECT stored_name FROM files WHERE formula_id=?').all(id);
  const r = db.prepare('DELETE FROM formulas WHERE id=?').run(id);
  if (!r.changes) throw httpError(404, 'Formula non trovata');
  for (const f of files) fs.rmSync(path.join(uploadsDir(req.params.slug), f.stored_name), { force: true });
  res.json({ ok: true });
});
