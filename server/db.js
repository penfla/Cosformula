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

export const SCHEMA_VERSION = 1;

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

export function openDb(file, name) {
  const db = new Database(file);
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  const has = db.prepare("SELECT value FROM meta WHERE key='schema_version'").get();
  if (!has) {
    db.prepare("INSERT INTO meta(key,value) VALUES('schema_version',?)").run(String(SCHEMA_VERSION));
    db.prepare("INSERT INTO meta(key,value) VALUES('project_name',?)").run(name || 'Progetto');
  }
  return db;
}

export function projectName(db) {
  return db.prepare("SELECT value FROM meta WHERE key='project_name'").get()?.value ?? 'Progetto';
}
