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

import { Router } from 'express';
import { isInitialized, markInitialized, createProject, getDb } from '../setup.js';
import { status as cosingStatus, exact } from '../inci/cosing.js';
import { loadSeed } from '../inci/importer.js';
import { writeIngredients } from './formulas.js';
import { str, httpError } from '../security.js';
import { listProjects } from '../projects.js';

export const router = Router();

router.get('/status', (_req, res) => res.json({ initialized: isInitialized(), projects: listProjects().length, inci: cosingStatus() }));

// Formula didattica: valori indicativi, NON validati.
const EXAMPLE = [
  ['A', 'Acqua demineralizzata', 'Aqua', 74.1], ['A', 'Glicerina vegetale', 'Glycerin', 4], ['A', 'Gomma xantano', 'Xanthan Gum', 0.3],
  ['B', 'Trigliceridi caprico/caprilici', 'Caprylic/Capric Triglyceride', 8], ['B', 'Burro di karité', 'Butyrospermum Parkii Butter', 4],
  ['B', 'Alcol cetostearilico', 'Cetearyl Alcohol', 4], ['B', 'Gliceril stearato', 'Glyceryl Stearate', 4],
  ['C', 'Tocoferolo', 'Tocopherol', 0.5], ['C', 'Fenossietanolo + etilesilglicerina', '', 1.0], ['C', 'Acido citrico (aggiust. pH)', 'Citric Acid', 0.1],
];

router.post('/', (req, res) => {
  if (isInitialized()) throw httpError(409, 'Database già inizializzato');
  const b = req.body || {};
  const proj = createProject(str(b.projectName, 100) || 'Le mie formulazioni');
  if (b.dataset === 'seed') { if (!cosingStatus().loaded) loadSeed(); }
  if (b.example) {
    const db = getDb(proj.slug);
    const id = db.prepare('INSERT INTO formulas(code,name,version,batch_g,notes,process_html) VALUES(?,?,?,?,?,?)')
      .run('ESEMPIO-01', 'Crema idratante O/A (esempio didattico)', '1.0', 200,
        'Esempio di compilazione: valori indicativi non validati. Eliminare o modificare.',
        '<h3>Processo</h3><ol><li data-list="ordered">Scaldare la fase A a 75 °C sotto agitazione.</li><li data-list="ordered">Scaldare la fase B a 75 °C fino a fusione completa.</li><li data-list="ordered">Emulsionare B in A con omogeneizzatore per 3 min.</li><li data-list="ordered">Raffreddare sotto agitazione; sotto 40 °C aggiungere la fase C.</li><li data-list="ordered">Verificare e correggere il pH.</li></ol>').lastInsertRowid;
    writeIngredients(db, id, EXAMPLE.map(([phase, trade_name, inci, percent]) => ({
      phase, trade_name, inci, inci_status: inci && exact(inci) ? 'verified' : inci ? 'unverified' : 'none', percent, grams: Math.round(percent * 2 * 1000) / 1000 })));
  }
  markInitialized({ first_project: proj.slug });
  res.status(201).json(proj);
});
