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
import { DATA_DIR, listProjects, createProject, getDb } from './projects.js';
import { COSING_DB } from './inci/cosing.js';

const CONFIG = path.join(DATA_DIR, 'config.json');

export function readConfig() { try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch { return {}; } }
export function isInitialized() { return !!readConfig().initialized || listProjects().length > 0; }
export function markInitialized(extra = {}) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CONFIG, JSON.stringify({ ...readConfig(), initialized: true, created_at: new Date().toISOString(), ...extra }, null, 2));
}
export const datasetPresent = () => fs.existsSync(COSING_DB);
export { createProject, getDb };
