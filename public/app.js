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

const $ = s => document.querySelector(s);
const h = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
};
const debounce = (fn, ms) => { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.flush = () => { clearTimeout(t); }; return d; };
const round = (n, d = 4) => (n == null || Number.isNaN(n) ? null : Math.round(n * 10 ** d) / 10 ** d);
const parseNum = v => { if (v === '' || v == null) return null; const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
const fmt = n => (n == null ? '' : String(round(n)));

async function api(path, opts = {}) {
  const o = { ...opts, headers: { ...(opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) } };
  if (opts.body && !(opts.body instanceof FormData)) o.body = JSON.stringify(opts.body);
  const r = await fetch('/api' + path, o);
  const j = r.headers.get('content-type')?.includes('json') ? await r.json() : null;
  if (!r.ok) throw new Error(j?.error || `Errore ${r.status}`);
  return j;
}

// ---------------- stato ----------------
const store = {
  get() { try { return JSON.parse(localStorage.getItem('cosf.state') || '{}'); } catch { return {}; } },
  set(v) { try { localStorage.setItem('cosf.state', JSON.stringify(v)); } catch { /* storage non disponibile */ } },
};
const S = { open: [], active: null, formulas: [], current: null, projects: [], inci: null, quill: null };
const sel = {}; // slug -> formula id selezionata per tab

function persist() { store.set({ open: S.open, active: S.active, sel }); }
const qs = () => `/projects/${S.active}`;

// ---------------- dialog helpers ----------------
function ask(title, value = '') {
  return new Promise(res => {
    const d = $('#dlg-prompt'); $('#prompt-title').textContent = title; const i = $('#prompt-input'); i.value = value;
    d.addEventListener('close', () => res(d.returnValue === 'ok' ? i.value.trim() : null), { once: true });
    d.showModal(); i.select();
  });
}
const toast = m => { const b = $('#banner'); b.hidden = false; b.textContent = m; b.className = 'banner'; setTimeout(() => { if (b.textContent === m) refreshBanner(); }, 5000); };

// ---------------- progetti / tab ----------------
async function loadProjects() { S.projects = await api('/projects'); return S.projects; }

function renderTabs() {
  const t = $('#tabs'); t.replaceChildren();
  for (const slug of S.open) {
    const p = S.projects.find(x => x.slug === slug);
    t.append(h('div', { class: 'tab' + (slug === S.active ? ' active' : ''), role: 'tab', 'aria-selected': slug === S.active, tabindex: 0,
      onclick: () => activate(slug), onkeydown: e => { if (e.key === 'Enter') activate(slug); } },
      p?.name || slug,
      h('button', { 'aria-label': 'Chiudi scheda ' + (p?.name || slug), onclick: e => { e.stopPropagation(); closeTab(slug); } }, '×')));
  }
}

async function openProject(slug) {
  if (!S.open.includes(slug)) S.open.push(slug);
  await activate(slug);
}
function closeTab(slug) {
  S.open = S.open.filter(s => s !== slug);
  if (S.active === slug) { S.active = S.open[S.open.length - 1] || null; }
  persist(); activate(S.active, true);
}
async function activate(slug) {
  await flushSave();
  S.active = slug; S.current = null; persist();
  await loadProjects();
  S.open = S.open.filter(s => S.projects.some(p => p.slug === s));
  if (S.active && !S.open.includes(S.active)) S.active = S.open[0] || null;
  renderTabs();
  $('#project-title').textContent = S.projects.find(p => p.slug === S.active)?.name || '—';
  if (!S.active) { S.formulas = []; renderList(); $('#sheet').replaceChildren(h('p', { class: 'empty' }, 'Crea o apri un progetto per iniziare.')); history.replaceState(null, '', '#'); return; }
  await loadFormulas();
  const want = sel[S.active] && S.formulas.some(f => f.id === sel[S.active]) ? sel[S.active] : S.formulas[0]?.id;
  if (want) await openFormula(want); else $('#sheet').replaceChildren(h('p', { class: 'empty' }, 'Nessuna formula. Usa “+ Formula”.'));
}

async function loadFormulas() { S.formulas = await api(`${qs()}/formulas`); renderList(); }
function renderList() {
  const ul = $('#formula-list'); ul.replaceChildren();
  const f = $('#formula-filter').value.toLowerCase();
  for (const x of S.formulas.filter(x => !f || `${x.code} ${x.name}`.toLowerCase().includes(f)))
    ul.append(h('li', { class: x.id === S.current?.id ? 'active' : '', tabindex: 0, onclick: () => openFormula(x.id), onkeydown: e => e.key === 'Enter' && openFormula(x.id) },
      h('span', {}, (x.code ? x.code + ' · ' : '') + x.name), h('small', {}, `v${x.version} · ${x.ingredients}ing · ${x.files}📎`)));
}

// ---------------- scheda formula ----------------
let saveTimer = null, dirty = false, saving = Promise.resolve();
function setState(t) { const e = $('#save-state'); if (e) e.textContent = t; }
function scheduleSave() { dirty = true; setState('Modifiche non salvate…'); clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 700); }
async function saveNow() {
  clearTimeout(saveTimer); if (!dirty || !S.current) return;
  dirty = false; const f = S.current, slug = S.active;
  saving = saving.then(async () => {
    try {
      await api(`/projects/${slug}/formulas/${f.id}`, { method: 'PUT', body: { code: f.code, name: f.name, version: f.version, batch_g: f.batch_g, notes: f.notes, ingredients: f.ingredients } });
      setState('Salvato ' + new Date().toLocaleTimeString());
      const li = S.formulas.find(x => x.id === f.id); if (li) { Object.assign(li, { code: f.code, name: f.name, version: f.version, ingredients: f.ingredients.length }); renderList(); }
    } catch (e) { dirty = true; setState('Errore di salvataggio: ' + e.message); }
  });
  return saving;
}
const saveProcess = debounce(async () => {
  if (!S.quill || !S.current) return;
  try { await api(`${qs()}/formulas/${S.current.id}/process`, { method: 'PUT', body: { html: S.quill.root.innerHTML } }); setState('Processo salvato ' + new Date().toLocaleTimeString()); }
  catch (e) { setState('Errore: ' + e.message); }
}, 800);
async function flushSave() { if (dirty) await saveNow(); await saving; }

