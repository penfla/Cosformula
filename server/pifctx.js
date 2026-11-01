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

import { exact } from './inci/cosing.js';
import { httpError, str, num, cleanHtml } from './security.js';

// Contenuto del PIF secondo Reg. (CE) 1223/2009, art. 11 e Allegato I (relazione sulla sicurezza, parti A e B).
// https://eur-lex.europa.eu/eli/reg/2009/1223/oj
export const SECTIONS = [
  { key: 'descr', group: 'Art. 11(2)(a)', title: 'Descrizione del prodotto cosmetico', hint: 'Descrizione che consenta di collegare in modo univoco il PIF al prodotto (nome, codice, forma, categoria, funzione).' },
  { key: 'a1', group: 'Parte A', title: 'A.1 Composizione quali-quantitativa', hint: 'Identità chimica delle sostanze (nome chimico, INCI, CAS, EINECS/ELINCS dove possibile) e funzione. Per profumi/aromi: nome, codice e fornitore della composizione.' },
  { key: 'a2', group: 'Parte A', title: 'A.2 Caratteristiche fisiche/chimiche e stabilità', hint: 'Caratteristiche fisico-chimiche di sostanze/miscele e prodotto finito; stabilità in condizioni di conservazione ragionevolmente prevedibili.' },
  { key: 'a3', group: 'Parte A', title: 'A.3 Qualità microbiologica', hint: 'Specifiche microbiologiche di materie prime e prodotto finito; challenge test; attenzione a prodotti per occhi, mucose, cute lesa, bambini < 3 anni, anziani, immunodepressi.' },
  { key: 'a4', group: 'Parte A', title: 'A.4 Impurezze, tracce, materiale di imballaggio', hint: 'Purezza di sostanze e miscele; tracce di sostanze vietate e prova dell’inevitabilità tecnica; caratteristiche rilevanti dell’imballaggio (purezza, stabilità, interazioni).' },
  { key: 'a5', group: 'Parte A', title: 'A.5 Uso normale e ragionevolmente prevedibile', hint: 'Uso normale e prevedibile, incluso un uso scorretto ragionevolmente prevedibile; popolazione target; avvertenze.' },
  { key: 'a6', group: 'Parte A', title: 'A.6 Esposizione al prodotto cosmetico', hint: 'Sito di applicazione, superficie, quantità, durata e frequenza, vie di esposizione, popolazione target (parametri nella tabella sopra).' },
  { key: 'a7', group: 'Parte A', title: 'A.7 Esposizione alle sostanze', hint: 'Esposizione sistemica alle sostanze (SED) calcolata dai dati di A.6 e dalla concentrazione.' },
  { key: 'a8', group: 'Parte A', title: 'A.8 Profilo tossicologico delle sostanze', hint: 'Endpoint tossicologici: tossicità locale, sensibilizzazione, assorbimento cutaneo, dose ripetuta, mutagenicità/genotossicità, cancerogenicità, tossicità riproduttiva, fototossicità, tossicocinetica, dati umani; pareri SCCS.' },
  { key: 'a9', group: 'Parte A', title: 'A.9 Effetti indesiderabili e gravi', hint: 'Dati sugli effetti indesiderabili e indesiderabili gravi (SUE) del prodotto o di prodotti analoghi, anche statistici.' },
  { key: 'a10', group: 'Parte A', title: 'A.10 Altre informazioni', hint: 'Altre informazioni pertinenti: studi su volontari, sorveglianza del mercato di prodotti analoghi.' },
  { key: 'b1', group: 'Parte B', title: 'B.1 Conclusione della valutazione', hint: 'Dichiarazione di sicurezza del prodotto in relazione all’art. 3 del Regolamento.' },
  { key: 'b2', group: 'Parte B', title: 'B.2 Avvertenze e istruzioni d’uso in etichetta', hint: 'Avvertenze e istruzioni d’uso riportate in etichetta (art. 19(1)(d); Allegati III–VI).' },
  { key: 'b3', group: 'Parte B', title: 'B.3 Ragionamento', hint: 'Ragionamento scientifico che porta alla conclusione: pericoli identificati, margini di sicurezza, impurezze, pareri SCCS.' },
  { key: 'b4', group: 'Parte B', title: 'B.4 Credenziali del valutatore e approvazione della Parte B', hint: 'Nome e indirizzo del valutatore della sicurezza, prova della qualifica (art. 10(2)), data e firma.' },
  { key: 'gmp', group: 'Art. 11(2)(c)', title: 'Metodo di fabbricazione e conformità alle GMP', hint: 'Descrizione del metodo di fabbricazione e dichiarazione di conformità alle buone pratiche di fabbricazione (art. 8, es. UNI EN ISO 22716).' },
  { key: 'claims', group: 'Art. 11(2)(d)', title: 'Prova degli effetti dichiarati', hint: 'Dove giustificato dalla natura del prodotto: prove a sostegno dei claim (art. 20; Reg. UE 655/2013).' },
  { key: 'animal', group: 'Art. 11(2)(e)', title: 'Dati su sperimentazione animale', hint: 'Dati su test su animali eseguiti dal fabbricante, agenti o fornitori, anche per requisiti di paesi terzi (art. 18).' },
];
export const SECTION_KEYS = new Set(SECTIONS.map(s => s.key));

