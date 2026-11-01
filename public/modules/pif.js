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

import { PRESETS, toxRows, productExposure, dailyAmount, ingredientPercent, MOS_MIN } from '/shared/pifcalc.js';

const MOS_TXT = { ok: '✔ conforme', low: '⚠ < 100', nodata: 'NOAEL mancante', nocalc: '—' };
const plain = html => String(html || '').replace(/<[^>]*>/g, '').trim();

/** Sezione PIF (Reg. CE 1223/2009 art. 11 + Allegato I): dati generali, sezioni con dati live dalla scheda formula, checklist. */
export function createPif(ctx) {
  const { h, api, S, qs, debounce, fmt, parseNum, toast, makeEditor, fromUrl, toUrl } = ctx;

  async function render(root) {
    root.replaceChildren(h('p', { class: 'muted' }, 'Caricamento PIF…'));
    let c;
    try { c = await api(`${qs()}/formulas/${S.current.id}/pif`); } catch (e) { root.replaceChildren(h('p', { class: 'warn' }, e.message)); return; }
    const data = c.data, f = c.formula, fid = f.id, slug = S.active;
    const quills = {}, secDirty = {}, deb = {}, autos = [], inputs = {};
    let dataDirty = false;

    // ---- salvataggio
    const saveData = debounce(async () => {
      dataDirty = false;
      try { await api(`/projects/${slug}/formulas/${fid}/pif/data`, { method: 'PUT', body: { data } }); ctx.setState('PIF salvato ' + new Date().toLocaleTimeString()); }
      catch (e) { dataDirty = true; ctx.setState('Errore PIF: ' + e.message); }
    }, 700);
    const touchData = () => { dataDirty = true; ctx.setState('Modifiche PIF non salvate…'); saveData(); recompute(); };
    const saveSection = async key => {
      if (!secDirty[key]) return; secDirty[key] = false;
      try { const r = await api(`/projects/${slug}/formulas/${fid}/pif/sections/${key}`, { method: 'PUT', body: { html: fromUrl(quills[key].root.innerHTML) } }); c.sections[key] = r.html; ctx.setState('PIF salvato ' + new Date().toLocaleTimeString()); recompute(); }
      catch (e) { secDirty[key] = true; ctx.setState('Errore PIF: ' + e.message); }
    };
    S.pifFlush = async () => {
      saveData.flush(); if (dataDirty) { dataDirty = false; await api(`/projects/${slug}/formulas/${fid}/pif/data`, { method: 'PUT', body: { data } }).catch(() => {}); }
      for (const k of Object.keys(quills)) { deb[k]?.flush(); await saveSection(k); }
    };

    // ---- campi
    const fld = (label, key, o = {}) => {
      const el = o.textarea ? h('textarea', { rows: 2, maxlength: o.max || 500 }) : o.select ? h('select', {}, ...o.select.map(v => h('option', { value: v }, v || '—'))) : h('input', { type: 'text', maxlength: o.max || 200, inputmode: o.num ? 'decimal' : null });
      el.value = o.num ? fmt(data[key]) : data[key] ?? ''; el.setAttribute('aria-label', label); inputs[key] = el;
      el.addEventListener(o.select ? 'change' : 'input', () => { data[key] = o.num ? parseNum(el.value) : el.value; if (key === 'preset') return; touchData(); });
      return h('label', { class: 'fld' + (o.wide ? ' wide' : '') }, label, el);
    };
    const preset = h('select', { 'aria-label': 'Categoria prodotto (valori di default SCCS)', onchange: e => {
      const p = PRESETS.find(x => x.id === e.target.value); if (!p) return;
      data.daily_amount_g = p.daily_g; data.retention_factor = p.rf; data.preset = p.id; inputs.daily_amount_g.value = fmt(p.daily_g); inputs.retention_factor.value = fmt(p.rf); touchData();
    } }, h('option', { value: '' }, '— carica valori di default per categoria —'), ...PRESETS.map(p => h('option', { value: p.id }, `${p.label}: ${p.daily_g} g/giorno, RF ${p.rf}`)));
    const fs = (title, ...kids) => h('fieldset', { class: 'fs2' }, h('legend', {}, title), h('div', { class: 'grid2' }, ...kids));

    // ---- blocchi automatici (dati live)
    const T = (head, rows, nums = []) => h('div', { class: 'tblwrap' }, h('table', { class: 'ing small' }, h('thead', {}, h('tr', {}, head.map((t, i) => h('th', { class: nums.includes(i) ? 'n' : '' }, t)))),
      h('tbody', {}, rows.length ? rows.map(r => h('tr', {}, r.map((v, i) => h('td', { class: nums.includes(i) ? 'n' : '' }, v)))) : [h('tr', {}, h('td', { colspan: head.length, class: 'muted' }, 'Nessun dato'))])));
    const KV = rows => T(['Parametro', 'Valore'], rows.filter(([, v]) => v !== '' && v != null));
    const percentOf = r => ingredientPercent(r, f.batch_g);
    const gA = () => dailyAmount(data), A = () => productExposure(data);
    const AUTO = {
      descr: () => KV([['Prodotto', data.product_name || f.name], ['Formula', `${f.code || '—'} · v${f.version}`], ['Categoria', data.category], ['Forma cosmetica', data.form], ['Confezionamento', data.packaging], ['Durata / PAO', [data.shelf_life, data.pao].filter(Boolean).join(' / ')], ['Notifica CPNP', data.cpnp_ref], ['Persona responsabile', [data.rp_name, data.rp_address].filter(Boolean).join(' — ')], ['Fabbricante', [data.manuf_name, data.manuf_address].filter(Boolean).join(' — ')]]),
      a1: () => T(['#', 'Ingrediente', 'INCI', 'CAS / EC', 'Funzione', '%', 'Restrizioni (CosIng)'], c.rows.map((r, i) => {
        const m = r.material || {}, cs = r.cosing || {};
        return [i + 1, r.trade_name + (r.supplier ? ` (${r.supplier})` : ''), (r.inci || '—') + (r.inci_status === 'unverified' ? ' ⚠' : ''), [m.cas || cs.cas, m.ec || cs.ec].filter(Boolean).join(' / '), r.function || m.function || cs.functions || '', fmt(percentOf(r)), cs.restriction || ''];
      }), [5]),
      a4: () => T(['Ingrediente', 'Titolo %', 'Impurezze / tracce', 'Allergeni'], c.rows.filter(r => r.material).map(r => [r.trade_name, fmt(r.material.active_pct), r.material.impurities, r.material.allergens])),
      a5: () => KV([['Uso previsto', data.intended_use], ['Popolazione target', data.target_population], ['Sito di applicazione', data.site_of_application]]),
      a6: () => KV([['Quantità per applicazione (g)', fmt(data.amount_per_application_g)], ['Applicazioni/giorno', fmt(data.frequency_per_day)], ['Quantità giornaliera (g/giorno)', fmt(gA())], ['RF', fmt(data.retention_factor ?? 1)], ['Peso corporeo (kg)', fmt(data.body_weight_kg || 60)], ['Esposizione al prodotto A (mg/kg pc/giorno)', A() == null ? '' : fmt(Math.round(A() * 1000) / 1000)]]),
      a7: () => tox(false), a8: () => tox(true),
      gmp: () => { const d = h('div', { class: 'proc' }); d.innerHTML = window.DOMPurify.sanitize(toUrl(f.process_html || ''), { USE_PROFILES: { html: true }, FORBID_ATTR: ['style'], ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|\/api\/projects\/)/i }) || '—'; return h('div', {}, h('p', { class: 'muted' }, 'Processo di fabbricazione dalla scheda formula (modificabile nella scheda):'), d); },
    };
    function tox(full) {
      const rows = toxRows(c.rows, data, f.batch_g).filter(x => x.conc != null);
      return h('div', {}, T(full ? ['Ingrediente', 'C sostanza %', 'NOAEL mg/kg/g', 'DA %', 'SED mg/kg/g', 'MoS', 'Esito'] : ['Ingrediente', 'C sostanza %', 'DA %', 'SED mg/kg/g'],
        rows.map(x => { const base = [x.name + (x.inci && x.inci !== x.name ? ` (${x.inci})` : ''), fmt(Math.round(x.conc * 10000) / 10000)]; const abs = x.abs == null ? '100 (default)' : fmt(x.abs), s = x.sed == null ? '' : fmt(Math.round(x.sed * 10000) / 10000);
          return full ? [...base, fmt(x.noael) + (x.noael_ref ? ` · ${x.noael_ref}` : ''), abs, s, x.mos == null ? '' : fmt(Math.round(x.mos * 10) / 10), MOS_TXT[x.status]] : [...base, abs, s]; }), full ? [1, 2, 3, 4, 5] : [1, 2, 3]),
        h('p', { class: 'muted' }, `SED = A × C/100 × DA/100 · MoS = NOAEL/SED · soglia indicativa ${MOS_MIN}. NOAEL e assorbimento dermico si inseriscono nella scheda della materia prima. Valori indicativi: la valutazione spetta al valutatore della sicurezza (art. 10).`));
    }
    const recompute = () => { for (const a of autos) a.el.replaceChildren(a.fn()); renderCheck(); };

    // ---- checklist
    const check = h('div', { class: 'check' });
    function renderCheck() {
      const linked = c.rows.filter(r => r.material), tx = toxRows(c.rows, data, f.batch_g);
      const filled = c.sectionDefs.filter(s => plain(c.sections[s.key])).length;
      const items = [
        [data.rp_name && data.rp_address, 'Persona responsabile: nome e indirizzo (art. 4, 11)'],
        [data.manuf_name && data.gmp_standard, 'Fabbricante e standard GMP (art. 8)'],
        [data.assessor_name && data.assessor_qualification, 'Valutatore della sicurezza e qualifica (art. 10(2))'],
        [gA() != null, 'Esposizione: quantità giornaliera definita'],
        [c.rows.length && c.rows.every(r => r.inci), `Ingredienti con INCI (${c.rows.filter(r => !r.inci).length} senza INCI: ammessi, ma verificare A.1)`],
        [c.rows.every(r => !r.inci || r.inci_status === 'verified'), `INCI verificati su CosIng (${c.rows.filter(r => r.inci && r.inci_status !== 'verified').length} da verificare)`],
        [c.rows.length && linked.length === c.rows.length, `Ingredienti collegati a una materia prima (${c.rows.length - linked.length} non collegati)`],
        [linked.length && linked.every(r => r.sds), `SDS presente (${linked.filter(r => !r.sds).length} mancanti tra le materie prime collegate)`],
        [linked.length && linked.every(r => r.tds), `TDS presente (${linked.filter(r => !r.tds).length} mancanti)`],
        [tx.length && tx.every(x => x.status !== 'nodata'), `NOAEL disponibile (${tx.filter(x => x.status === 'nodata').length} ingredienti senza NOAEL: acqua e sostanze innocue possono non richiederlo, da motivare in A.8)`],
        [!tx.some(x => x.status === 'low'), `MoS ≥ ${MOS_MIN} per tutte le sostanze calcolabili (${tx.filter(x => x.status === 'low').length} sotto soglia)`],
        [filled === c.sectionDefs.length, `Sezioni con testo: ${filled}/${c.sectionDefs.length}`],
      ];
      check.replaceChildren(h('strong', {}, `Completezza: ${items.filter(i => i[0]).length}/${items.length}`), h('ul', {}, items.map(([ok, t]) => h('li', { class: ok ? 'ok' : 'miss' }, (ok ? '✔ ' : '⚠ ') + t))));
    }

    // ---- sezioni
    const secEls = c.sectionDefs.map(sec => {
      const autoEl = h('div', { class: 'autoblk' }), edit = h('div', { class: 'editorwrap' }); const ed = h('div');
      edit.append(ed);
      if (AUTO[sec.key]) autos.push({ el: autoEl, fn: AUTO[sec.key] });
      const d = h('details', { class: 'secd', id: 'pif-' + sec.key }, h('summary', {}, h('span', { class: 'grp' }, sec.group), ' ', sec.title), h('p', { class: 'muted' }, sec.hint), autoEl, h('div', { class: 'muted small' }, 'Testo e allegati:'), edit);
      d.addEventListener('toggle', () => {
        if (!d.open || quills[sec.key]) return;
        deb[sec.key] = debounce(() => saveSection(sec.key), 900);
        quills[sec.key] = makeEditor(ed, c.sections[sec.key], () => { secDirty[sec.key] = true; ctx.setState('Modifiche PIF non salvate…'); deb[sec.key](); }, 'Testo libero della sezione… (foto e file con 📎, trascinamento o incolla)');
      });
      return d;
    });
    const annexEl = h('div', { class: 'autoblk' });
    autos.push({ el: annexEl, fn: () => T(['Ingrediente', 'Fornitore', 'SDS', 'TDS'], c.rows.map(r => { const m = r.material; const cell = x => (x ? `✔ ${x.original_name}${x.revision ? ' · rev. ' + x.revision : ''}${x.doc_date ? ' · ' + x.doc_date : ''}` : '✗ mancante'); return [r.trade_name, r.supplier, m ? cell(r.sds) : 'non collegato', m ? cell(r.tds) : 'non collegato']; })) });

    const printUrl = extra => `/api/projects/${slug}/formulas/${fid}/pif/print?${extra}`;
    root.replaceChildren(
      h('p', { class: 'muted' }, 'Product Information File secondo il Reg. (CE) 1223/2009, art. 11 e Allegato I (relazione sulla sicurezza, parti A e B). I dati di formula, ingredienti, materie prime (SDS/TDS, NOAEL) e processo sono collegati in tempo reale; ogni sezione ha inoltre un campo di testo libero con foto e file.'),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn small primary', onclick: async () => { await S.pifFlush(); window.open(printUrl('size=A4&autoprint=1'), '_blank', 'noopener'); } }, 'PIF → PDF / Stampa'),
        h('button', { class: 'btn small', onclick: async () => { await S.pifFlush(); ctx.dl(printUrl('download=1')); } }, 'PIF → HTML'),
        h('button', { class: 'btn small', onclick: () => secEls.forEach(d => { d.open = true; }) }, 'Espandi tutto'),
        h('button', { class: 'btn small', onclick: () => secEls.forEach(d => { d.open = false; }) }, 'Comprimi tutto')),
      h('details', { class: 'secd', open: true }, h('summary', {}, 'Dati generali del PIF'),
        fs('Prodotto', fld('Nome del prodotto', 'product_name'), fld('Versione PIF', 'pif_version', { max: 20 }), fld('Stato', 'pif_status', { select: ['', 'bozza', 'in revisione', 'finale'] }), fld('Categoria', 'category', { max: 100 }), fld('Forma cosmetica', 'form', { max: 100 }),
          fld('Confezionamento (primario/secondario, materiali)', 'packaging', { wide: true }), fld('Durata minima (se < 30 mesi)', 'shelf_life', { max: 100 }), fld('PAO (mesi)', 'pao', { max: 50 }), fld('Notifica CPNP (rif.)', 'cpnp_ref', { max: 100 })),
        fs('Persona responsabile e fabbricante', fld('Persona responsabile', 'rp_name'), fld('Indirizzo PR (art. 4)', 'rp_address', { wide: true }), fld('Fabbricante / sito', 'manuf_name'), fld('Indirizzo fabbricante', 'manuf_address', { wide: true }), fld('Standard GMP (art. 8)', 'gmp_standard', { max: 200 })),
        fs('Uso ed esposizione (A.5–A.7)', fld('Uso previsto', 'intended_use', { wide: true, textarea: true, max: 1000 }), fld('Popolazione target', 'target_population'), fld('Sito di applicazione', 'site_of_application'),
          h('label', { class: 'fld wide' }, 'Valori di default per categoria', preset), fld('Quantità per applicazione (g)', 'amount_per_application_g', { num: true, max: 12 }), fld('Applicazioni al giorno', 'frequency_per_day', { num: true, max: 12 }),
          fld('Quantità giornaliera (g/giorno) — sovrascrive il prodotto delle due precedenti', 'daily_amount_g', { num: true, max: 12 }), fld('Fattore di ritenzione RF', 'retention_factor', { num: true, max: 12 }), fld('Peso corporeo (kg, default 60)', 'body_weight_kg', { num: true, max: 12 })),
        fs('Valutatore della sicurezza (B.4)', fld('Nome', 'assessor_name'), fld('Qualifica (art. 10(2): laurea in farmacia, tossicologia, medicina o equivalente)', 'assessor_qualification', { wide: true }), fld('Indirizzo', 'assessor_address', { wide: true }), fld('Data della valutazione', 'assessment_date', { max: 20 }))),
      check, h('div', { class: 'secs' }, ...secEls),
      h('details', { class: 'secd' }, h('summary', {}, h('span', { class: 'grp' }, 'Allegati'), ' Schede di sicurezza (SDS) e tecniche (TDS) delle materie prime'), annexEl));
    secEls[0].open = true;
    recompute();
  }
  return { render };
}
