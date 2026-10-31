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

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { parse } from 'csv-parse/sync';
import { COSING_DB, createCosingSchema, resetCosingDb } from './cosing.js';
import { httpError } from '../security.js';

export const SEED_CSV = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'cosing-seed.csv');
export const SEED_LABEL = 'SEED-MINIMALE (non ufficiale)';

const pick = (r, ...keys) => { for (const k of Object.keys(r)) if (keys.some(x => k.includes(x))) return (r[k] || '').trim(); return ''; };

/** Importa il CSV CosIng (UE) in data/cosing.db, sostituendo il dataset precedente in modo atomico. */
export function importCosingCsv(buf, label = '') {
  let text = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf);
  if (text.includes('\uFFFD') && Buffer.isBuffer(buf)) text = buf.toString('latin1');
  text = text.replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/);
  // Il CSV ufficiale ha righe di preambolo prima dell'intestazione.
  const h = lines.findIndex(l => /inci name/i.test(l) && /cosing ref/i.test(l));
  if (h < 0) throw httpError(400, 'Intestazione "COSING Ref No / INCI name" non trovata: file non riconosciuto');
  let rows;
  try { rows = parse(lines.slice(h).join('\n'), { columns: hd => hd.map(x => x.trim().toLowerCase()), relax_quotes: true, relax_column_count: true, skip_empty_lines: true }); }
  catch { throw httpError(400, 'CSV non valido'); }
  fs.mkdirSync(path.dirname(COSING_DB), { recursive: true });
  const tmp = COSING_DB + '.tmp';
  fs.rmSync(tmp, { force: true });
  const db = new Database(tmp);
  let n = 0;
  try {
    createCosingSchema(db);
    const ins = db.prepare('INSERT INTO cosing(ref,inci_name,cas,ec,functions,restriction,source) VALUES(?,?,?,?,?,?,?)');
    db.transaction(() => {
      for (const r of rows) {
        const inci = pick(r, 'inci name');
        if (!inci) continue;
        ins.run(pick(r, 'cosing ref'), inci.slice(0, 300), pick(r, 'cas').slice(0, 200), pick(r, 'ec no').slice(0, 200), pick(r, 'function').slice(0, 500), pick(r, 'restriction').slice(0, 2000), 'CosIng');
        n++;
      }
      if (!n) throw httpError(400, 'Nessuna voce INCI trovata');
      db.exec('INSERT INTO cosing_fts(rowid, inci_name) SELECT rowid, inci_name FROM cosing');
      db.prepare("INSERT INTO info VALUES('label',?)").run(String(label).slice(0, 100));
      db.prepare("INSERT INTO info VALUES('imported_at',?)").run(new Date().toISOString());
    })();
  } catch (e) { db.close(); fs.rmSync(tmp, { force: true }); throw e; }
  db.close();
  resetCosingDb();
  fs.renameSync(tmp, COSING_DB);
  return n;
}

export const loadSeed = () => importCosingCsv(fs.readFileSync(SEED_CSV), SEED_LABEL);