async function openFormula(id) {
  await flushSave();
  S.current = await api(`${qs()}/formulas/${id}`); sel[S.active] = id; persist();
  history.replaceState(null, '', `#/${S.active}/${id}`);
  renderList(); renderSheet();
}

function field(label, key, opts = {}) {
  const i = h('input', { value: S.current[key] ?? '', maxlength: opts.max || 200, type: 'text', inputmode: opts.num ? 'decimal' : null, 'aria-label': label,
    oninput: e => { S.current[key] = opts.num ? parseNum(e.target.value) : e.target.value; if (opts.num) recalcGrams(); if (key === 'name') { const t = document.querySelector('#sheet h2'); if (t) t.textContent = S.current.name; } scheduleSave(); } });
  return h('label', {}, label, i);
}

function renderSheet() {
  const f = S.current, sh = $('#sheet'); sh.replaceChildren();
  sh.append(
    h('div', { class: 'sheet-head' }, h('h2', { style: 'margin:0' }, f.name),
      h('div', { class: 'row' }, h('span', { id: 'save-state' }, ''),
        h('button', { class: 'btn small', onclick: dupFormula }, 'Duplica'),
        h('button', { class: 'btn small danger', onclick: delFormula }, 'Elimina'))),
    h('div', { class: 'hdr' }, field('Codice', 'code', { max: 40 }), field('Nome formula', 'name'), field('Versione', 'version', { max: 20 }), field('Batch (g)', 'batch_g', { num: true, max: 15 })),
    h('h3', {}, 'Formula'), buildTable(),
    h('h3', {}, 'Note'), h('textarea', { class: 'notes', maxlength: 5000, 'aria-label': 'Note', oninput: e => { f.notes = e.target.value; scheduleSave(); } }, f.notes),
    h('h3', {}, 'Processo preparativo'), h('div', { class: 'editorwrap' }, h('div', { id: 'editor' })),
    h('h3', {}, 'Allegati, foto e video'), buildFiles());
  initEditor();
}

