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

const TYPES = { SDS: 'SDS — scheda di sicurezza', TDS: 'TDS — scheda tecnica', COA: 'CoA — certificato di analisi', OTHER: 'Altro' };

/** Guess del tipo di documento dal nome file (SDS/MSDS/FDS, TDS/scheda tecnica, CoA). */
export const guessDocType = name => {
  const n = String(name).toLowerCase();
  if (/\b(m?sds|fds|scheda[ _-]?(di[ _-]?)?sicurezza|safety[ _-]?data)/.test(n)) return 'SDS';
  if (/\b(tds|scheda[ _-]?tecnica|technical[ _-]?data)/.test(n)) return 'TDS';
  if (/\b(coa|certificat)/.test(n)) return 'COA';
  return 'OTHER';
};

/** Libreria materie prime: dati del fornitore (SDS/TDS) e allegati con tipo, data, revisione e lingua. */
export function createMaterials(ctx) {
  const { h, api, S, qs, debounce, fmt, parseNum, toast } = ctx;
  const FIELDS = ['name', 'inci', 'supplier', 'supplier_code', 'cas', 'ec', 'function', 'active_pct', 'use_level_max', 'appearance', 'ph', 'density', 'hazard', 'noael', 'noael_ref', 'dermal_abs', 'allergens', 'impurities', 'tds_notes', 'sds_notes'];
  const NUMS = new Set(['active_pct', 'use_level_max', 'noael', 'dermal_abs']);
  const BADGE = { verified: '✔ INCI verificato', unverified: '⚠ da verificare', none: '∅ senza INCI' };
  let cur = null, saving = Promise.resolve(), dirty = false;

  async function save() {
    if (!dirty || !cur) return; dirty = false; const m = cur;
    saving = saving.then(async () => {
      try {
        const body = Object.fromEntries([...FIELDS, 'inci_status'].map(k => [k, m[k]]));
        const r = await api(`${qs()}/materials/${m.id}`, { method: 'PUT', body }); m.inci_status = r.inci_status; m.cosing_ref = r.cosing_ref;
        ctx.setState('Salvato ' + new Date().toLocaleTimeString()); await ctx.loadMaterials(); ctx.renderList();
        const b = document.querySelector('#mat-inci-badge'); if (b) b.textContent = BADGE[m.inci_status];
      } catch (e) { dirty = true; ctx.setState('Errore: ' + e.message); }
    });
    return saving;
  }
  const schedule = debounce(save, 700);
  const touch = () => { dirty = true; ctx.setState('Modifiche non salvate…'); schedule(); };
  S.matFlush = async () => { schedule.flush(); await save(); await saving; };

  async function open(id) {
    await S.matFlush?.();
    cur = await api(`${qs()}/materials/${id}`); S.material = cur; ctx.renderList(); render();
  }

  const fld = (label, key, o = {}) => {
    const el = o.textarea ? h('textarea', { rows: o.rows || 2, maxlength: o.max || 1000 }) : h('input', { type: 'text', maxlength: o.max || 200, inputmode: NUMS.has(key) ? 'decimal' : null });
    el.value = NUMS.has(key) ? fmt(cur[key]) : cur[key] ?? ''; el.setAttribute('aria-label', label);
    el.addEventListener('input', () => { cur[key] = NUMS.has(key) ? parseNum(el.value) : el.value; if (key === 'inci') { cur.inci_status = cur.inci.trim() ? 'unverified' : 'none'; const b = document.querySelector('#mat-inci-badge'); if (b) b.textContent = BADGE[cur.inci_status]; } touch(); });
    if (key === 'inci') ctx.inciSuggest(el, r => { cur.inci = r.inci_name; el.value = r.inci_name; cur.inci_status = 'verified'; cur.cosing_ref = r.ref || ''; if (!cur.cas && r.cas) { cur.cas = r.cas; } if (!cur.function && r.functions) cur.function = r.functions.toLowerCase().slice(0, 200); touch(); render(); });
    return h('label', { class: 'fld' + (o.wide ? ' wide' : '') }, label, el, key === 'inci' ? h('small', { id: 'mat-inci-badge', class: 'muted' }, BADGE[cur.inci_status]) : null);
  };

  // ---- documenti
  const docUrl = (d, dl) => `/api/projects/${S.active}/files/${d.id}/raw${dl ? '?download=1' : ''}`;
  async function upload(files, fields) {
    if (!files.length || !cur) return;
    const res = await ctx.uploadTo(`/api/projects/${S.active}/materials/${cur.id}/files`, files, fields, p => ctx.setState(`Caricamento ${p}%`));
    ctx.setState(res.errors.length ? 'Rifiutati: ' + res.errors.map(e => `${e.name} (${e.error})`).join('; ') : 'Documenti caricati');
    if (res.errors.length) toast('Rifiutati: ' + res.errors.map(e => `${e.name}: ${e.error}`).join('; '));
    if (res.created.length) { await ctx.loadMaterials(); await open(cur.id); }
  }
  /** Drop globale (fuori dalla zona dedicata): tipo di documento dedotto dal nome file. */
  async function dropFiles(files) {
    if (!cur) return toast('Seleziona prima una materia prima');
    const groups = {}; for (const f of files) (groups[guessDocType(f.name)] ||= []).push(f);
    for (const [type, fl] of Object.entries(groups)) await upload(fl, { doc_type: type });
  }

  function docsBlock() {
    const type = h('select', { 'aria-label': 'Tipo di documento' }, ...Object.entries(TYPES).map(([k, v]) => h('option', { value: k }, v)));
    const date = h('input', { type: 'date', 'aria-label': 'Data del documento' }), rev = h('input', { type: 'text', placeholder: 'Rev.', size: 6, maxlength: 40, 'aria-label': 'Revisione' }), lang = h('input', { type: 'text', placeholder: 'Lingua', size: 6, maxlength: 20, 'aria-label': 'Lingua' });
    const input = h('input', { type: 'file', multiple: true, hidden: true, accept: '.pdf,.docx,.xlsx,.odt,.ods,.txt,.csv,.jpg,.jpeg,.png', onchange: () => { upload([...input.files], { doc_type: type.value, doc_date: date.value, revision: rev.value, language: lang.value }); input.value = ''; } });
    const zone = h('div', { class: 'drop', ondragover: e => { e.preventDefault(); zone.classList.add('over'); }, ondragleave: () => zone.classList.remove('over'),
      ondrop: e => { e.preventDefault(); e.stopPropagation(); zone.classList.remove('over'); upload([...e.dataTransfer.files], { doc_type: type.value, doc_date: date.value, revision: rev.value, language: lang.value }); } },
      h('div', { class: 'row wrap' }, 'Tipo', type, 'Data', date, rev, lang), h('div', {}, 'Trascina qui i file del fornitore (PDF consigliato) oppure ', h('button', { class: 'btn small', onclick: () => input.click() }, 'sfoglia'), input));
    const rows = cur.docs.map(d => {
      const patch = (k, v) => api(`${qs()}/files/${d.id}`, { method: 'PATCH', body: { [k]: v } }).then(async () => { d[k] = v; await ctx.loadMaterials(); ctx.renderList(); }).catch(e => toast(e.message));
      return h('tr', {},
        h('td', {}, h('select', { 'aria-label': 'Tipo', onchange: e => patch('doc_type', e.target.value).then(() => open(cur.id)) }, ...Object.entries(TYPES).map(([k, v]) => h('option', { value: k, selected: d.doc_type === k }, k)))),
        h('td', {}, h('a', { href: docUrl(d), target: '_blank', rel: 'noopener noreferrer' }, d.original_name), h('small', { class: 'muted' }, ` · ${d.size >= 1048576 ? (d.size / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(d.size / 1024)) + ' KB'}`)),
        h('td', {}, h('input', { type: 'date', value: d.doc_date, 'aria-label': 'Data', onchange: e => patch('doc_date', e.target.value) })),
        h('td', {}, h('input', { value: d.revision, size: 6, maxlength: 40, 'aria-label': 'Revisione', onchange: e => patch('revision', e.target.value) })),
        h('td', {}, h('input', { value: d.language, size: 6, maxlength: 20, 'aria-label': 'Lingua', onchange: e => patch('language', e.target.value) })),
        h('td', {}, h('input', { value: d.caption, maxlength: 500, placeholder: 'Note', 'aria-label': 'Note', onchange: e => patch('caption', e.target.value) })),
        h('td', { class: 'c-act' }, h('a', { class: 'btn small', href: docUrl(d, true) }, '⬇'),
          h('button', { class: 'btn small danger', 'aria-label': 'Elimina documento', onclick: async () => { if (!confirm(`Eliminare “${d.original_name}”?`)) return; await api(`${qs()}/files/${d.id}`, { method: 'DELETE' }); await ctx.loadMaterials(); await open(cur.id); } }, '✕')));
    });
    const miss = ['SDS', 'TDS'].filter(t => !cur.docs.some(d => d.doc_type === t));
    return h('div', {}, miss.length ? h('p', { class: 'warn' }, `⚠ Mancano: ${miss.join(', ')}. Servono per il PIF (identità, pericoli, impurezze) e come allegati del fornitore.`) : h('p', { class: 'ok' }, '✔ SDS e TDS presenti.'),
      zone, h('div', { class: 'tblwrap', style: 'margin-top:8px' }, h('table', { class: 'ing small' }, h('thead', {}, h('tr', {}, ['Tipo', 'File', 'Data', 'Rev.', 'Lingua', 'Note', ''].map(t => h('th', {}, t)))),
        h('tbody', {}, rows.length ? rows : [h('tr', {}, h('td', { colspan: 7, class: 'muted' }, 'Nessun documento caricato.'))]))));
  }

  function render() {
    const sh = document.querySelector('#sheet'); sh.replaceChildren();
    sh.append(
      h('div', { class: 'sheet-head' }, h('h2', { style: 'margin:0' }, cur.name), h('div', { class: 'row' }, h('span', { id: 'save-state' }, ''),
        h('button', { class: 'btn small danger', onclick: async () => { if (!confirm(`Eliminare “${cur.name}” e i suoi documenti? Gli ingredienti collegati verranno scollegati.`)) return; await api(`${qs()}/materials/${cur.id}`, { method: 'DELETE' }); cur = null; S.material = null; await ctx.loadMaterials(); ctx.renderList(); S.materials[0] ? await open(S.materials[0].id) : sh.replaceChildren(h('p', { class: 'empty' }, 'Nessuna materia prima.')); } }, 'Elimina'))),
      h('p', { class: 'muted' }, cur.used_in.length ? ['Usata in: ', ...cur.used_in.flatMap((f, i) => [i ? ', ' : '', h('a', { href: '#', onclick: e => { e.preventDefault(); ctx.openFormula(f.id); } }, (f.code ? f.code + ' · ' : '') + f.name)])] : 'Non ancora usata in nessuna formula.'),
      h('h3', {}, 'Identificazione'),
      h('div', { class: 'grid2' }, fld('Nome commerciale', 'name'), fld('INCI (CosIng)', 'inci', { max: 300 }), fld('Fornitore', 'supplier'), fld('Codice fornitore', 'supplier_code', { max: 100 }), fld('CAS', 'cas'), fld('EC / EINECS', 'ec'), fld('Funzione', 'function'), fld('Titolo / purezza (% di sostanza nella materia prima)', 'active_pct', { max: 12 })),
      h('h3', {}, 'Scheda tecnica (TDS)'),
      h('div', { class: 'grid2' }, fld('Aspetto', 'appearance'), fld('pH', 'ph', { max: 100 }), fld('Densità', 'density', { max: 100 }), fld('Dose d’uso massima raccomandata (%)', 'use_level_max', { max: 12 }), fld('Note TDS', 'tds_notes', { textarea: true, wide: true, max: 5000, rows: 3 })),
      h('h3', {}, 'Scheda di sicurezza (SDS) e dati tossicologici'),
      h('div', { class: 'grid2' }, fld('Classificazione CLP / frasi H', 'hazard', { textarea: true, wide: true }), fld('NOAEL (mg/kg pc/giorno)', 'noael', { max: 12 }), fld('Fonte NOAEL (parere SCCS, studio…)', 'noael_ref', { max: 300 }), fld('Assorbimento dermico (%)', 'dermal_abs', { max: 12 }),
        fld('Allergeni dichiarati (Allegato III, es. i 26/82 allergeni dei profumi)', 'allergens', { wide: true, max: 500 }), fld('Impurezze / tracce / metalli pesanti', 'impurities', { textarea: true, wide: true }), fld('Note SDS', 'sds_notes', { textarea: true, wide: true, max: 5000, rows: 3 })),
      h('h3', {}, 'Documenti del fornitore (SDS, TDS, CoA)'), docsBlock());
  }

  async function create() {
    const m = await api(`${qs()}/materials`, { method: 'POST', body: { name: 'Nuova materia prima' } });
    await ctx.loadMaterials(); await open(m.id);
  }
  return { open, create, dropFiles, render };
}
