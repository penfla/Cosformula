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
import yazl from 'yazl';
import yauzl from 'yauzl';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { DATA_DIR, getDb, listProjects, createProject, deleteProject, uploadsDir } from '../projects.js';
import { projectName } from '../db.js';
import { str, num, cleanHtml, validateUpload, httpError, STORED_RE, SLUG_RE } from '../security.js';

export const router = Router();
const TMP = path.join(DATA_DIR, '.import-tmp');
const MAX_IMPORT = 2 * 1024 * 1024 * 1024;
const MAX_ENTRIES = 5000;
const upload = multer({
  storage: multer.diskStorage({
    destination: (_r, _f, cb) => { fs.mkdirSync(TMP, { recursive: true }); cb(null, TMP); },
    filename: (_r, _f, cb) => cb(null, crypto.randomUUID() + '.upload'),
  }),
  limits: { fileSize: MAX_IMPORT, files: 1, fields: 3 },
});

export function exportData(slug) {
  const db = getDb(slug);
  const formulas = db.prepare('SELECT * FROM formulas ORDER BY id').all().map(f => ({
    code: f.code, name: f.name, version: f.version, batch_g: f.batch_g, notes: f.notes, process_html: f.process_html,
    created_at: f.created_at, updated_at: f.updated_at,
    ingredients: db.prepare('SELECT trade_name,inci,inci_status,cosing_ref,phase,function,percent,grams,supplier,note FROM ingredients WHERE formula_id=? ORDER BY position,id').all(f.id),
    files: db.prepare('SELECT original_name,stored_name,mime,kind,size,sha256,caption FROM files WHERE formula_id=? ORDER BY id').all(f.id),
  }));
  return { format: 'cosformula-project', version: 1, exported_at: new Date().toISOString(), project: { name: projectName(db) }, formulas };
}

function addProject(zip, slug, prefix) {
  const data = exportData(slug);
  zip.addBuffer(Buffer.from(JSON.stringify(data, null, 2)), `${prefix}project.json`);
  for (const f of data.formulas) for (const file of f.files) {
    const p = path.join(uploadsDir(slug), file.stored_name);
    if (STORED_RE.test(file.stored_name) && fs.existsSync(p)) zip.addFile(p, `${prefix}files/${file.stored_name}`, { compress: false });
  }
}

