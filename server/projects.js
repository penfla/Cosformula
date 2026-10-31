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
import { openDb, projectName } from './db.js';
import { SLUG_RE, slugify, str, httpError } from './security.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.COSFORMULA_DATA || path.join(here, '..', 'data');
export const PROJECTS_DIR = path.join(DATA_DIR, 'projects');
fs.mkdirSync(PROJECTS_DIR, { recursive: true });

const cache = new Map();

export function projectDir(slug) {
  if (!SLUG_RE.test(slug)) throw httpError(400, 'Progetto non valido');
  return path.join(PROJECTS_DIR, slug);
}
export function uploadsDir(slug) { return path.join(projectDir(slug), 'uploads'); }

export function getDb(slug) {
  const dir = projectDir(slug);
  const file = path.join(dir, 'project.db');
  if (!fs.existsSync(file)) throw httpError(404, 'Progetto non trovato');
  if (!cache.has(slug)) cache.set(slug, openDb(file));
  return cache.get(slug);
}

export function listProjects() {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
  return fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && SLUG_RE.test(d.name) && fs.existsSync(path.join(PROJECTS_DIR, d.name, 'project.db')))
    .map(d => {
      const db = getDb(d.name);
      const c = db.prepare('SELECT COUNT(*) n, MAX(updated_at) u FROM formulas').get();
      return { slug: d.name, name: projectName(db), formulas: c.n, updated_at: c.u };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function createProject(name) {
  name = str(name, 100) || 'Nuovo progetto';
  const base = slugify(name);
  let slug = base, i = 2;
  while (fs.existsSync(path.join(PROJECTS_DIR, slug))) slug = `${base.slice(0, 55)}-${i++}`;
  const dir = projectDir(slug);
  fs.mkdirSync(path.join(dir, 'uploads', '.tmp'), { recursive: true });
  cache.set(slug, openDb(path.join(dir, 'project.db'), name));
  return { slug, name };
}

export function renameProject(slug, name) {
  const db = getDb(slug);
  db.prepare("UPDATE meta SET value=? WHERE key='project_name'").run(str(name, 100) || 'Progetto');
}

export function deleteProject(slug) {
  const dir = projectDir(slug);
  getDb(slug).close();
  cache.delete(slug);
  fs.rmSync(dir, { recursive: true, force: true });
}

export function closeAll() { for (const d of cache.values()) d.close(); cache.clear(); }
