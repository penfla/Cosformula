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
import { getDb, uploadsDir } from './projects.js';
import { projectName } from './db.js';
import { cleanHtml, refsIn, STORED_RE, ALLOWED, extOf, insideRoot } from './security.js';
import { buildContext, SECTIONS } from './pifctx.js';
import { toxRows, productExposure, dailyAmount, ingredientPercent } from '../public/shared/pifcalc.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = n => (n == null ? '' : String(Math.round(n * 10000) / 10000).replace('.', ','));
export const SIZES = { A4: 'A4', A5: 'A5', Letter: 'Letter' };
const MAX_EMBED_FILE = 8 * 1024 * 1024, MAX_EMBED_TOTAL = 60 * 1024 * 1024;

const CSS = `
:root{color-scheme:light}
*{box-sizing:border-box}
body{font:10.5pt/1.45 "Segoe UI",system-ui,-apple-system,Helvetica,Arial,sans-serif;color:#1c2227;margin:0;background:#e9ecef}
.tb{position:sticky;top:0;z-index:5;display:flex;gap:10px;align-items:center;padding:8px 14px;background:#fff;border-bottom:1px solid #ccd;font-size:13px;flex-wrap:wrap}
.tb button,.tb select{font:inherit;padding:5px 10px;border:1px solid #99a;border-radius:6px;background:#fff;cursor:pointer}
.tb .pri{background:#0b6b5d;color:#fff;border-color:#0b6b5d}
.pages{max-width:210mm;margin:14px auto;background:#fff;padding:14mm 15mm;box-shadow:0 2px 10px rgba(0,0,0,.2)}
h1{font-size:20pt;margin:0 0 4px}h2,h3,h4{break-after:avoid}h2{font-size:15pt;margin:0 0 2px;color:#0b6b5d}h3{font-size:11.5pt;margin:14px 0 5px;border-bottom:1px solid #ccd;padding-bottom:2px;color:#0b6b5d}
.meta{color:#555;font-size:9.5pt;margin:0 0 8px}.meta b{color:#1c2227}
.cover{min-height:240mm;display:flex;flex-direction:column;justify-content:center;align-items:flex-start;gap:6px;break-after:page}
.cover h1{font-size:30pt;color:#0b6b5d}.cover .sub{font-size:14pt;color:#555}.cover .colo{margin-top:40mm;font-size:9pt;color:#666}
.toc{break-after:page}.toc ol{padding-left:22px}.toc li{margin:3px 0}.toc a{color:inherit;text-decoration:none}
.sheet{break-before:page}.sheet:first-of-type{break-before:auto}
table.f{border-collapse:collapse;width:100%;font-size:9.5pt}
.f th{background:#eef3f2;text-align:left;border:1px solid #bcc7c5;padding:3px 6px}
.f td{border:1px solid #cdd5d3;padding:3px 6px;vertical-align:top}.f tr{break-inside:avoid}
.f .n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.f tfoot td{font-weight:600;background:#f7f9f9}
.u{color:#a15c00}.inci{font-size:9pt;color:#333}
.proc{overflow-wrap:anywhere}.proc img{max-width:100%;max-height:110mm;height:auto;display:block;margin:6px 0;break-inside:avoid}
.proc p{margin:0 0 6px}.proc ol,.proc ul{margin:0 0 6px;padding-left:22px}.proc blockquote{border-left:3px solid #bcc7c5;margin:6px 0;padding-left:10px;color:#444}
.proc .vid{padding:6px 10px;border:1px dashed #99a;border-radius:6px;color:#444}
.proc li[data-list=bullet]{list-style:disc}
.gal{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.gal figure{margin:0;break-inside:avoid}.gal img{width:100%;max-height:60mm;object-fit:contain;border:1px solid #dde}
.gal figcaption,.fl{font-size:9pt;color:#444}.fl{margin:2px 0}
.note{white-space:pre-wrap}.foot{margin-top:10px;font-size:8.5pt;color:#777}
@page{size:%SIZE%;margin:14mm 14mm 16mm}
@page{@bottom-left{content:"Cosformula · © 2026 Flavio Pendolino · PolyForm Noncommercial 1.0.0";font-size:7.5pt;color:#777}@bottom-right{content:counter(page);font-size:8pt;color:#555}}
@media print{body{background:#fff;font-size:10pt}.tb{display:none}.pages{box-shadow:none;margin:0;padding:0;max-width:none}}
`;