router.get('/projects/:slug/export', (req, res) => {
  const slug = req.params.slug;
  const data = exportData(slug);
  const base = (SLUG_RE.test(slug) ? slug : 'progetto');
  if (req.query.format === 'zip') {
    const zip = new yazl.ZipFile();
    addProject(zip, slug, '');
    res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${base}.cosformula.zip"` });
    zip.outputStream.pipe(res);
    zip.end();
  } else {
    res.set({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="${base}.cosformula.json"` });
    res.send(JSON.stringify(data, null, 2));
  }
});

router.get('/export-all', (_req, res) => {
  const zip = new yazl.ZipFile();
  for (const p of listProjects()) addProject(zip, p.slug, `${p.slug}/`);
  res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="cosformula-database.zip"' });
  zip.outputStream.pipe(res);
  zip.end();
});

// ---------- import ----------
const ENTRY_RE = /^(?:([a-z0-9][a-z0-9-]{0,62})\/)?(project\.json|files\/[0-9a-f-]{36}\.[a-z0-9]{2,5})$/;

function extractZip(zipPath, outDir) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, validateEntrySizes: true }, (err, zf) => {
      if (err) return reject(httpError(400, 'ZIP non valido'));
      let total = 0, n = 0;
      const map = new Map(); // "group|name" -> local path
      zf.on('error', e => reject(httpError(400, 'ZIP non valido')));
      zf.on('end', () => resolve(map));
      zf.on('entry', entry => {
        if (++n > MAX_ENTRIES) return reject(httpError(400, 'Troppe voci nello ZIP'));
        if (/\/$/.test(entry.fileName)) return zf.readEntry();
        const m = ENTRY_RE.exec(entry.fileName);
        if (!m) return zf.readEntry(); // voci inattese ignorate (mai estratte)
        total += entry.uncompressedSize;
        if (total > MAX_IMPORT * 2 || (entry.fileName === 'project.json' || m[2] === 'project.json') && entry.uncompressedSize > 200 * 1024 * 1024)
          return reject(httpError(400, 'ZIP troppo grande'));
        const local = path.join(outDir, crypto.randomUUID());
        zf.openReadStream(entry, (e2, rs) => {
          if (e2) return reject(httpError(400, 'ZIP non valido'));
          pipeline(rs, fs.createWriteStream(local)).then(() => { map.set(`${m[1] || ''}|${m[2]}`, local); zf.readEntry(); }, reject);
        });
      });
      zf.readEntry();
    });
  });
}

async function importOne(data, files, fallbackName) {
  if (!data || data.format !== 'cosformula-project' || data.version !== 1 || !Array.isArray(data.formulas) || data.formulas.length > 5000)
    throw httpError(400, 'Formato progetto non riconosciuto');
  const proj = createProject(str(data.project?.name, 100) || fallbackName);
  try {
    const dir = uploadsDir(proj.slug);
    const db = getDb(proj.slug);
    const prepared = [];
    for (const f of data.formulas) {
      const fl = [];
      for (const file of Array.isArray(f.files) ? f.files.slice(0, 500) : []) {
        const src = files?.get(String(file?.stored_name));
        if (!src || !STORED_RE.test(String(file.stored_name))) continue;
        const size = fs.statSync(src).size;
        const v = await validateUpload(src, String(file.stored_name), size);
        const stored = `${crypto.randomUUID()}.${v.ext}`;
        fs.copyFileSync(src, path.join(dir, stored));
        const sha = crypto.createHash('sha256').update(fs.readFileSync(src)).digest('hex');
        fl.push({ original_name: str(file.original_name, 200) || stored, stored, mime: v.mime, kind: v.kind, size, sha, caption: str(file.caption, 500) });
      }
      prepared.push([f, fl]);
    }
    const insF = db.prepare('INSERT INTO formulas(code,name,version,batch_g,notes,process_html,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)');
    const insI = db.prepare(`INSERT INTO ingredients(formula_id,position,trade_name,inci,inci_status,cosing_ref,phase,function,percent,grams,supplier,note) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insFile = db.prepare('INSERT INTO files(formula_id,original_name,stored_name,mime,kind,size,sha256,caption) VALUES(?,?,?,?,?,?,?,?)');
    db.transaction(() => {
      for (const [f, fl] of prepared) {
        const id = insF.run(str(f.code, 40), str(f.name, 200) || 'Senza nome', str(f.version, 20), num(f.batch_g), str(f.notes, 5000),
          cleanHtml(f.process_html), str(f.created_at, 30) || new Date().toISOString(), str(f.updated_at, 30) || new Date().toISOString()).lastInsertRowid;
        (Array.isArray(f.ingredients) ? f.ingredients.slice(0, 500) : []).forEach((i, pos) => {
          const inci = str(i?.inci, 300);
          let st = ['verified', 'unverified', 'none'].includes(i?.inci_status) ? i.inci_status : 'unverified';
          if (!inci) st = 'none'; else if (st === 'none') st = 'unverified';
          insI.run(id, pos, str(i?.trade_name, 200), inci, st, st === 'verified' ? str(i?.cosing_ref, 40) : '', str(i?.phase, 20),
            str(i?.function, 200), num(i?.percent), num(i?.grams), str(i?.supplier, 200), str(i?.note, 1000));
        });
        for (const x of fl) insFile.run(id, x.original_name, x.stored, x.mime, x.kind, x.size, x.sha, x.caption);
      }
    })();
    return proj;
  } catch (e) { deleteProject(proj.slug); throw e; }
}

router.post('/import', (req, res, next) => {
  upload.single('file')(req, res, async err => {
    if (err) return next(err.code === 'LIMIT_FILE_SIZE' ? httpError(413, 'File troppo grande') : err);
    if (!req.file) return next(httpError(400, 'Nessun file'));
    const work = path.join(TMP, crypto.randomUUID());
    const imported = [];
    try {
      fs.mkdirSync(work, { recursive: true });
      const head = Buffer.alloc(4);
      const fd = fs.openSync(req.file.path, 'r'); fs.readSync(fd, head, 0, 4, 0); fs.closeSync(fd);
      const fallback = str(path.basename(req.file.originalname).replace(/\.[^.]+$/, ''), 100) || 'Importato';
      if (head.toString('latin1', 0, 2) === 'PK') {
        const map = await extractZip(req.file.path, work);
        const groups = new Set([...map.keys()].filter(k => k.endsWith('|project.json')).map(k => k.split('|')[0]));
        if (!groups.size) throw httpError(400, 'project.json mancante nello ZIP');
        for (const g of groups) {
          const files = new Map();
          for (const [k, p] of map) if (k.startsWith(g + '|files/')) files.set(k.split('/')[1], p);
          const data = JSON.parse(fs.readFileSync(map.get(`${g}|project.json`), 'utf8'));
          imported.push(await importOne(data, files, g || fallback));
        }
      } else {
        if (req.file.size > 200 * 1024 * 1024) throw httpError(413, 'JSON troppo grande');
        let data;
        try { data = JSON.parse(fs.readFileSync(req.file.path, 'utf8')); } catch { throw httpError(400, 'JSON non valido'); }
        imported.push(await importOne(data, null, fallback));
      }
      res.status(201).json({ imported });
    } catch (e) { for (const p of imported) { try { deleteProject(p.slug); } catch {} } next(e instanceof SyntaxError ? httpError(400, 'JSON non valido') : e); }
    finally { fs.rmSync(req.file.path, { force: true }); fs.rmSync(work, { recursive: true, force: true }); }
  });
});
