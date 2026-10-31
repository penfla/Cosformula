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
// (in alternativa: pulsante "Carica dataset CosIng" nell'interfaccia web)
import fs from 'node:fs';
import { importCosingCsv } from '../server/inci/importer.js';
import { COSING_DB } from '../server/inci/cosing.js';

const file = process.argv[2];
if (!file) { console.error('Uso: npm run import-cosing -- <file.csv>'); process.exit(1); }
const label = process.argv.includes('--label') ? process.argv[process.argv.indexOf('--label') + 1] : file.split('/').pop();
try { console.log(`Importate ${importCosingCsv(fs.readFileSync(file), label)} voci in ${COSING_DB}`); }
catch (e) { console.error(e.message); process.exit(1); }
