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

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import request from 'supertest';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cosf-'));
process.env.COSFORMULA_DATA = tmp;
execFileSync(process.execPath, ['scripts/import-cosing.js', 'data/cosing-seed.csv', '--label', 'test'], { env: process.env, stdio: 'ignore' });
const { createApp } = await import('../server/index.js');
const { closeAll } = await import('../server/projects.js');
const app = createApp({ port: 3000 });
const H = { Host: 'localhost:3000', Origin: 'http://localhost:3000' };
const api = {
  get: u => request(app).get(u).set('Host', H.Host),
  post: u => request(app).post(u).set(H),
  put: u => request(app).put(u).set(H),
  patch: u => request(app).patch(u).set(H),
  del: u => request(app).delete(u).set(H),
};
// PNG 1x1
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

let slug, fid;
after(() => { closeAll(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('host e origin guard', async () => {
  assert.equal((await request(app).get('/api/projects').set('Host', 'evil.com')).status, 403);
  assert.equal((await request(app).post('/api/projects').set({ Host: H.Host, Origin: 'http://evil.com' }).send({ name: 'x' })).status, 403);
  assert.equal((await request(app).post('/api/projects').set({ Host: H.Host }).send({ name: 'x' })).status, 403);
});

test('progetti e formule CRUD', async () => {
  const p = await api.post('/api/projects').send({ name: 'Creme Viso' });
  assert.equal(p.status, 201); slug = p.body.slug;
  assert.equal(slug, 'creme-viso');
  assert.equal((await api.post('/api/projects').send({ name: 'Creme Viso' })).body.slug, 'creme-viso-2');
  const f = await api.post(`/api/projects/${slug}/formulas`).send({ name: 'Crema O/A', batch_g: 200 });
  fid = f.body.id;
  const u = await api.put(`/api/projects/${slug}/formulas/${fid}`).send({
    name: 'Crema O/A', batch_g: 200, ingredients: [
      { trade_name: 'Acqua', inci: 'Aqua', inci_status: 'verified', percent: '70,5' },
      { trade_name: 'Estratto segreto', inci: '', inci_status: 'verified', percent: 1 },
      { trade_name: 'Mix', inci: 'Foo Bar', inci_status: 'verified', cosing_ref: '123', percent: 28.5 },
    ],
  });
  assert.equal(u.status, 200);
  const ing = u.body.ingredients;
  assert.equal(ing[0].percent, 70.5);
  assert.equal(ing[1].inci_status, 'none');       // senza INCI ammesso
  assert.equal(ing[0].inci_status, 'verified');
  assert.equal(ing[2].inci_status, 'unverified'); // 'Foo Bar' non è nel dataset: declassato dal server
  assert.equal((await api.get(`/api/projects/${slug}/formulas/abc`)).status, 400);
  assert.equal((await api.get(`/api/projects/..%2Fx/formulas`)).status, 400);
  const d = await api.post(`/api/projects/${slug}/formulas/${fid}/duplicate`);
  assert.equal(d.body.ingredients.length, 3);
});

test('processo: sanitizzazione XSS', async () => {
  const r = await api.put(`/api/projects/${slug}/formulas/${fid}/process`)
    .send({ html: '<p>ok <strong>b</strong><script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">x</a><a href="https://e.com">y</a></p>' });
  assert.ok(!/script|onerror|javascript:|<img/i.test(r.body.html), r.body.html);
  assert.match(r.body.html, /<strong>b<\/strong>/);
  assert.match(r.body.html, /rel="noopener noreferrer"/);
});

test('INCI search/verify', async () => {
  const s = await api.get('/api/inci/search?q=glycer');
  assert.ok(s.body.some(x => x.inci_name === 'Glycerin'));
  const v = await api.get('/api/inci/verify?name=glycerin');
  assert.equal(v.body.verdict, 'verified');
  assert.equal((await api.get('/api/inci/verify?name=Zzzqqq')).body.verdict, 'not_found');
});

test('upload: allowlist e magic bytes', async () => {
  const url = `/api/projects/${slug}/formulas/${fid}/files`;
  const ok = await api.post(url).attach('files', PNG, 'foto.png');
  assert.equal(ok.status, 201);
  const id = ok.body.created[0].id;
  const raw = await api.get(`/api/projects/${slug}/files/${id}/raw`);
  assert.equal(raw.headers['content-type'], 'image/png');
  assert.equal(raw.headers['x-content-type-options'], 'nosniff');
  // html travestito da jpg, eseguibile, svg, estensione sconosciuta
  for (const [buf, name] of [[Buffer.from('<html><script>1</script>'), 'a.jpg'], [PNG, 'a.html'], [Buffer.from('<svg/>'), 'a.svg'], [Buffer.from('MZ\x90'), 'a.exe'], [PNG, 'a.jpg'], [Buffer.from('a\0b'), 'a.txt']]) {
    const r = await api.post(url).attach('files', buf, name);
    assert.equal(r.status, 400, name);
    assert.equal(r.body.created.length, 0);
  }
  const txt = await api.post(url).attach('files', Buffer.from('a,b\n1,2\n'), 'dati.csv');
  assert.equal(txt.status, 201);
  const cap = await api.patch(`/api/projects/${slug}/files/${id}`).send({ caption: 'Fase A' });
  assert.equal(cap.status, 200);
  assert.equal((await api.del(`/api/projects/${slug}/files/${id}`)).status, 200);
  assert.equal((await api.get(`/api/projects/${slug}/files/${id}/raw`)).status, 404);
});

test('backup: round-trip JSON e ZIP', async () => {
  const j = await api.get(`/api/projects/${slug}/export?format=json`);
  assert.equal(j.body.format, 'cosformula-project');
  assert.equal(j.body.formulas.length, 2);
  const imp = await api.post('/api/import').attach('file', Buffer.from(j.text), 'bk.json');
  assert.equal(imp.status, 201);
  const ns = imp.body.imported[0].slug;
  assert.equal((await api.get(`/api/projects/${ns}/formulas`)).body.length, 2);

  const z = await request(app).get(`/api/projects/${slug}/export?format=zip`).set('Host', H.Host).buffer().parse((res, cb) => {
    const c = []; res.on('data', d => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c)));
  });
  assert.equal(z.status, 200);
  const imp2 = await api.post('/api/import').attach('file', z.body, 'bk.zip');
  assert.equal(imp2.status, 201);
  const ns2 = imp2.body.imported[0].slug;
  const fl = (await api.get(`/api/projects/${ns2}/formulas`)).body;
  const withFiles = fl.find(x => x.files > 0);
  assert.ok(withFiles, 'allegato ripristinato');

  const all = await request(app).get('/api/export-all').set('Host', H.Host).buffer().parse((res, cb) => {
    const c = []; res.on('data', d => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c)));
  });
  const imp3 = await api.post('/api/import').attach('file', all.body, 'all.zip');
  assert.equal(imp3.status, 201);
  assert.ok(imp3.body.imported.length >= 3);

  assert.equal((await api.post('/api/import').attach('file', Buffer.from('{"format":"x"}'), 'x.json')).status, 400);
  assert.equal((await api.post('/api/import').attach('file', Buffer.from('not json'), 'x.json')).status, 400);
});

