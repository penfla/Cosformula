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

// Uso: node scripts/import-cosing.js <file.csv> [--label "CosIng export YYYY-MM-DD"]
// Fonte ufficiale: https://data.europa.eu/data/datasets/cosmetic-ingredient-database-ingredients-and-fragrance-inventory
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { parse } from 'csv-parse/sync';
import { COSING_DB, createCosingSchema } from '../server/inci/cosing.js';

const file = process.argv[2];
if (!file) { console.error('Uso: npm run import-cosing -- <file.csv>'); process.exit(1); }
const label = process.argv.includes('--label') ? process.argv[process.argv.indexOf('--label') + 1] : '';
let text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
// Il CSV ufficiale ha righe di preambolo prima dell'intestazione.
const lines = text.split(/\r?\n/);
const h = lines.findIndex(l => /inci name/i.test(l) && /cosing ref/i.test(l));
if (h < 0) { console.error('Intestazione "COSING Ref No / INCI name" non trovata'); process.exit(1); }
const rows = parse(lines.slice(h).join('\n'), { columns: hd => hd.map(x => x.trim().toLowerCase()), relax_quotes: true, relax_column_count: true, skip_empty_lines: true });
const pick = (r, ...keys) => { for (const k of Object.keys(r)) if (keys.some(x => k.includes(x))) return (r[k] || '').trim(); return ''; };

fs.mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
fs.rmSync(COSING_DB, { force: true });
const db = new Database(COSING_DB);
createCosingSchema(db);
const ins = db.prepare('INSERT INTO cosing(ref,inci_name,cas,ec,functions,restriction,source) VALUES(?,?,?,?,?,?,?)');
let n = 0;
db.transaction(() => {
  for (const r of rows) {
    const inci = pick(r, 'inci name');
    if (!inci) continue;
    ins.run(pick(r, 'cosing ref'), inci, pick(r, 'cas'), pick(r, 'ec no'), pick(r, 'function'), pick(r, 'restriction'), 'CosIng');
    n++;
  }
  db.exec("INSERT INTO cosing_fts(rowid, inci_name) SELECT rowid, inci_name FROM cosing");
  db.prepare("INSERT INTO info VALUES('label',?)").run(label || file.split('/').pop());
  db.prepare("INSERT INTO info VALUES('imported_at',?)").run(new Date().toISOString());
})();
console.log(`Importate ${n} voci in ${COSING_DB}`);
