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

export const SCHEMA_VERSION = 2;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS formulas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT 'Nuova formula',
  version TEXT NOT NULL DEFAULT '1.0',
  batch_g REAL,
  notes TEXT NOT NULL DEFAULT '',
  process_html TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ingredients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  formula_id INTEGER NOT NULL REFERENCES formulas(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  trade_name TEXT NOT NULL DEFAULT '',
  inci TEXT NOT NULL DEFAULT '',
  inci_status TEXT NOT NULL DEFAULT 'none' CHECK (inci_status IN ('verified','unverified','none')),
  cosing_ref TEXT NOT NULL DEFAULT '',
  phase TEXT NOT NULL DEFAULT '',
  function TEXT NOT NULL DEFAULT '',
  percent REAL,
  grams REAL,
  supplier TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_ing_formula ON ingredients(formula_id, position);
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  formula_id INTEGER NOT NULL REFERENCES formulas(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL UNIQUE,
  mime TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image','video','doc','data')),
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_files_formula ON files(formula_id);
`;

const V2 = `
CREATE TABLE materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT 'Nuova materia prima',
  inci TEXT NOT NULL DEFAULT '',
  inci_status TEXT NOT NULL DEFAULT 'none' CHECK (inci_status IN ('verified','unverified','none')),
  cosing_ref TEXT NOT NULL DEFAULT '',
  cas TEXT NOT NULL DEFAULT '', ec TEXT NOT NULL DEFAULT '',
  supplier TEXT NOT NULL DEFAULT '', supplier_code TEXT NOT NULL DEFAULT '',
  function TEXT NOT NULL DEFAULT '',
  active_pct REAL NOT NULL DEFAULT 100,
  use_level_max REAL,
  appearance TEXT NOT NULL DEFAULT '', ph TEXT NOT NULL DEFAULT '', density TEXT NOT NULL DEFAULT '',
  hazard TEXT NOT NULL DEFAULT '',
  noael REAL, noael_ref TEXT NOT NULL DEFAULT '', dermal_abs REAL,
  allergens TEXT NOT NULL DEFAULT '', impurities TEXT NOT NULL DEFAULT '',
  tds_notes TEXT NOT NULL DEFAULT '', sds_notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE files_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  formula_id INTEGER REFERENCES formulas(id) ON DELETE CASCADE,
  material_id INTEGER REFERENCES materials(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL DEFAULT '' CHECK (doc_type IN ('','SDS','TDS','COA','OTHER')),
  doc_date TEXT NOT NULL DEFAULT '', revision TEXT NOT NULL DEFAULT '', language TEXT NOT NULL DEFAULT '',
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL UNIQUE,
  mime TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image','video','doc','data')),
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((formula_id IS NOT NULL) + (material_id IS NOT NULL) = 1)
);
INSERT INTO files_v2(id,formula_id,original_name,stored_name,mime,kind,size,sha256,caption,created_at)
  SELECT id,formula_id,original_name,stored_name,mime,kind,size,sha256,caption,created_at FROM files;
DROP TABLE files;
ALTER TABLE files_v2 RENAME TO files;
CREATE INDEX ix_files_formula ON files(formula_id);
CREATE INDEX ix_files_material ON files(material_id);
ALTER TABLE ingredients ADD COLUMN material_id INTEGER REFERENCES materials(id) ON DELETE SET NULL;
CREATE TABLE pif (
  formula_id INTEGER PRIMARY KEY REFERENCES formulas(id) ON DELETE CASCADE,
  data TEXT NOT NULL DEFAULT '{}',
  sections TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

function migrate(db) {
  const v = Number(db.prepare("SELECT value FROM meta WHERE key='schema_version'").get()?.value || 1);
  if (v < 2) db.transaction(() => { db.exec(V2); db.prepare("UPDATE meta SET value='2' WHERE key='schema_version'").run(); })();
}

export function openDb(file, name) {
  const db = new Database(file);
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  if (!db.prepare("SELECT value FROM meta WHERE key='schema_version'").get()) {
    db.prepare("INSERT INTO meta(key,value) VALUES('schema_version','1')").run();
    db.prepare("INSERT INTO meta(key,value) VALUES('project_name',?)").run(name || 'Progetto');
  }
  migrate(db);
  return db;
}

export function projectName(db) {
  return db.prepare("SELECT value FROM meta WHERE key='project_name'").get()?.value ?? 'Progetto';
}
