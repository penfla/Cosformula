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

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cosf-setup-'));
process.env.COSFORMULA_DATA = tmp;
const { createApp } = await import('../server/index.js');
const { closeAll } = await import('../server/projects.js');
const app = createApp({ port: 3000 });
const H = { Host: 'localhost:3000', Origin: 'http://localhost:3000' };
after(() => { closeAll(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('primo avvio: setup crea DB, dataset di esempio e formula', async () => {
  let s = (await request(app).get('/api/setup/status').set('Host', H.Host)).body;
  assert.equal(s.initialized, false); assert.equal(s.inci.loaded, false);
  const r = await request(app).post('/api/setup').set(H).send({ projectName: 'Lab 1', dataset: 'seed', example: true });
  assert.equal(r.status, 201); assert.equal(r.body.slug, 'lab-1');
  s = (await request(app).get('/api/setup/status').set('Host', H.Host)).body;
  assert.equal(s.initialized, true); assert.ok(s.inci.count > 100);
  assert.ok(fs.existsSync(path.join(tmp, 'projects', 'lab-1', 'project.db')));
  const fl = (await request(app).get('/api/projects/lab-1/formulas').set('Host', H.Host)).body;
  assert.equal(fl.length, 1);
  const f = (await request(app).get(`/api/projects/lab-1/formulas/${fl[0].id}`).set('Host', H.Host)).body;
  const tot = f.ingredients.reduce((a, i) => a + i.percent, 0);
  assert.ok(Math.abs(tot - 100) < 0.01, 'esempio somma 100%');
  assert.ok(f.ingredients.some(i => i.inci_status === 'verified') && f.ingredients.some(i => i.inci_status === 'none'));
  // secondo setup rifiutato
  assert.equal((await request(app).post('/api/setup').set(H).send({ projectName: 'X' })).status, 409);
});

test('upload dataset CosIng da UI: valida e sostituisce', async () => {
  const bad = await request(app).post('/api/inci/dataset').set(H).attach('file', Buffer.from('a,b\n1,2\n'), 'x.csv');
  assert.equal(bad.status, 400);
  const csv = 'Preambolo\nAltro\n"COSING Ref No","INCI name","CAS No","EC No","Function","Restriction"\n"1","Test Ingredient One","1-2-3","","SOLVENT",""\n"2","Test Ingredient Two","","","EMOLLIENT",""\n';
  const ok = await request(app).post('/api/inci/dataset').set(H).attach('file', Buffer.from(csv), 'cosing.csv');
  assert.equal(ok.status, 200); assert.equal(ok.body.imported, 2);
  const v = (await request(app).get('/api/inci/verify?name=test ingredient one').set('Host', H.Host)).body;
  assert.equal(v.verdict, 'verified'); assert.equal(v.match.ref, '1');
  assert.equal((await request(app).get('/api/inci/verify?name=Glycerin').set('Host', H.Host)).body.verdict, 'not_found');
});