function emptyIng() { return { trade_name: '', inci: '', inci_status: 'none', cosing_ref: '', phase: '', function: '', percent: null, grams: null, supplier: '', note: '' }; }
function recalcGrams() { const f = S.current; document.querySelectorAll('#ing-body tr').forEach((tr, i) => { const ing = f.ingredients[i]; if (ing && ing.percent != null && f.batch_g != null) { ing.grams = round(ing.percent * f.batch_g / 100); tr.querySelector('[data-k=grams]').value = fmt(ing.grams); } }); updateTotals(); }
function updateTotals() {
  const f = S.current; const p = f.ingredients.reduce((a, i) => a + (i.percent || 0), 0), g = f.ingredients.reduce((a, i) => a + (i.grams || 0), 0);
  const t = $('#tot'); if (!t) return;
  t.querySelector('[data-t=pct]').textContent = fmt(round(p, 4)) + ' %';
  t.querySelector('[data-t=pct]').className = Math.abs(p - 100) > 0.01 && f.ingredients.length ? 'warn' : '';
  t.querySelector('[data-t=g]').textContent = fmt(round(g, 3)) + ' g';
  t.querySelector('[data-t=msg]').textContent = Math.abs(p - 100) > 0.01 && f.ingredients.length ? `⚠ Totale ≠ 100 % (Δ ${fmt(round(p - 100, 4))})` : '';
}
const BADGE = { verified: ['✔ INCI verificato', 'Presente nel dataset CosIng'], unverified: ['⚠ da verificare', 'INCI non verificato: clic per verificare'], none: ['∅ senza INCI', 'Ingrediente senza INCI (ammesso)'] };

function buildTable() {
  const f = S.current;
  const body = h('tbody', { id: 'ing-body' });
  const mk = (ing, idx) => {
    const tr = h('tr', {});
    const cell = (k, cls, opts = {}) => h('td', { class: cls || '' }, h('input', { 'data-k': k, value: opts.num ? fmt(ing[k]) : ing[k] ?? '', maxlength: opts.max || 200, type: 'text', inputmode: opts.num ? 'decimal' : null, 'aria-label': opts.label || k,
      oninput: e => {
        const i = f.ingredients.indexOf(ing);
        ing[k] = opts.num ? parseNum(e.target.value) : e.target.value;
        if (k === 'percent' && f.batch_g != null) { ing.grams = ing.percent == null ? null : round(ing.percent * f.batch_g / 100); tr.querySelector('[data-k=grams]').value = fmt(ing.grams); }
        if (k === 'grams' && f.batch_g) { ing.percent = ing.grams == null ? null : round(ing.grams / f.batch_g * 100); tr.querySelector('[data-k=percent]').value = fmt(ing.percent); }
        updateTotals(); scheduleSave(); void i;
      } }));
    const badge = h('button', { class: 'badge ' + ing.inci_status, title: BADGE[ing.inci_status][1], onclick: e => verifyIngredient(ing, tr, e.currentTarget) }, BADGE[ing.inci_status][0]);
    const inci = h('input', { 'data-k': 'inci', value: ing.inci, maxlength: 300, 'aria-label': 'INCI', autocomplete: 'off', placeholder: 'INCI ufficiale (cerca CosIng)…',
      oninput: e => { ing.inci = e.target.value; ing.cosing_ref = ''; setBadge(ing, badge, ing.inci.trim() ? 'unverified' : 'none'); autocomplete(inci, ing, badge, tr); scheduleSave(); },
      onfocus: () => ing.inci.length >= 2 && autocomplete(inci, ing, badge, tr), onblur: () => setTimeout(hideAc, 150) });
    const nameIn = h('input', { 'data-k': 'trade_name', value: ing.trade_name, maxlength: 200, 'aria-label': 'Nome commerciale',
      oninput: e => { ing.trade_name = e.target.value; scheduleSave(); } });
    tr.append(cell('phase', 'c-phase', { max: 20, label: 'Fase' }), h('td', {}, nameIn), h('td', { class: 'c-inci' }, h('div', { class: 'inci-cell' }, inci, badge)),
      cell('function', '', { label: 'Funzione' }), cell('percent', 'num c-pct', { num: true, max: 12, label: '%' }), cell('grams', 'num c-g', { num: true, max: 12, label: 'Grammi' }),
      cell('supplier', '', { label: 'Fornitore' }),
      h('td', { class: 'c-act' },
        h('button', { class: 'btn small', 'aria-label': 'Sposta su', onclick: () => move(ing, -1) }, '↑'), h('button', { class: 'btn small', 'aria-label': 'Sposta giù', onclick: () => move(ing, 1) }, '↓'),
        h('button', { class: 'btn small danger', 'aria-label': 'Rimuovi ingrediente', onclick: () => { f.ingredients.splice(f.ingredients.indexOf(ing), 1); rebuild(); scheduleSave(); } }, '✕')));
    return tr;
  };
  const rebuild = () => { body.replaceChildren(...f.ingredients.map(mk)); updateTotals(); };
  const move = (ing, d) => { const i = f.ingredients.indexOf(ing), j = i + d; if (j < 0 || j >= f.ingredients.length) return; [f.ingredients[i], f.ingredients[j]] = [f.ingredients[j], f.ingredients[i]]; rebuild(); scheduleSave(); };
  rebuild();
  return h('div', {},
    h('div', { class: 'tblwrap' }, h('table', { class: 'ing' },
      h('thead', {}, h('tr', {}, ['Fase', 'Ingrediente (nome commerciale)', 'INCI', 'Funzione', '%', 'g', 'Fornitore', ''].map(t => h('th', {}, t)))), body,
      h('tfoot', {}, h('tr', { id: 'tot' }, h('td', { colspan: 4 }, h('span', { 'data-t': 'msg', class: 'warn' }), ' Totale'), h('td', { 'data-t': 'pct', class: 'num' }), h('td', { 'data-t': 'g', class: 'num' }), h('td', { colspan: 2 }))))),
    h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn', onclick: () => { f.ingredients.push(emptyIng()); rebuild(); scheduleSave(); body.lastElementChild.querySelector('input[data-k=trade_name]').focus(); } }, '+ Ingrediente'),
      h('button', { class: 'btn', onclick: verifyAll }, 'Verifica tutti gli INCI'), h('span', { class: 'muted' }, 'Gli ingredienti senza INCI sono ammessi.')));
}
function setBadge(ing, el, status) { ing.inci_status = status; el.className = 'badge ' + status; el.textContent = BADGE[status][0]; el.title = BADGE[status][1]; }

