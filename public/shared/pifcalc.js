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

// Calcoli di esposizione/sicurezza per il PIF (condivisi tra server e browser).
// Riferimento metodologico: SCCS Notes of Guidance (SCCS/1647/22, 12th revision) — verificare i valori sul documento originale.
// https://health.ec.europa.eu/publications/sccs-notes-guidance-testing-cosmetic-ingredients-and-their-safety-evaluation-12th-revision_en

export const BW_DEFAULT = 60; // kg, default SCCS
export const MOS_MIN = 100;   // soglia di accettabilità tipica (SCCS)

/** Valori di default per categoria (SCCS NoG, tabelle di esposizione) — da verificare sul documento originale. */
export const PRESETS = [
  { id: 'face_cream', label: 'Crema viso', daily_g: 1.54, rf: 1 },
  { id: 'body_lotion', label: 'Lozione corpo', daily_g: 7.82, rf: 1 },
  { id: 'hand_cream', label: 'Crema mani', daily_g: 2.16, rf: 1 },
  { id: 'shampoo', label: 'Shampoo (risciacquo)', daily_g: 10.46, rf: 0.01 },
  { id: 'shower_gel', label: 'Gel doccia (risciacquo)', daily_g: 18.67, rf: 0.01 },
  { id: 'conditioner', label: 'Balsamo capelli (risciacquo)', daily_g: 3.92, rf: 0.01 },
  { id: 'lipstick', label: 'Rossetto', daily_g: 0.057, rf: 1 },
  { id: 'toothpaste', label: 'Dentifricio', daily_g: 2.75, rf: 0.05 },
];

const n = v => { if (v === '' || v == null) return null; const x = Number(String(v).replace(',', '.')); return Number.isFinite(x) ? x : null; };

/** Quantità giornaliera di prodotto (g/giorno): valore manuale, altrimenti quantità per applicazione × frequenza. */
export function dailyAmount(d = {}) {
  const manual = n(d.daily_amount_g);
  if (manual != null) return manual;
  const a = n(d.amount_per_application_g), f = n(d.frequency_per_day);
  return a != null && f != null ? a * f : null;
}

/** Esposizione al prodotto A (mg/kg pc/giorno) = g/giorno × 1000 × RF / peso corporeo. */
export function productExposure(d = {}) {
  const g = dailyAmount(d); if (g == null) return null;
  const rf = n(d.retention_factor) ?? 1, bw = n(d.body_weight_kg) || BW_DEFAULT;
  return (g * 1000 * rf) / bw;
}

/** SED (mg/kg pc/giorno) = A × (C/100) × (DA/100). C = % sostanza nel prodotto, DA = assorbimento dermico % (default 100 = caso peggiore). */
export const sed = (A, concPct, absPct) => (A == null || concPct == null ? null : A * (concPct / 100) * ((absPct ?? 100) / 100));
export const mos = (noael, s) => (noael == null || s == null || s <= 0 ? null : noael / s);

/** Concentrazione % dell'ingrediente nel prodotto (percent, oppure grammi/batch). */
export function ingredientPercent(i, batch) {
  if (i.percent != null) return i.percent;
  return i.grams != null && batch ? (i.grams / batch) * 100 : null;
}

/** Righe tossicologiche: una per ingrediente con INCI/materia prima. rows = ingredienti con `material` (opzionale). */
export function toxRows(rows, data = {}, batch = null) {
  const A = productExposure(data);
  return rows.map(r => {
    const m = r.material || {};
    const pct = ingredientPercent(r, batch);
    const conc = pct == null ? null : pct * ((m.active_pct ?? 100) / 100);
    const abs = m.dermal_abs ?? null;
    const s = sed(A, conc, abs);
    const k = mos(m.noael ?? null, s);
    const status = m.noael == null ? 'nodata' : k == null ? 'nocalc' : k >= MOS_MIN ? 'ok' : 'low';
    return { name: r.trade_name || r.inci || '—', inci: r.inci || '', conc, noael: m.noael ?? null, noael_ref: m.noael_ref || '', abs, sed: s, mos: k, status };
  });
}
