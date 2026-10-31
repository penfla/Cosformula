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