// ---- INCI: autocomplete + verifica ----
let acTimer, acReq = 0;
function hideAc() { $('#ac').hidden = true; }
function position(el, anchor) { const r = anchor.getBoundingClientRect(); el.style.left = r.left + scrollX + 'px'; el.style.top = r.bottom + scrollY + 2 + 'px'; }
function autocomplete(input, ing, badge, tr) {
  clearTimeout(acTimer);
  acTimer = setTimeout(async () => {
    const my = ++acReq, q = input.value.trim(); if (q.length < 2) return hideAc();
    let res = []; try { res = await api('/inci/search?q=' + encodeURIComponent(q)); } catch { return; }
    if (my !== acReq || document.activeElement !== input) return;
    const ac = $('#ac'); ac.replaceChildren();
    if (!res.length) { ac.append(h('div', { class: 'muted' }, 'Nessuna voce nel dataset CosIng locale — INCI libero ammesso')); }
    for (const r of res) ac.append(h('div', { role: 'option', onmousedown: e => { e.preventDefault(); pick(ing, r, input, badge, tr); } }, r.inci_name, h('small', {}, [r.functions, r.cas && 'CAS ' + r.cas].filter(Boolean).join(' · '))));
    position(ac, input); ac.hidden = false;
  }, 180);
}
function pick(ing, r, input, badge, tr) {
  ing.inci = r.inci_name; ing.cosing_ref = r.ref || ''; input.value = r.inci_name; setBadge(ing, badge, 'verified');
  if (!ing.function && r.functions) { ing.function = r.functions.toLowerCase().slice(0, 200); tr.querySelector('[data-k=function]').value = ing.function; }
  hideAc(); scheduleSave();
}
async function verifyIngredient(ing, tr, anchor) {
  const name = (ing.inci || ing.trade_name || '').trim(); const pop = $('#inci-pop');
  if (name.length < 2) { pop.replaceChildren(h('p', {}, 'Ingrediente senza INCI: ammesso. Inserisci un nome per cercare nel dataset CosIng.')); position(pop, anchor); pop.hidden = false; return; }
  pop.replaceChildren(h('p', {}, 'Verifica in corso…')); position(pop, anchor); pop.hidden = false;
  try {
    const v = await api('/inci/verify?name=' + encodeURIComponent(name) + '&live=1');
    const out = [];
    const link = (u, t) => h('a', { href: u, target: '_blank', rel: 'noopener noreferrer' }, t);
    if (v.verdict === 'verified') {
      const badge = tr.querySelector('.badge'); ing.inci = v.match.inci_name; ing.cosing_ref = v.match.ref || ''; tr.querySelector('[data-k=inci]').value = ing.inci; setBadge(ing, badge, 'verified'); scheduleSave();
      out.push(h('p', {}, h('strong', {}, '✔ ' + v.match.inci_name), h('br'), [v.match.functions, v.match.cas && 'CAS ' + v.match.cas, v.match.ec && 'EC ' + v.match.ec].filter(Boolean).join(' · '), v.match.restriction ? h('br') : null, v.match.restriction && 'Restrizioni: ' + v.match.restriction));
    } else if (v.verdict === 'dataset_missing') out.push(h('p', { class: 'warn' }, 'Dataset CosIng non caricato.'));
    else if (v.verdict === 'similar') {
      out.push(h('p', {}, 'Nessuna corrispondenza esatta. Voci simili (clic per applicare):'));
      for (const s of v.suggestions) out.push(h('div', { class: 'ac', style: 'position:static;box-shadow:none;border:0' }, h('div', { onclick: () => { pick(ing, s, tr.querySelector('[data-k=inci]'), tr.querySelector('.badge'), tr); pop.hidden = true; } }, s.inci_name)));
    } else out.push(h('p', {}, 'Non trovato nel dataset locale: l’INCI resta “da verificare”. Controlla sul sito ufficiale.'));
    out.push(h('p', { class: 'muted' }, `Dataset: ${v.dataset.label || '—'} (${v.dataset.count ?? 0} voci)`));
    if (v.live) out.push(h('p', { class: 'muted' }, v.live.available ? `Lookup online ${v.live.host}: ${v.live.found ? 'trovato' : 'non trovato'}` : `Lookup online non disponibile (${v.live.reason}).`));
    out.push(h('p', {}, 'Siti ufficiali: ', link(v.links.search_url, 'CosIng (CE)'), ' · ', link(v.links.dataset, 'Dataset UE'), ' · ', link(v.links.regulation, 'Reg. 1223/2009')));
    pop.replaceChildren(...out);
  } catch (e) { pop.replaceChildren(h('p', { class: 'warn' }, e.message)); }
}
async function verifyAll() {
  let ok = 0, n = 0;
  for (const [i, ing] of S.current.ingredients.entries()) {
    if (!ing.inci.trim()) continue; n++;
    try { const v = await api('/inci/verify?name=' + encodeURIComponent(ing.inci)); if (v.verdict === 'verified') { ing.inci = v.match.inci_name; ing.cosing_ref = v.match.ref || ''; ing.inci_status = 'verified'; ok++; } else ing.inci_status = 'unverified'; } catch { /* continua */ }
    void i;
  }
  scheduleSave(); renderSheet(); toast(`INCI verificati: ${ok}/${n} (dataset CosIng locale)`);
}
document.addEventListener('click', e => { const p = $('#inci-pop'); if (!p.hidden && !p.contains(e.target) && !e.target.closest('.badge')) p.hidden = true; });