function resolver(slug, embed) {
  let total = 0;
  const dir = uploadsDir(slug);
  return (name, file) => {
    if (!embed) return `/api/projects/${slug}/files/n/${name}/raw`;
    if (!file || file.kind !== 'image' || file.size > MAX_EMBED_FILE || total + file.size > MAX_EMBED_TOTAL) return null;
    const p = path.join(dir, name);
    if (!STORED_RE.test(name) || !insideRoot(dir, p) || !fs.existsSync(p)) return null;
    total += file.size;
    return `data:${ALLOWED[extOf(name)].mime};base64,${fs.readFileSync(p).toString('base64')}`;
  };
}

function renderProcess(html, files, url) {
  const byName = new Map(files.map(f => [f.stored_name, f]));
  let out = cleanHtml(html, new Set(byName.keys()));
  out = out.replace(/<video\b[^>]*\bsrc="cosfile:([^"]+)"[^>]*><\/video>/g, (_m, n) => `<p class="vid">▶ Video: ${esc(byName.get(n)?.original_name || n)}</p>`);
  out = out.replace(/(src|href)="cosfile:([^"]+)"/g, (_m, attr, n) => {
    const u = url(n, byName.get(n));
    return u ? `${attr}="${u}"` : attr === 'src' ? 'src="" alt="(immagine non incorporabile)"' : '';
  });
  return out;
}

function sheet(db, f, opts, url) {
  const ings = db.prepare('SELECT * FROM ingredients WHERE formula_id=? ORDER BY position,id').all(f.id);
  const files = db.prepare('SELECT * FROM files WHERE formula_id=? ORDER BY id').all(f.id);
  const allFiles = db.prepare('SELECT * FROM files').all(); // il processo può riferire file di altre formule del progetto
  const totP = ings.reduce((a, i) => a + (i.percent || 0), 0), totG = ings.reduce((a, i) => a + (i.grams || 0), 0);
  const inciList = [...ings].filter(i => i.inci).sort((a, b) => (b.percent || 0) - (a.percent || 0)).map(i => esc(i.inci)).join(', ');
  const used = refsIn(f.process_html);
  const att = files.filter(x => !used.has(x.stored_name));
  const imgs = att.filter(x => x.kind === 'image'), others = att.filter(x => x.kind !== 'image');
  const rows = ings.map(i => `<tr><td>${esc(i.phase)}</td><td>${esc(i.trade_name)}${i.supplier ? `<br><small>${esc(i.supplier)}</small>` : ''}</td>
    <td class="inci${i.inci_status === 'unverified' ? ' u' : ''}">${esc(i.inci) || '<em>—</em>'}${i.inci_status === 'unverified' ? ' ⚠' : ''}</td><td>${esc(i.function)}</td><td class="n">${num(i.percent)}</td><td class="n">${num(i.grams)}</td></tr>`).join('');
  return `<section class="sheet" id="f${f.id}">
<h2>${esc(f.code ? f.code + ' · ' : '')}${esc(f.name)}</h2>
<p class="meta">Versione <b>${esc(f.version)}</b> · Batch <b>${f.batch_g != null ? num(f.batch_g) + ' g' : '—'}</b> · Aggiornata ${esc(String(f.updated_at).slice(0, 10))}</p>
<h3>Formula</h3>
<table class="f"><thead><tr><th>Fase</th><th>Ingrediente</th><th>INCI</th><th>Funzione</th><th class="n">%</th><th class="n">g</th></tr></thead><tbody>${rows || '<tr><td colspan="6"><em>Nessun ingrediente</em></td></tr>'}</tbody>
<tfoot><tr><td colspan="4">Totale</td><td class="n">${num(Math.round(totP * 10000) / 10000)}</td><td class="n">${num(Math.round(totG * 1000) / 1000)}</td></tr></tfoot></table>
${ings.some(i => i.inci_status === 'unverified') ? '<p class="foot">⚠ INCI non verificato nel dataset CosIng.</p>' : ''}
${inciList ? `<h3>Lista INCI (per % decrescente, indicativa)</h3><p class="inci">${inciList}</p>` : ''}
${f.notes ? `<h3>Note</h3><p class="note">${esc(f.notes)}</p>` : ''}
${f.process_html ? `<h3>Processo preparativo</h3><div class="proc">${renderProcess(f.process_html, allFiles, url)}</div>` : ''}
${opts.attachments && (imgs.length || others.length) ? `<h3>Allegati</h3>
${imgs.length ? `<div class="gal">${imgs.map(x => { const u = url(x.stored_name, x); return u ? `<figure><img src="${u}" alt=""><figcaption>${esc(x.caption || x.original_name)}</figcaption></figure>` : `<p class="fl">🖼 ${esc(x.original_name)}</p>`; }).join('')}</div>` : ''}
${others.map(x => `<p class="fl">${x.kind === 'video' ? '▶' : '📄'} ${esc(x.original_name)}${x.caption ? ' — ' + esc(x.caption) : ''}</p>`).join('')}` : ''}
</section>`;
}

