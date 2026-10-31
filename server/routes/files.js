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
import { ID_RE, str, validateUpload, httpError, MAX_MEDIA, MAX_PROJECT_BYTES, ALLOWED, extOf, STORED_RE, insideRoot } from '../security.js';

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
  limits: { fileSize: MAX_MEDIA, files: 20, fields: 5, parts: 30 },
});

function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', d => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

router.post('/formulas/:fid/files', (req, res, next) => {
  if (!ID_RE.test(req.params.fid)) return next(httpError(400, 'ID non valido'));
  getDb(req.params.slug); // 404 early
  upload.array('files', 20)(req, res, async err => {
    if (err) return next(err.code === 'LIMIT_FILE_SIZE' ? httpError(413, 'File troppo grande') : err);
    const db = getDb(req.params.slug);
    const created = [], errors = [];
    const dir = uploadsDir(req.params.slug);
    try {
      if (!db.prepare('SELECT 1 FROM formulas WHERE id=?').get(req.params.fid)) throw httpError(404, 'Formula non trovata');
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
          const r = db.prepare('INSERT INTO files(formula_id,original_name,stored_name,mime,kind,size,sha256) VALUES(?,?,?,?,?,?,?)')
            .run(req.params.fid, orig, stored, v.mime, v.kind, f.size, digest);
          created.push(db.prepare('SELECT id,original_name,mime,kind,size,caption,created_at FROM files WHERE id=?').get(r.lastInsertRowid));
        } catch (e) { errors.push({ name: f.originalname, error: e.message }); }
      }
    } catch (e) { return next(e); }
    finally { for (const f of req.files || []) fs.rmSync(f.path, { force: true }); }
    res.status(created.length ? 201 : 400).json({ created, errors });
  });
});

function fileRow(req) {
  if (!ID_RE.test(req.params.id)) throw httpError(400, 'ID non valido');
  const row = getDb(req.params.slug).prepare('SELECT * FROM files WHERE id=?').get(req.params.id);
  if (!row) throw httpError(404, 'File non trovato');
  return row;
}

router.get('/files/:id/raw', (req, res) => {
  const row = fileRow(req);
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
});

router.patch('/files/:id', (req, res) => {
  const row = fileRow(req);
  getDb(req.params.slug).prepare('UPDATE files SET caption=? WHERE id=?').run(str(req.body?.caption, 500), row.id);
  res.json({ ok: true });
});

router.delete('/files/:id', (req, res) => {
  const row = fileRow(req);
  getDb(req.params.slug).prepare('DELETE FROM files WHERE id=?').run(row.id);
  fs.rmSync(path.join(uploadsDir(req.params.slug), row.stored_name), { force: true });
  res.json({ ok: true });
});