// ---- editor ----
function initEditor() {
  const toolbar = [[{ header: [1, 2, 3, false] }], ['bold', 'italic', 'underline', 'strike'], [{ list: 'ordered' }, { list: 'bullet' }, { indent: '-1' }, { indent: '+1' }], [{ align: [] }], ['blockquote', 'link'], ['clean']];
  S.quill = new window.Quill('#editor', { theme: 'snow', modules: { toolbar }, placeholder: 'Descrivi il processo preparativo: fasi, temperature, tempi, agitazione…' });
  const safe = window.DOMPurify.sanitize(S.current.process_html || '', { USE_PROFILES: { html: true }, FORBID_ATTR: ['style'], ALLOWED_URI_REGEXP: /^(?:https?|mailto):/i });
  S.quill.setContents(S.quill.clipboard.convert({ html: safe }), 'silent');
  S.quill.on('text-change', (_d, _o, src) => { if (src === 'user') { setState('Modifiche non salvate…'); saveProcess(); } });
}
// Quill: i link possono solo http/https/mailto
window.Quill?.import('formats/link') && (window.Quill.import('formats/link').PROTOCOL_WHITELIST = ['http', 'https', 'mailto']);

// ---- allegati ----
const ICON = { doc: '📄', data: '📊' };
function fileCard(fl) {
  const url = `/api/projects/${S.active}/files/${fl.id}/raw`;
  const media = fl.kind === 'image' ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, h('img', { src: url, alt: fl.caption || fl.original_name, loading: 'lazy' }))
    : fl.kind === 'video' ? h('video', { src: url, controls: true, preload: 'metadata' })
    : h('div', { class: 'ficon' }, ICON[fl.kind] || '📎');
  return h('div', { class: 'card' }, media, h('div', { class: 'nm' }, fl.original_name, ' · ', (fl.size >= 1048576 ? `${(fl.size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(fl.size / 1024))} KB`)),
    h('input', { value: fl.caption, placeholder: 'Didascalia', maxlength: 500, 'aria-label': 'Didascalia', onchange: e => api(`${qs()}/files/${fl.id}`, { method: 'PATCH', body: { caption: e.target.value } }).catch(err => toast(err.message)) }),
    h('div', { class: 'row' }, h('a', { class: 'btn small', href: url + (fl.kind === 'image' || fl.kind === 'video' || fl.mime === 'application/pdf' ? '' : '?download=1'), target: '_blank', rel: 'noopener noreferrer' }, fl.kind === 'doc' || fl.kind === 'data' ? 'Apri / scarica' : 'Apri'),
      h('button', { class: 'btn small danger', onclick: async () => { if (!confirm('Eliminare l’allegato?')) return; await api(`${qs()}/files/${fl.id}`, { method: 'DELETE' }); S.current.files = S.current.files.filter(x => x.id !== fl.id); renderGallery(); } }, 'Elimina')));
}
function renderGallery() { const g = $('#gallery'); g.replaceChildren(...S.current.files.map(fileCard)); }
function buildFiles() {
  const status = h('div', { class: 'muted', role: 'status' });
  const input = h('input', { type: 'file', multiple: true, hidden: true, accept: '.jpg,.jpeg,.png,.gif,.webp,.avif,.mp4,.mov,.webm,.pdf,.docx,.xlsx,.pptx,.odt,.ods,.txt,.md,.csv,.json', onchange: () => up(input.files) });
  const drop = h('div', { class: 'drop', ondragover: e => { e.preventDefault(); drop.classList.add('over'); }, ondragleave: () => drop.classList.remove('over'), ondrop: e => { e.preventDefault(); drop.classList.remove('over'); up(e.dataTransfer.files); } },
    'Trascina qui i file (immagini, video mp4/webm/mov, PDF, docx, xlsx, pptx, odt/ods, txt, md, csv, json) oppure ', h('button', { class: 'btn small', onclick: () => input.click() }, 'sfoglia'), input, status);
  function up(files) {
    if (!files.length) return; const fd = new FormData(); for (const f of files) fd.append('files', f);
    const x = new XMLHttpRequest(); x.open('POST', `/api/projects/${S.active}/formulas/${S.current.id}/files`);
    x.upload.onprogress = e => { status.textContent = `Caricamento… ${Math.round(e.loaded / e.total * 100)}%`; };
    x.onload = () => { let j = {}; try { j = JSON.parse(x.responseText); } catch { /* */ }
      if (j.created?.length) { S.current.files.push(...j.created); renderGallery(); }
      status.textContent = (j.errors?.length ? 'Rifiutati: ' + j.errors.map(e => `${e.name} (${e.error})`).join('; ') : j.created?.length ? 'Caricamento completato' : j.error || 'Errore'); };
    x.onerror = () => { status.textContent = 'Errore di rete'; };
    x.send(fd);
  }
  const wrap = h('div', {}, drop, h('div', { id: 'gallery', class: 'gallery' }));
  queueMicrotask(renderGallery);
  return wrap;
}

