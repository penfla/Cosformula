# Cosformula

Webapp **locale** per raccogliere formulazioni cosmetiche: una scheda per formula (tabella ingredienti con % / g modificabili, INCI verificabile su dataset CosIng, processo in rich text, allegati foto/video/documenti), più progetti apribili nella stessa sessione, backup JSON/ZIP.

## Avvio
```bash
npm install
npm start          # http://localhost:3000  (bind 127.0.0.1)
npm test           # 8 test API/sicurezza
```
Dati in `data/projects/<slug>/project.db` (SQLite, 1 file = 1 progetto) e `data/projects/<slug>/uploads/`.
Variabili: `PORT`, `HOST`, `COSFORMULA_DATA` (cartella dati), `COSFORMULA_ALLOWED_HOSTS` (host extra, separati da virgola), `COSING_LIVE_URL` (vedi sotto).

## Verifica INCI (fonti ufficiali)
- Al primo avvio viene caricato un **seed minimale NON ufficiale** (148 nomi INCI comuni, `data/cosing-seed.csv`); l'interfaccia mostra un avviso finché non si importa il dataset completo.
- Dataset completo: scarica il CSV "COSING Ingredients – Fragrance Inventory" da https://data.europa.eu/data/datasets/cosmetic-ingredient-database-ingredients-and-fragrance-inventory (portale: https://single-market-economy.ec.europa.eu/sectors/cosmetics/cosmetic-ingredient-database_en), poi:
  ```bash
  npm run import-cosing -- percorso/COSING.csv --label "CosIng 2026-10"
  ```
- Stato **✔ verificato** = corrispondenza esatta (case-insensitive) con una voce del dataset; assegnato **solo dal server**. **⚠ da verificare** = INCI libero. **∅ senza INCI** = ammesso.
- Lookup online opzionale: l'endpoint live di CosIng non è documentato come API pubblica stabile; impostare `COSING_LIVE_URL` (https, con `{q}` come segnaposto) per attivarlo. Senza, il popup di verifica offre i link ufficiali (CosIng, dataset UE, Reg. CE 1223/2009: https://eur-lex.europa.eu/eli/reg/2009/1223/oj).

## Allegati
Allowlist: jpg, png, gif, webp, avif, mp4, mov, webm, pdf, docx, xlsx, pptx, odt, ods, txt, md, csv, json. Contenuto verificato con magic bytes; SVG/HTML/JS esclusi. Limiti: 500 MB video, 50 MB altri, 5 GB per progetto.

## Backup
`Database` → export progetto (JSON dati / ZIP con allegati), export di tutti i progetti, import JSON/ZIP (crea nuovi progetti).

Sicurezza: vedi [SECURITY.md](SECURITY.md).

---
© Flavio Pendolino, 2026. Questo documento è distribuito con licenza CC BY-NC 4.0 (creativecommons.org/licenses/by-nc/4.0) · Codice: PolyForm Noncommercial 1.0.0 (https://polyformproject.org/licenses/noncommercial/1.0.0)

```
Author: Flavio Pendolino
Version: 0.1.0
License: PolyForm Noncommercial 1.0.0
Commercial use: penfla@me.com
Purpose: archivio locale di formulazioni cosmetiche
Method: Node.js + SQLite; verifica INCI su dataset CosIng locale
Disclaimer: validate the results against your own reference samples before any analytical, engineering, safety or regulatory use.
Third-party components: express, better-sqlite3, multer, file-type, sanitize-html, helmet, yazl, yauzl, csv-parse, Quill, DOMPurify
Scientific references: Reg. (CE) 1223/2009 https://eur-lex.europa.eu/eli/reg/2009/1223/oj
AI disclosure: questo strumento esegue calcoli deterministici; non genera contenuto tramite IA generativa (art. 50 AI Act non applicabile).
```
