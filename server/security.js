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

import path from 'node:path';
import fs from 'node:fs';
import sanitizeHtml from 'sanitize-html';
import { fileTypeFromFile } from 'file-type';

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const ID_RE = /^[1-9]\d{0,11}$/;
export const STORED_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{2,5}$/;

export function slugify(name) {
  const s = String(name || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
  return s || 'progetto';
}

export function str(v, max = 200) {
  return String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
}

export function num(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 && n < 1e9 ? n : null;
}

export const FILE_REF = 'cosfile:';
const REF_RE = /cosfile:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{2,5})/g;
/** Nomi file (stored_name) referenziati nel processo tramite `cosfile:<uuid>.<ext>`. */
export const refsIn = html => new Set([...String(html || '').matchAll(REF_RE)].map(m => m[1]));

/**
 * Processo preparativo: allowlist di tag/attributi compatibili con Quill, link solo http/https/mailto.
 * Immagini/video/link a file del progetto: solo come riferimento `cosfile:<stored_name>`; con `allowed` (Set)
 * i riferimenti a file inesistenti vengono rimossi.
 */
export function cleanHtml(html, allowed = null) {
  const ok = v => typeof v === 'string' && v.startsWith(FILE_REF) && STORED_RE.test(v.slice(FILE_REF.length)) && (!allowed || allowed.has(v.slice(FILE_REF.length)));
  return sanitizeHtml(String(html ?? '').slice(0, 1_000_000), {
    allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'h1', 'h2', 'h3', 'ul', 'ol', 'li',
      'blockquote', 'pre', 'code', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img', 'video'],
    allowedAttributes: { a: ['href', 'title', 'target', 'rel'], li: ['data-list'], img: ['src', 'alt'], video: ['src', 'controls', 'preload'], '*': ['class'] },
    allowedClasses: { '*': [/^ql-(indent-\d|align-(center|right|justify)|syntax|code-block)$/] },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['cosfile'], video: ['cosfile'], a: ['http', 'https', 'mailto', 'cosfile'] },
    allowProtocolRelative: false,
    transformTags: {
      a: (tag, attribs) => {
        const a = { ...attribs, rel: 'noopener noreferrer', target: '_blank' };
        if (a.href?.startsWith(FILE_REF) && !ok(a.href)) delete a.href;
        return { tagName: 'a', attribs: a };
      },
    },
    exclusiveFilter: f => (f.tag === 'img' || f.tag === 'video') && !ok(f.attribs.src),
  });
}

export function insideRoot(root, p) {
  const r = path.resolve(root) + path.sep;
  return (path.resolve(p) + path.sep).startsWith(r) || path.resolve(p) === path.resolve(root);
}

// ext -> { kind, mime, detected: accepted file-type exts (binary) | null (text) }
export const ALLOWED = {
  jpg: { kind: 'image', mime: 'image/jpeg', detected: ['jpg'] },
  jpeg: { kind: 'image', mime: 'image/jpeg', detected: ['jpg'] },
  png: { kind: 'image', mime: 'image/png', detected: ['png', 'apng'] },
  gif: { kind: 'image', mime: 'image/gif', detected: ['gif'] },
  webp: { kind: 'image', mime: 'image/webp', detected: ['webp'] },
  avif: { kind: 'image', mime: 'image/avif', detected: ['avif'] },
  mp4: { kind: 'video', mime: 'video/mp4', detected: ['mp4', 'm4v'] },
  mov: { kind: 'video', mime: 'video/quicktime', detected: ['mov', 'mp4'] },
  webm: { kind: 'video', mime: 'video/webm', detected: ['webm', 'mkv'] },
  pdf: { kind: 'doc', mime: 'application/pdf', detected: ['pdf'] },
  docx: { kind: 'doc', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', detected: ['docx'] },
  xlsx: { kind: 'data', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', detected: ['xlsx'] },
  pptx: { kind: 'doc', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', detected: ['pptx'] },
  odt: { kind: 'doc', mime: 'application/vnd.oasis.opendocument.text', detected: ['odt'] },
  ods: { kind: 'data', mime: 'application/vnd.oasis.opendocument.spreadsheet', detected: ['ods'] },
  txt: { kind: 'doc', mime: 'text/plain; charset=utf-8', detected: null },
  md: { kind: 'doc', mime: 'text/plain; charset=utf-8', detected: null },
  csv: { kind: 'data', mime: 'text/plain; charset=utf-8', detected: null },
  json: { kind: 'data', mime: 'application/json; charset=utf-8', detected: null },
};
export const MAX_MEDIA = 500 * 1024 * 1024;
export const MAX_OTHER = 50 * 1024 * 1024;
export const MAX_PROJECT_BYTES = 5 * 1024 * 1024 * 1024;

export function extOf(name) {
  const m = /\.([A-Za-z0-9]{2,5})$/.exec(String(name || ''));
  return m ? m[1].toLowerCase() : '';
}

/** Validates extension, size and real content (magic bytes / UTF-8 text). Returns {ext, kind, mime} or throws. */
export async function validateUpload(filePath, originalName, size) {
  const ext = extOf(originalName);
  const rule = ALLOWED[ext];
  if (!rule) throw httpError(415, `Formato non consentito: .${ext || '?'}`);
  const limit = rule.kind === 'video' ? MAX_MEDIA : rule.kind === 'image' ? MAX_OTHER : MAX_OTHER;
  if (size > limit) throw httpError(413, 'File troppo grande');
  if (rule.detected) {
    const ft = await fileTypeFromFile(filePath);
    if (!ft || !rule.detected.includes(ft.ext)) throw httpError(415, 'Contenuto non coerente con l\'estensione');
  } else {
    const fd = fs.openSync(filePath, 'r');
    try {
      const buf = Buffer.alloc(Math.min(65536, size));
      fs.readSync(fd, buf, 0, buf.length, 0);
      if (buf.includes(0)) throw httpError(415, 'File di testo non valido');
      new TextDecoder('utf-8', { fatal: true }).decode(buf.subarray(0, buf.length - 3 > 0 ? buf.length - 3 : 0));
    } catch (e) {
      if (e.status) throw e;
      throw httpError(415, 'File di testo non UTF-8');
    } finally { fs.closeSync(fd); }
  }
  return { ext: ext === 'jpeg' ? 'jpg' : ext, kind: rule.kind, mime: rule.mime };
}

export function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