async function dupFormula() { await flushSave(); const n = await api(`${qs()}/formulas/${S.current.id}/duplicate`, { method: 'POST' }); await loadFormulas(); await openFormula(n.id); }
async function delFormula() { if (!confirm(`Eliminare “${S.current.name}” e i suoi allegati?`)) return; await api(`${qs()}/formulas/${S.current.id}`, { method: 'DELETE' }); dirty = false; S.current = null; sel[S.active] = null; await activate(S.active); }

// ---------------- barra superiore ----------------
$('#btn-new-project').onclick = async () => { const n = await ask('Nome del nuovo progetto'); if (n) { const p = await api('/projects', { method: 'POST', body: { name: n } }); await loadProjects(); await openProject(p.slug); } };
$('#btn-new-formula').onclick = async () => { if (!S.active) return toast('Apri prima un progetto'); await flushSave(); const f = await api(`${qs()}/formulas`, { method: 'POST', body: { name: 'Nuova formula' } }); await loadFormulas(); await openFormula(f.id); };
$('#formula-filter').oninput = renderList;
$('#btn-info').onclick = () => $('#dlg-info').showModal();
$('#btn-open-project').onclick = async () => {
  await loadProjects(); const ul = $('#project-list'); ul.replaceChildren();
  for (const p of S.projects) ul.append(h('li', {}, h('span', { class: 'nm' }, p.name, h('small', { class: 'muted' }, ` · ${p.formulas} formule`)),
    h('button', { class: 'btn small primary', onclick: () => { $('#dlg-projects').close(); openProject(p.slug); } }, S.open.includes(p.slug) ? 'Vai' : 'Apri'),
    h('button', { class: 'btn small', onclick: async () => { const n = await ask('Rinomina progetto', p.name); if (n) { await api(`/projects/${p.slug}`, { method: 'PATCH', body: { name: n } }); $('#dlg-projects').close(); await activate(S.active); $('#btn-open-project').click(); } } }, 'Rinomina'),
    h('button', { class: 'btn small danger', onclick: async () => { if (!confirm(`Eliminare definitivamente “${p.name}” con tutte le formule e gli allegati?`)) return; await api(`/projects/${p.slug}?confirm=${p.slug}`, { method: 'DELETE' }); S.open = S.open.filter(s => s !== p.slug); if (S.active === p.slug) S.active = S.open[0] || null; $('#dlg-projects').close(); await activate(S.active); } }, 'Elimina')));
  if (!S.projects.length) ul.append(h('li', {}, 'Nessun progetto.'));
  $('#dlg-projects').showModal();
};
$('#btn-backup').onclick = () => { $('#bk-msg').textContent = ''; $('#dlg-backup').showModal(); };
const dl = u => { const a = h('a', { href: u }); document.body.append(a); a.click(); a.remove(); };
$('#bk-all').onclick = () => dl('/api/export-all');
$('#bk-json').onclick = async () => { if (S.active) { await flushSave(); dl(`/api/projects/${S.active}/export?format=json`); } };
$('#bk-zip').onclick = async () => { if (S.active) { await flushSave(); dl(`/api/projects/${S.active}/export?format=zip`); } };
$('#bk-import').onchange = async e => {
  const f = e.target.files[0]; if (!f) return; const fd = new FormData(); fd.append('file', f); $('#bk-msg').textContent = 'Importazione…';
  try { const r = await api('/import', { method: 'POST', body: fd }); $('#bk-msg').textContent = `Importati: ${r.imported.map(p => p.name).join(', ')}`; await loadProjects(); for (const p of r.imported) if (!S.open.includes(p.slug)) S.open.push(p.slug); await activate(r.imported[0].slug); }
  catch (err) { $('#bk-msg').textContent = 'Errore: ' + err.message; } e.target.value = '';
};
window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); } });
document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });

async function refreshBanner() {
  const b = $('#banner');
  try { S.inci = await api('/inci/status'); } catch { return; }
  if (!S.inci.loaded || /seed/i.test(S.inci.label || '')) {
    b.hidden = false; b.className = 'banner';
    b.replaceChildren('Dataset INCI di esempio (', String(S.inci.count || 0), ' voci, non ufficiale). Per la verifica completa importa l’export CosIng: ',
      h('a', { href: S.inci.links.dataset, target: '_blank', rel: 'noopener noreferrer' }, 'dataset UE'), ' → ', h('code', {}, 'npm run import-cosing -- file.csv'));
  } else b.hidden = true;
}

(async function init() {
  const st = store.get(); Object.assign(sel, st.sel || {});
  await loadProjects(); await refreshBanner();
  S.open = (st.open || []).filter(s => S.projects.some(p => p.slug === s));
  const m = /^#\/([a-z0-9-]+)\/(\d+)$/.exec(location.hash);
  if (m && S.projects.some(p => p.slug === m[1])) { if (!S.open.includes(m[1])) S.open.push(m[1]); sel[m[1]] = Number(m[2]); S.active = m[1]; }
  else S.active = S.open.includes(st.active) ? st.active : S.open[0] || null;
  if (!S.active && S.projects.length) { S.open = [S.projects[0].slug]; S.active = S.open[0]; }
  renderTabs(); await activate(S.active);
})();