export function renderDocument(slug, ids, o = {}) {
  const db = getDb(slug);
  const size = SIZES[o.size] || 'A4';
  const all = db.prepare('SELECT * FROM formulas ORDER BY name COLLATE NOCASE, id').all();
  let list = ids === 'all' ? all : ids.map(id => all.find(f => f.id === id)).filter(Boolean);
  const opts = { cover: !!o.cover, toc: !!o.toc, attachments: o.attachments !== false };
  const url = resolver(slug, !!o.embed);
  const pname = projectName(db), date = new Date().toLocaleDateString('it-IT');
  const cover = opts.cover ? `<section class="cover"><div class="sub">Raccolta di formulazioni cosmetiche</div><h1>${esc(pname)}</h1><div class="sub">${list.length} ${list.length === 1 ? 'scheda' : 'schede'} · ${esc(date)}</div>
<div class="colo">Generato con Cosformula · © 2026 Flavio Pendolino | PolyForm Noncommercial 1.0.0<br>Disclaimer: validare i risultati con campioni di riferimento prima di qualsiasi uso analitico, ingegneristico, di sicurezza o regolatorio.</div></section>` : '';
  const toc = opts.toc && list.length > 1 ? `<section class="toc"><h2>Indice</h2><ol>${list.map(f => `<li><a href="#f${f.id}">${esc(f.code ? f.code + ' · ' : '')}${esc(f.name)}</a> <small>v${esc(f.version)}</small></li>`).join('')}</ol></section>` : '';
  const toolbar = o.download ? '' : `<div class="tb"><button class="pri" id="btn-print">Stampa / Salva come PDF</button>
<label>Formato <select id="sel-size">${Object.keys(SIZES).map(s => `<option${s === size ? ' selected' : ''}>${s}</option>`).join('')}</select></label>
<span>${list.length} ${list.length === 1 ? 'scheda' : 'schede'} — nel dialogo di stampa scegli “Salva come PDF” e disattiva intestazioni/piè di pagina del browser.</span></div>`;
  const title = list.length === 1 ? `${list[0].code ? list[0].code + ' ' : ''}${list[0].name}` : `${pname} — booklet`;
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>${CSS.replace('%SIZE%', size)}</style></head><body>
${toolbar}<main class="pages">${cover}${toc}${list.map(f => sheet(db, f, opts, url)).join('') || '<p>Nessuna scheda selezionata.</p>'}</main>
${o.download ? '' : '<script src="/print.js"></script>'}</body></html>`;
}

// ---------------------------------------------------------------- PIF
const kv = (rows) => `<table class="f kv"><tbody>${rows.filter(([, v]) => v !== '' && v != null).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table>`;
const MOS = { ok: 'conforme (≥100)', low: '⚠ < 100', nodata: 'dato NOAEL mancante', nocalc: 'non calcolabile' };

export function renderPif(slug, fid, o = {}) {
  const db = getDb(slug);
  const c = buildContext(db, fid), f = c.formula, d = c.data;
  const size = SIZES[o.size] || 'A4';
  const url = resolver(slug, !!o.embed);
  const allFiles = db.prepare('SELECT * FROM files').all();
  const user = k => (c.sections[k] ? `<div class="proc">${renderProcess(c.sections[k], allFiles, url)}</div>` : '');
  const tot = c.rows.reduce((a, r) => a + (ingredientPercent(r, f.batch_g) || 0), 0);
  const A = productExposure(d), g = dailyAmount(d);
  const tox = toxRows(c.rows, d, f.batch_g);
  const auto = {
    descr: kv([['Prodotto', d.product_name || f.name], ['Codice / versione formula', `${f.code || '—'} / v${f.version}`], ['Categoria', d.category], ['Forma cosmetica', d.form], ['Confezionamento', d.packaging],
      ['Durata / PAO', [d.shelf_life, d.pao].filter(Boolean).join(' / ')], ['Notifica CPNP', d.cpnp_ref], ['Persona responsabile', [d.rp_name, d.rp_address].filter(Boolean).join(' — ')], ['Fabbricante', [d.manuf_name, d.manuf_address].filter(Boolean).join(' — ')]]),
    a1: `<table class="f"><thead><tr><th>#</th><th>Ingrediente</th><th>INCI</th><th>CAS / EC</th><th>Funzione</th><th class="n">%</th><th>Restrizioni (CosIng)</th></tr></thead><tbody>${c.rows.map((r, i) => {
      const m = r.material || {}, cs = r.cosing || {};
      const ce = [m.cas || cs.cas, m.ec || cs.ec].filter(Boolean).join(' / ');
      return `<tr><td>${i + 1}</td><td>${esc(r.trade_name)}${r.supplier ? `<br><small>${esc(r.supplier)}${m.supplier_code ? ' · ' + esc(m.supplier_code) : ''}</small>` : ''}</td><td class="inci${r.inci_status === 'unverified' ? ' u' : ''}">${esc(r.inci) || '—'}${r.inci_status === 'unverified' ? ' ⚠' : ''}</td><td>${esc(ce)}</td><td>${esc(r.function || m.function || cs.functions)}</td><td class="n">${num(ingredientPercent(r, f.batch_g))}</td><td><small>${esc(cs.restriction || '')}</small></td></tr>`;
    }).join('') || '<tr><td colspan="7"><em>Nessun ingrediente</em></td></tr>'}</tbody><tfoot><tr><td colspan="5">Totale</td><td class="n">${num(Math.round(tot * 10000) / 10000)}</td><td></td></tr></tfoot></table>`,
    a4: `<table class="f"><thead><tr><th>Ingrediente</th><th>Purezza/titolo %</th><th>Impurezze / tracce</th><th>Allergeni dichiarati</th></tr></thead><tbody>${c.rows.filter(r => r.material).map(r => `<tr><td>${esc(r.trade_name)}</td><td class="n">${num(r.material.active_pct)}</td><td>${esc(r.material.impurities)}</td><td>${esc(r.material.allergens)}</td></tr>`).join('') || '<tr><td colspan="4"><em>Nessuna materia prima collegata</em></td></tr>'}</tbody></table>`,
    a5: kv([['Uso previsto', d.intended_use], ['Popolazione target', d.target_population], ['Sito di applicazione', d.site_of_application], ['Frequenza (applicazioni/giorno)', num(d.frequency_per_day)]]),
    a6: kv([['Quantità per applicazione (g)', num(d.amount_per_application_g)], ['Frequenza (n/giorno)', num(d.frequency_per_day)], ['Quantità giornaliera (g/giorno)', num(g)], ['Fattore di ritenzione RF', num(d.retention_factor ?? 1)],
      ['Peso corporeo (kg)', num(d.body_weight_kg || 60)], ['Esposizione al prodotto A (mg/kg pc/giorno)', A == null ? '' : num(Math.round(A * 1000) / 1000)]]),
    a7: toxTable(tox, false), a8: toxTable(tox, true),
    gmp: `${kv([['Fabbricante', [d.manuf_name, d.manuf_address].filter(Boolean).join(' — ')], ['Standard GMP', d.gmp_standard]])}<h4>Processo di fabbricazione (da scheda formula)</h4><div class="proc">${f.process_html ? renderProcess(f.process_html, allFiles, url) : '<em>—</em>'}</div>`,
    b4: kv([['Valutatore della sicurezza', d.assessor_name], ['Indirizzo', d.assessor_address], ['Qualifica (art. 10(2))', d.assessor_qualification], ['Data', d.assessment_date]]),
  };
  const docRow = r => { const m = r.material; const cell = x => (x ? `✔ ${esc(x.original_name)}${x.revision ? ' · rev. ' + esc(x.revision) : ''}${x.doc_date ? ' · ' + esc(x.doc_date) : ''}` : '<span class="u">✗ mancante</span>'); return `<tr><td>${esc(r.trade_name)}</td><td>${esc(r.supplier)}</td><td>${m ? cell(r.sds) : '<span class="u">non collegato</span>'}</td><td>${m ? cell(r.tds) : '<span class="u">non collegato</span>'}</td></tr>`; };
  const annex = `<table class="f"><thead><tr><th>Ingrediente</th><th>Fornitore</th><th>SDS</th><th>TDS</th></tr></thead><tbody>${c.rows.map(docRow).join('') || '<tr><td colspan="4"><em>—</em></td></tr>'}</tbody></table>`;
  let group = '';
  const body = SECTIONS.map(sec => {
    const head = sec.group !== group ? `<h2 class="grp">${esc(sec.group.startsWith('Parte') ? 'Relazione sulla sicurezza — ' + sec.group : sec.group)}</h2>` : '';
    group = sec.group;
    return `${head}<section class="pifsec"><h3>${esc(sec.title)}</h3>${auto[sec.key] || ''}${user(sec.key) || (auto[sec.key] ? '' : '<p class="muted"><em>Da compilare.</em></p>')}</section>`;
  }).join('') + `<h2 class="grp">Allegati</h2><section class="pifsec"><h3>Schede di sicurezza (SDS) e schede tecniche (TDS) delle materie prime</h3>${annex}</section>`;
  const title = `PIF — ${d.product_name || f.name}`;
  const toolbar = o.download ? '' : `<div class="tb"><button class="pri" id="btn-print">Stampa / Salva come PDF</button>
