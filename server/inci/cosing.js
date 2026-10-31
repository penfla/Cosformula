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

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../projects.js';

export const COSING_DB = path.join(DATA_DIR, 'cosing.db');
export const COSING_LINKS = {
  portal: 'https://single-market-economy.ec.europa.eu/sectors/cosmetics/cosmetic-ingredient-database_en',
  search: 'https://ec.europa.eu/growth/tools-databases/cosing/',
  dataset: 'https://data.europa.eu/data/datasets/cosmetic-ingredient-database-ingredients-and-fragrance-inventory',
  regulation: 'https://eur-lex.europa.eu/eli/reg/2009/1223/oj',
};

let db = null;
export function cosingDb() {
  if (db) return db;
  if (!fs.existsSync(COSING_DB)) return null;
  db = new Database(COSING_DB, { readonly: true });
  return db;
}
export function resetCosingDb() { db?.close(); db = null; }

export function createCosingSchema(d) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS cosing(ref TEXT, inci_name TEXT NOT NULL, cas TEXT, ec TEXT, functions TEXT, restriction TEXT, source TEXT);
    CREATE INDEX IF NOT EXISTS ix_cosing_name ON cosing(inci_name COLLATE NOCASE);
    CREATE VIRTUAL TABLE IF NOT EXISTS cosing_fts USING fts5(inci_name, content='cosing', content_rowid='rowid', tokenize='unicode61');
    CREATE TABLE IF NOT EXISTS info(key TEXT PRIMARY KEY, value TEXT);
  `);
}

function ftsQuery(q) {
  const toks = q.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  return toks.slice(0, 6).map(t => `"${t}"*`).join(' ');
}

export function status() {
  const d = cosingDb();
  if (!d) return { loaded: false, count: 0, links: COSING_LINKS };
  const count = d.prepare('SELECT COUNT(*) n FROM cosing').get().n;
  const info = Object.fromEntries(d.prepare('SELECT key,value FROM info').all().map(r => [r.key, r.value]));
  return { loaded: true, count, ...info, links: COSING_LINKS };
}

export function search(q, limit = 15) {
  const d = cosingDb();
  q = String(q || '').trim().slice(0, 100);
  if (!d || q.length < 2) return [];
  const fq = ftsQuery(q);
  if (!fq) return [];
  return d.prepare(`SELECT c.ref, c.inci_name, c.cas, c.ec, c.functions, c.restriction,
      CASE WHEN lower(c.inci_name)=lower(?) THEN 0 WHEN lower(c.inci_name) LIKE lower(?)||'%' THEN 1 ELSE 2 END rank
    FROM cosing_fts f JOIN cosing c ON c.rowid=f.rowid WHERE cosing_fts MATCH ? ORDER BY rank, length(c.inci_name) LIMIT ?`)
    .all(q, q.replace(/[%_]/g, ''), fq, limit);
}

/** Exact (case-insensitive) match of an INCI name in the official dataset. */
export function exact(name) {
  const d = cosingDb();
  if (!d) return null;
  return d.prepare('SELECT ref,inci_name,cas,ec,functions,restriction FROM cosing WHERE inci_name = ? COLLATE NOCASE LIMIT 1')
    .get(String(name || '').trim().slice(0, 300)) || null;
}

/**
 * Optional live lookup. The official CosIng REST endpoint is not documented as a stable public API,
 * therefore it must be configured explicitly (COSING_LIVE_URL, e.g. "https://host/path?text={q}").
 * Only the configured https host is contacted; the user input is URL-encoded into the template.
 */
export async function live(name) {
  const tpl = process.env.COSING_LIVE_URL;
  if (!tpl) return { available: false, reason: 'COSING_LIVE_URL non configurato' };
  let url;
  try {
    url = new URL(tpl.replace('{q}', encodeURIComponent(name)));
    if (url.protocol !== 'https:') throw new Error('solo https');
  } catch (e) { return { available: false, reason: `COSING_LIVE_URL non valido: ${e.message}` }; }
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: 'error', headers: { accept: 'application/json' } });
    if (!r.ok) return { available: false, reason: `HTTP ${r.status}` };
    const text = (await r.text()).slice(0, 2_000_000);
    return { available: true, found: text.toLowerCase().includes(String(name).toLowerCase()), host: url.host };
  } catch (e) { return { available: false, reason: e.message }; }
}

export function verify(name) {
  const ex = exact(name);
  const hits = ex ? [] : search(name, 5);
  const q = encodeURIComponent(name);
  return {
    query: name,
    dataset: status(),
    match: ex,
    suggestions: hits,
    verdict: ex ? 'verified' : hits.length ? 'similar' : cosingDb() ? 'not_found' : 'dataset_missing',
    links: { ...COSING_LINKS, search_url: `${COSING_LINKS.search}#/search?text=${q}` },
  };
}