const TEXT = { product_name: 200, category: 100, form: 100, target_population: 200, site_of_application: 200, intended_use: 1000, packaging: 500,
  shelf_life: 100, pao: 50, rp_name: 200, rp_address: 500, manuf_name: 200, manuf_address: 500, gmp_standard: 200, assessor_name: 200,
  assessor_address: 500, assessor_qualification: 500, assessment_date: 20, pif_version: 20, pif_status: 20, cpnp_ref: 100, batch_ref: 100, preset: 40 };
const NUM = ['frequency_per_day', 'amount_per_application_g', 'daily_amount_g', 'retention_factor', 'body_weight_kg'];

export function cleanPifData(d = {}) {
  const o = {};
  for (const [k, max] of Object.entries(TEXT)) o[k] = str(d[k], max);
  for (const k of NUM) o[k] = num(d[k]);
  return o;
}

const parse = (t, fb) => { try { const v = JSON.parse(t); return v && typeof v === 'object' ? v : fb; } catch { return fb; } };

/** Dati del PIF + dati live della scheda formula (ingredienti con materia prima, SDS/TDS, CosIng). */
export function buildContext(db, fid) {
  const f = db.prepare('SELECT * FROM formulas WHERE id=?').get(fid);
  if (!f) throw httpError(404, 'Formula non trovata');
  const mats = new Map(db.prepare('SELECT * FROM materials').all().map(m => [m.id, m]));
  const docs = db.prepare("SELECT id,material_id,doc_type,doc_date,revision,language,original_name,stored_name FROM files WHERE material_id IS NOT NULL AND doc_type IN ('SDS','TDS') ORDER BY doc_date DESC, id DESC").all();
  const rows = db.prepare('SELECT * FROM ingredients WHERE formula_id=? ORDER BY position,id').all(fid).map(i => {
    const m = i.material_id ? mats.get(i.material_id) || null : null;
    const own = docs.filter(d => d.material_id === i.material_id);
    return { id: i.id, phase: i.phase, trade_name: i.trade_name, inci: i.inci, inci_status: i.inci_status, function: i.function, percent: i.percent, grams: i.grams, supplier: i.supplier,
      material_id: i.material_id, material: m, sds: own.find(d => d.doc_type === 'SDS') || null, tds: own.find(d => d.doc_type === 'TDS') || null,
      cosing: i.inci ? (({ ref, inci_name, cas, ec, functions, restriction }) => ({ ref, inci_name, cas, ec, functions, restriction }))(exact(i.inci) || {}) : null };
  });
  const p = db.prepare('SELECT * FROM pif WHERE formula_id=?').get(fid);
  const data = { ...cleanPifData({}), ...parse(p?.data, {}) };
  const sections = parse(p?.sections, {});
  return { formula: { id: f.id, code: f.code, name: f.name, version: f.version, batch_g: f.batch_g, notes: f.notes, process_html: f.process_html, updated_at: f.updated_at },
    rows, data, sections, updated_at: p?.updated_at || null };
}

export function savePifData(db, fid, d) {
  if (!db.prepare('SELECT 1 FROM formulas WHERE id=?').get(fid)) throw httpError(404, 'Formula non trovata');
  db.prepare("INSERT INTO pif(formula_id,data) VALUES(?,?) ON CONFLICT(formula_id) DO UPDATE SET data=excluded.data, updated_at=datetime('now')").run(fid, JSON.stringify(cleanPifData(d)));
}
export function savePifSection(db, fid, key, html) {
  if (!SECTION_KEYS.has(key)) throw httpError(400, 'Sezione non valida');
  if (!db.prepare('SELECT 1 FROM formulas WHERE id=?').get(fid)) throw httpError(404, 'Formula non trovata');
  const allowed = new Set(db.prepare('SELECT stored_name FROM files').all().map(r => r.stored_name));
  const clean = cleanHtml(html, allowed);
  const cur = parse(db.prepare('SELECT sections FROM pif WHERE formula_id=?').get(fid)?.sections, {});
  cur[key] = clean;
  db.prepare("INSERT INTO pif(formula_id,sections) VALUES(?,?) ON CONFLICT(formula_id) DO UPDATE SET sections=excluded.sections, updated_at=datetime('now')").run(fid, JSON.stringify(cur));
  return clean;
}
