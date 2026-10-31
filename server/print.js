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
h1{font-size:20pt;margin:0 0 4px}h2{font-size:15pt;margin:0 0 2px;color:#0b6b5d}h3{font-size:11.5pt;margin:14px 0 5px;border-bottom:1px solid #ccd;padding-bottom:2px;color:#0b6b5d}
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
