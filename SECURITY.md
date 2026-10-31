# Security review — Cosformula 0.1.0

Modello di minaccia: app **locale, single-user, senza autenticazione**, bind `127.0.0.1`. **Non esporre in rete/Internet** senza reverse proxy con autenticazione (non inclusa).

| Area | Rischio | Controllo | Verifica |
|---|---|---|---|
| Rete | accesso da LAN | bind 127.0.0.1 (override solo con `HOST`) | — |
| DNS rebinding / CSRF | pagina web esterna che colpisce l'API locale | Host in allowlist; metodi non sicuri richiedono `Origin` = `Host`; nessun CORS | test `host e origin guard`, `Origin malformato` |
| XSS (processo) | HTML malevolo salvato/importato | `sanitize-html` server (allowlist tag/attr, solo http/https/mailto) + DOMPurify client prima del render; CSP `script-src 'self'`, no inline script | test `sanitizzazione XSS` + e2e (`onerror` non eseguito) |
| XSS (altri campi) | testo utente in DOM | DOM costruito con `textContent`/`createElement`, mai `innerHTML` su dati | code review |
| SQL injection | input in query | solo statement parametrizzati; FTS con token quotati | code review |
| Path traversal | slug/id/nomi file | slug `^[a-z0-9-]{1,63}$`, id numerici, file su disco = UUID + estensione allowlist, `insideRoot` | test `..%2Fx` |
| Upload | file eseguibili/travestiti | allowlist estensioni + magic bytes (`file-type`) / UTF-8 per testo; SVG/HTML/JS esclusi; limiti dimensione; quota progetto; serviti con `nosniff`, `Content-Type` fisso, CSP `sandbox`, `attachment` per i documenti | test `upload: allowlist` |
| Import ZIP/JSON | zip-slip, zip-bomb, JSON ostile | nessuna estrazione per nome (regex + percorso generato), max 5000 voci, tetto byte, `validateEntrySizes`; schema validato, HTML ri-sanitizzato, file ri-validati | test round-trip + rifiuti |
| Allegati nel processo | immagini/link esterni, tracking, riferimenti forgiati | `img`/`video` ammessi solo con `cosfile:<uuid.ext>` verificato contro i file del progetto (altri `src` eliminati); link solo http/https/mailto/`cosfile`; accesso per nome con regex UUID | test `allegati nel processo` |
| Export/stampa | XSS nella pagina generata | tutto il testo è escapato; il processo è ri-sanitizzato prima del render; CSP `script-src 'self'` (solo `/print.js`); `ids`/`size` validati | test `stampa` (escape, ids non validi) |
| Integrità INCI | stato "verificato" falsificabile | assegnato solo dal server dopo match esatto nel dataset | test CRUD |
| SSRF | lookup live | solo `COSING_LIVE_URL` configurato dall'operatore, https, `redirect:'error'`, timeout 8 s | code review |
| DoS | richieste/upload massivi | rate limit, limiti multer/JSON | — |
| Info disclosure | stack trace | error handler generico | — |
| Dipendenze | CVE | `npm audit --omit=dev`; `archiver` sostituito con `yazl` (evita minimatch vulnerabile) | vedi sotto |

## Limiti noti
- Nessuna autenticazione/ruoli/cifratura a riposo: i file in `data/` sono in chiaro. Per dati confidenziali (NDA) usare cifratura del disco.
- Quill 2.0.3: advisory GHSA-v3m3-f69x-jf25 (low) riguarda `getSemanticHTML()`, **non usato**; l'HTML è comunque sanitizzato.
- Il PDF è mostrato dal visualizzatore del browser (superficie del viewer, non dell'app).
- I file mp4/webm/pdf sono validati dagli header, non decodificati completamente.
- Il seed INCI è non ufficiale: la verifica regolatoria richiede il dataset CosIng completo e il controllo del Reg. (CE) 1223/2009.