<label>Formato <select id="sel-size">${Object.keys(SIZES).map(z => `<option${z === size ? ' selected' : ''}>${z}</option>`).join('')}</select></label><span>Product Information File — Reg. (CE) 1223/2009, art. 11</span></div>`;
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>${CSS.replace('%SIZE%', size)}.grp{font-size:13pt;margin:18px 0 4px;color:#1c2227;border-bottom:2px solid #0b6b5d}.pifsec{break-inside:auto}.kv th{width:34%;text-align:left;background:#f4f7f6}.muted{color:#777}h4{margin:8px 0 4px}</style></head><body>
${toolbar}<main class="pages"><section class="cover"><div class="sub">Product Information File (PIF)</div><h1>${esc(d.product_name || f.name)}</h1>
<div class="sub">${esc(f.code ? f.code + ' · ' : '')}formula v${esc(f.version)} · PIF v${esc(d.pif_version || '—')} · ${esc(d.pif_status || 'bozza')}</div>
<div class="sub">${esc(d.rp_name || '')}</div>
<div class="colo">Redatto ai sensi del Regolamento (CE) n. 1223/2009, art. 11 e Allegato I. Generato con Cosformula · © 2026 Flavio Pendolino | PolyForm Noncommercial 1.0.0<br>Disclaimer: validare i risultati con campioni di riferimento prima di qualsiasi uso analitico, ingegneristico, di sicurezza o regolatorio. Il calcolo di SED/MoS è indicativo e non sostituisce la valutazione del valutatore della sicurezza qualificato (art. 10).</div></section>
${body}</main>${o.download ? '' : '<script src="/print.js"></script>'}</body></html>`;
}