test('elimina progetto richiede conferma', async () => {
  assert.equal((await api.del(`/api/projects/${slug}`)).status, 400);
  assert.equal((await api.del(`/api/projects/${slug}?confirm=${slug}`)).status, 200);
  assert.equal((await api.get(`/api/projects/${slug}/formulas`)).status, 404);
});

test('Origin malformato/null → 403 (non 500)', async () => {
  const r = await request(app).post('/api/projects').set({ Host: H.Host, Origin: 'null' }).send({ name: 'x' });
  assert.equal(r.status, 403);
});

test('allegati nel processo: riferimenti, rimozione, export/import, stampa', async () => {
  const p = (await api.post('/api/projects').send({ name: 'Embed' })).body.slug;
  const f = (await api.post(`/api/projects/${p}/formulas`).send({ name: 'Con <b>foto</b>', code: 'X&1' })).body.id;
  await api.put(`/api/projects/${p}/formulas/${f}`).send({ name: 'Con <b>foto</b>', code: 'X&1', batch_g: 100, ingredients: [{ trade_name: 'A', inci: 'Aqua', percent: 60 }, { trade_name: 'B', inci: 'Glycerin', percent: 40 }, { trade_name: 'C<script>', inci: 'Xyz Abc', inci_status: 'unverified', percent: 0.5 }] });
  const up = (await api.post(`/api/projects/${p}/formulas/${f}/files`).attach('files', PNG, 'passo1.png')).body.created[0];
  const name = up.stored_name;
  assert.match(name, /\.png$/);
  const html = `<p>Passo 1</p><img src="cosfile:${name}"><img src="cosfile:00000000-0000-0000-0000-000000000000.png"><img src="https://evil.example/x.png"><video src="cosfile:${name}" controls></video><p><a href="cosfile:${name}">file</a></p>`;
  const put = await api.put(`/api/projects/${p}/formulas/${f}/process`).send({ html });
  assert.match(put.body.html, new RegExp(`<img src="cosfile:${name}"`));
  assert.ok(!/evil\.example|000000000000/.test(put.body.html), 'riferimenti esterni/inesistenti rimossi');
  // accesso per nome
  const raw = await api.get(`/api/projects/${p}/files/n/${name}/raw`);
  assert.equal(raw.status, 200); assert.equal(raw.headers['content-type'], 'image/png');
  assert.equal((await api.get(`/api/projects/${p}/files/n/..%2F..%2Fx/raw`)).status, 400);
  // stampa: escaping, selezione, ids non validi
  const pr = await api.get(`/api/projects/${p}/print?ids=${f}&cover=1&toc=1`);
  assert.equal(pr.status, 200);
  assert.ok(pr.text.includes('Con &lt;b&gt;foto&lt;/b&gt;') && !pr.text.includes('<b>foto</b>') && !pr.text.includes('C<script>'));
  assert.ok(pr.text.includes(`/api/projects/${p}/files/n/${name}/raw`) && !pr.text.includes('cosfile:'));
  assert.match(pr.text, /Lista INCI/); assert.match(pr.text, /Aqua, Glycerin, Xyz Abc/);
  assert.equal((await api.get(`/api/projects/${p}/print?ids=1;drop`)).status, 400);
  const dlh = await api.get(`/api/projects/${p}/print?ids=all&download=1`);
  assert.match(dlh.headers['content-disposition'], /attachment/); assert.ok(dlh.text.includes('data:image/png;base64,')); assert.ok(!dlh.text.includes('print.js'));
  // export/import: i riferimenti seguono i nuovi nomi file
  const z = await request(app).get(`/api/projects/${p}/export?format=zip`).set('Host', H.Host).buffer().parse((res, cb) => { const c = []; res.on('data', d => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
  const imp = (await api.post('/api/import').attach('file', z.body, 'e.zip')).body.imported[0].slug;
  const nf = (await api.get(`/api/projects/${imp}/formulas`)).body[0];
  const got = (await api.get(`/api/projects/${imp}/formulas/${nf.id}`)).body;
  const newName = got.files[0].stored_name;
  assert.notEqual(newName, name);
  assert.ok(got.process_html.includes(`cosfile:${newName}`) && !got.process_html.includes(name));
  // import JSON (senza file): riferimenti orfani eliminati
  const j = await api.get(`/api/projects/${p}/export?format=json`);
  const imp2 = (await api.post('/api/import').attach('file', Buffer.from(j.text), 'e.json')).body.imported[0].slug;
  const g2 = (await api.get(`/api/projects/${imp2}/formulas/${(await api.get(`/api/projects/${imp2}/formulas`)).body[0].id}`)).body;
  assert.ok(!g2.process_html.includes('cosfile:') && !g2.process_html.includes('<img'));
  // eliminazione allegato → riferimenti rimossi dal processo
  assert.equal((await api.del(`/api/projects/${p}/files/${up.id}`)).status, 200);
  const after = (await api.get(`/api/projects/${p}/formulas/${f}`)).body.process_html;
  assert.ok(!after.includes('cosfile:') && !after.includes('<img') && after.includes('Passo 1'));
});

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

test('materie prime: SDS/TDS, collegamento ingredienti, PIF, stampa, backup v2', async () => {
  const p = (await api.post('/api/projects').send({ name: 'PIF' })).body.slug;
  const m = (await api.post(`/api/projects/${p}/materials`).send({ name: 'Glicerina <b>99</b>', inci: 'Glycerin', inci_status: 'verified', supplier: 'ACME', noael: 1000, noael_ref: 'SCCS', dermal_abs: 0.5, active_pct: 99.5, impurities: 'DEG < 0,1%' })).body;
  assert.equal(m.inci_status, 'verified'); assert.equal(m.active_pct, 99.5);
  assert.equal((await api.post(`/api/projects/${p}/materials`).send({ name: 'X', inci: 'Foo Bar', inci_status: 'verified' })).body.inci_status, 'unverified');
  // upload SDS/TDS con metadati
  const sds = await api.post(`/api/projects/${p}/materials/${m.id}/files`).field('doc_type', 'SDS').field('doc_date', '2025-03-01').field('revision', '4').field('language', 'it').attach('files', PDF, 'SDS glicerina.pdf');
  assert.equal(sds.status, 201); assert.equal(sds.body.created[0].doc_type, 'SDS'); assert.equal(sds.body.created[0].doc_date, '2025-03-01');
  assert.equal((await api.post(`/api/projects/${p}/materials/${m.id}/files`).field('doc_type', 'TDS').attach('files', Buffer.from('<html>'), 'tds.pdf')).status, 400);
  assert.equal((await api.post(`/api/projects/${p}/materials/${m.id}/files`).field('doc_type', 'TDS').field('doc_date', 'ieri; drop').attach('files', PDF, 'tds.pdf')).body.created[0].doc_date, '');
  assert.equal((await api.post(`/api/projects/${p}/materials/999/files`).attach('files', PDF, 'a.pdf')).status, 404);
  const patch = await api.patch(`/api/projects/${p}/files/${sds.body.created[0].id}`).send({ doc_type: 'COA', revision: '5' });
  assert.equal(patch.status, 200);
  await api.patch(`/api/projects/${p}/files/${sds.body.created[0].id}`).send({ doc_type: 'SDS' });
  const list = (await api.get(`/api/projects/${p}/materials`)).body;
  assert.equal(list[0].sds, 1); assert.equal(list[0].tds, 1);
  // formula collegata
  const f = (await api.post(`/api/projects/${p}/formulas`).send({ name: 'Crema', batch_g: 100 })).body.id;
  await api.put(`/api/projects/${p}/formulas/${f}`).send({ name: 'Crema', batch_g: 100, ingredients: [{ trade_name: 'Glicerina', inci: 'Glycerin', percent: 5, material_id: m.id }, { trade_name: 'Acqua', inci: 'Aqua', percent: 95, material_id: 9999 }] });
  const got = (await api.get(`/api/projects/${p}/formulas/${f}`)).body;
  assert.equal(got.ingredients[0].material_id, m.id); assert.equal(got.ingredients[1].material_id, null);
  assert.equal((await api.get(`/api/projects/${p}/materials/${m.id}`)).body.used_in.length, 1);
  // PIF
  let pif = (await api.get(`/api/projects/${p}/formulas/${f}/pif`)).body;
  assert.equal(pif.rows[0].sds.original_name, 'SDS glicerina.pdf'); assert.ok(pif.sectionDefs.length >= 18);
  const sv = await api.put(`/api/projects/${p}/formulas/${f}/pif/data`).send({ data: { product_name: 'Crema <i>X</i>', daily_amount_g: '1,54', retention_factor: 1, rp_name: 'Lab Srl', evil: 'x' } });
  assert.equal(sv.body.data.daily_amount_g, 1.54); assert.equal(sv.body.data.evil, undefined);
  const sec = await api.put(`/api/projects/${p}/formulas/${f}/pif/sections/a9`).send({ html: '<p>Nessun SUE</p><script>x</script><img src="https://e.com/a.png">' });
  assert.equal(sec.body.html, '<p>Nessun SUE</p>');
  assert.equal((await api.put(`/api/projects/${p}/formulas/${f}/pif/sections/__proto__`).send({ html: 'x' })).status, 400);
  // stampa PIF
  const pr = await api.get(`/api/projects/${p}/formulas/${f}/pif/print`);
  assert.equal(pr.status, 200);
  assert.ok(pr.text.includes('Crema &lt;i&gt;X&lt;/i&gt;') && !pr.text.includes('<i>X</i>'));
  assert.match(pr.text, /A\.8 Profilo tossicologico/); assert.match(pr.text, /conforme/); assert.match(pr.text, /SDS glicerina\.pdf/); assert.match(pr.text, /Nessun SUE/);
  assert.ok(pr.text.includes('non collegato') && pr.text.includes('✔ SDS glicerina.pdf'));
  // backup v2: materie prime, documenti, collegamenti e PIF
  const z = await request(app).get(`/api/projects/${p}/export?format=zip`).set('Host', H.Host).buffer().parse((res, cb) => { const c = []; res.on('data', d => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
  const ns = (await api.post('/api/import').attach('file', z.body, 'p.zip')).body.imported[0].slug;
  const nm = (await api.get(`/api/projects/${ns}/materials`)).body;
  assert.equal(nm.length, 2); const gl = nm.find(x => x.inci === 'Glycerin'); assert.equal(gl.sds, 1); assert.equal(gl.tds, 1);
  const nf = (await api.get(`/api/projects/${ns}/formulas`)).body[0];
  const ngot = (await api.get(`/api/projects/${ns}/formulas/${nf.id}`)).body;
  assert.equal(ngot.ingredients[0].material_id, gl.id);
  const npif = (await api.get(`/api/projects/${ns}/formulas/${nf.id}/pif`)).body;
  assert.equal(npif.data.rp_name, 'Lab Srl'); assert.equal(npif.sections.a9, '<p>Nessun SUE</p>');
  // eliminazione materia prima: scollega, rimuove i file
  assert.equal((await api.del(`/api/projects/${p}/materials/${m.id}`)).status, 200);
  assert.equal((await api.get(`/api/projects/${p}/formulas/${f}`)).body.ingredients[0].material_id, null);
});

test('migrazione di un DB v1 esistente', async () => {
  const Database = (await import('better-sqlite3')).default;
  const dir = path.join(tmp, 'projects', 'vecchio'); fs.mkdirSync(path.join(dir, 'uploads', '.tmp'), { recursive: true });
  const old = new Database(path.join(dir, 'project.db'));
  old.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE formulas (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT 'N', version TEXT NOT NULL DEFAULT '1.0', batch_g REAL, notes TEXT NOT NULL DEFAULT '', process_html TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE ingredients (id INTEGER PRIMARY KEY AUTOINCREMENT, formula_id INTEGER NOT NULL REFERENCES formulas(id) ON DELETE CASCADE, position INTEGER NOT NULL DEFAULT 0, trade_name TEXT NOT NULL DEFAULT '', inci TEXT NOT NULL DEFAULT '', inci_status TEXT NOT NULL DEFAULT 'none', cosing_ref TEXT NOT NULL DEFAULT '', phase TEXT NOT NULL DEFAULT '', function TEXT NOT NULL DEFAULT '', percent REAL, grams REAL, supplier TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '');
  CREATE TABLE files (id INTEGER PRIMARY KEY AUTOINCREMENT, formula_id INTEGER NOT NULL REFERENCES formulas(id) ON DELETE CASCADE, original_name TEXT NOT NULL, stored_name TEXT NOT NULL UNIQUE, mime TEXT NOT NULL, kind TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL, caption TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')));
  INSERT INTO meta VALUES('schema_version','1'),('project_name','Vecchio');
  INSERT INTO formulas(name) VALUES('Legacy'); INSERT INTO ingredients(formula_id,trade_name) VALUES(1,'Acqua');
  INSERT INTO files(formula_id,original_name,stored_name,mime,kind,size,sha256) VALUES(1,'a.png','11111111-1111-1111-1111-111111111111.png','image/png','image',3,'x');`);
  old.close();
  const fl = (await api.get('/api/projects/vecchio/formulas/1')).body;
  assert.equal(fl.name, 'Legacy'); assert.equal(fl.files.length, 1); assert.equal(fl.ingredients[0].material_id, null);
  assert.equal((await api.get('/api/projects/vecchio/materials')).status, 200);
});
