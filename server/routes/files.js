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
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getDb, uploadsDir } from '../projects.js';
import { ID_RE, cleanHtml, str, validateUpload, httpError, MAX_MEDIA, MAX_PROJECT_BYTES, ALLOWED, extOf, STORED_RE, insideRoot } from '../security.js';

export const router = Router({ mergeParams: true });

const upload = multer({
  storage: multer.diskStorage({
    destination(req, _f, cb) {
      try {
        const dir = path.join(uploadsDir(req.params.slug), '.tmp');
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      } catch (e) { cb(e); }
    },
    filename: (_r, _f, cb) => cb(null, crypto.randomUUID() + '.part'),
  }),
  limits: { fileSize: MAX_MEDIA, files: 20, fields: 8, parts: 32 },
});

function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', d => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

const DOC_TYPES = new Set(['', 'SDS', 'TDS', 'COA', 'OTHER']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FILE_COLS = 'id,formula_id,material_id,doc_type,doc_date,revision,language,original_name,stored_name,mime,kind,size,caption,created_at';

/** owner: 'formula' | 'material' — il file appartiene a una scheda formula oppure a una materia prima (SDS/TDS/CoA…). */
function uploadHandler(owner) {
  const [table, col, param] = owner === 'material' ? ['materials', 'material_id', 'mid'] : ['formulas', 'formula_id', 'fid'];
  return (req, res, next) => {
    if (!ID_RE.test(req.params[param])) return next(httpError(400, 'ID non valido'));
    getDb(req.params.slug); // 404 early
    upload.array('files', 20)(req, res, async err => {
      if (err) return next(err.code === 'LIMIT_FILE_SIZE' ? httpError(413, 'File troppo grande') : err);
      const db = getDb(req.params.slug);
      const created = [], errors = [];
      const dir = uploadsDir(req.params.slug);
      const b = req.body || {};
      const docType = owner === 'material' && DOC_TYPES.has(b.doc_type) ? b.doc_type : '';
      const docDate = DATE_RE.test(b.doc_date || '') ? b.doc_date : '';
      try {
        if (!db.prepare(`SELECT 1 FROM ${table} WHERE id=?`).get(req.params[param])) throw httpError(404, 'Elemento non trovato');
        let used = db.prepare('SELECT COALESCE(SUM(size),0) s FROM files').get().s;
        for (const f of req.files || []) {
          try {
            const orig = path.basename(f.originalname).slice(0, 200);
            const v = await validateUpload(f.path, orig, f.size);
            if (used + f.size > MAX_PROJECT_BYTES) throw httpError(413, 'Quota progetto superata');
            const stored = `${crypto.randomUUID()}.${v.ext}`;
            const digest = await sha256(f.path);
            fs.renameSync(f.path, path.join(dir, stored));
            used += f.size;
            const r = db.prepare(`INSERT INTO files(${col},doc_type,doc_date,revision,language,original_name,stored_name,mime,kind,size,sha256) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
              .run(req.params[param], docType, docDate, str(b.revision, 40), str(b.language, 20), orig, stored, v.mime, v.kind, f.size, digest);
            created.push(db.prepare(`SELECT ${FILE_COLS} FROM files WHERE id=?`).get(r.lastInsertRowid));
          } catch (e) { errors.push({ name: f.originalname, error: e.message }); }
        }
      } catch (e) { return next(e); }
      finally { for (const f of req.files || []) fs.rmSync(f.path, { force: true }); }
      res.status(created.length ? 201 : 400).json({ created, errors });
    });
  };
}
router.post('/formulas/:fid/files', uploadHandler('formula'));
router.post('/materials/:mid/files', uploadHandler('material'));

function fileRow(req) {
  if (!ID_RE.test(req.params.id)) throw httpError(400, 'ID non valido');
  const row = getDb(req.params.slug).prepare('SELECT * FROM files WHERE id=?').get(req.params.id);
  if (!row) throw httpError(404, 'File non trovato');
  return row;
}

function sendRaw(req, res, row) {
  const dir = uploadsDir(req.params.slug);
  const file = path.join(dir, row.stored_name);
  const ext = extOf(row.stored_name);
  if (!STORED_RE.test(row.stored_name) || !ALLOWED[ext] || !insideRoot(dir, file) || !fs.existsSync(file)) throw httpError(404, 'File non trovato');
  const inline = row.kind === 'image' || row.kind === 'video' || ext === 'pdf';
  const safeName = row.original_name.replace(/[^\w.\- ]+/g, '_');
  res.set({
    'Content-Type': ALLOWED[ext].mime,
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `${inline && req.query.download !== '1' ? 'inline' : 'attachment'}; filename="${safeName}"`,
    'Content-Security-Policy': ext === 'pdf' ? "default-src 'none'; style-src 'unsafe-inline'; img-src data:" : "default-src 'none'; sandbox",
    'Cache-Control': 'private, max-age=3600',
  });
  res.sendFile(file); // gestisce Range (video)
}

router.get('/files/:id/raw', (req, res) => sendRaw(req, res, fileRow(req)));
// Accesso per nome file (stabile tra export/import): usato dagli allegati incorporati nel processo.
router.get('/files/n/:name/raw', (req, res) => {
  if (!STORED_RE.test(req.params.name)) throw httpError(400, 'Nome non valido');
  const row = getDb(req.params.slug).prepare('SELECT * FROM files WHERE stored_name=?').get(req.params.name);
  if (!row) throw httpError(404, 'File non trovato');
  sendRaw(req, res, row);
});

router.patch('/files/:id', (req, res) => {
  const row = fileRow(req), b = req.body || {};
  const db = getDb(req.params.slug);
  db.prepare('UPDATE files SET caption=?, doc_type=?, doc_date=?, revision=?, language=? WHERE id=?').run(
    b.caption !== undefined ? str(b.caption, 500) : row.caption,
    row.material_id && DOC_TYPES.has(b.doc_type) ? b.doc_type : row.doc_type,
    b.doc_date !== undefined ? (DATE_RE.test(b.doc_date) ? b.doc_date : '') : row.doc_date,
    b.revision !== undefined ? str(b.revision, 40) : row.revision,
    b.language !== undefined ? str(b.language, 20) : row.language, row.id);
  res.json({ ok: true });
});

router.delete('/files/:id', (req, res) => {
  const row = fileRow(req);
  const db = getDb(req.params.slug);
  db.transaction(() => {
    db.prepare('DELETE FROM files WHERE id=?').run(row.id);
    // rimuove dal processo di ogni formula i riferimenti al file eliminato
    const allowed = new Set(db.prepare('SELECT stored_name FROM files').all().map(r => r.stored_name));
    for (const f of db.prepare('SELECT id, process_html FROM formulas WHERE process_html LIKE ?').all(`%${row.stored_name}%`))
      db.prepare('UPDATE formulas SET process_html=? WHERE id=?').run(cleanHtml(f.process_html, allowed), f.id);
  })();
  fs.rmSync(path.join(uploadsDir(req.params.slug), row.stored_name), { force: true });
  res.json({ ok: true });
});