function toxTable(rows, full) {
  const r = rows.filter(x => x.conc != null);
  if (!r.length) return '<p class="muted"><em>Nessun dato di concentrazione.</em></p>';
  return `<table class="f"><thead><tr><th>Ingrediente / INCI</th><th class="n">C sostanza %</th>${full ? '<th class="n">NOAEL mg/kg/g</th>' : ''}<th class="n">DA %</th><th class="n">SED mg/kg/g</th>${full ? '<th class="n">MoS</th><th>Esito</th>' : ''}</tr></thead><tbody>${r.map(x =>
    `<tr><td>${esc(x.name)}${x.inci && x.inci !== x.name ? `<br><small>${esc(x.inci)}</small>` : ''}</td><td class="n">${num(Math.round(x.conc * 10000) / 10000)}</td>${full ? `<td class="n">${num(x.noael)}${x.noael_ref ? `<br><small>${esc(x.noael_ref)}</small>` : ''}</td>` : ''}<td class="n">${x.abs == null ? '100 (default)' : num(x.abs)}</td><td class="n">${x.sed == null ? '' : num(Math.round(x.sed * 10000) / 10000)}</td>${full ? `<td class="n">${x.mos == null ? '' : num(Math.round(x.mos * 10) / 10)}</td><td class="${x.status === 'low' ? 'u' : ''}">${MOS[x.status]}</td>` : ''}</tr>`).join('')}</tbody></table>`;
}
