# Cosformula

Webapp **locale** per raccogliere formulazioni cosmetiche: una scheda per formula (tabella ingredienti con % / g modificabili, INCI verificabile su dataset CosIng, processo in rich text, allegati foto/video/documenti), più progetti apribili nella stessa sessione, backup JSON/ZIP.

## Avvio rapido (ready to use)
Requisito unico: **Node.js ≥ 20** (https://nodejs.org/). Poi:

| Sistema | Azione |
|---|---|
| Windows | doppio clic su `start.bat` |
| macOS | doppio clic su `start.command` (la prima volta: tasto destro → Apri) |
| Linux / terminale | `./start.sh` oppure `npm install && npm start` |

Lo script installa le dipendenze al primo avvio, avvia il server e **apre il browser**. Al **primo avvio compare una procedura guidata** nella pagina web che:
1. crea il database (primo progetto, file SQLite in `data/projects/<slug>/project.db`);
2. carica il dataset INCI: esempio immediato (non ufficiale) oppure il CSV ufficiale CosIng da file;
3. opzionalmente inserisce una formula di esempio (valori indicativi, non validati).

Se la porta 3000 è occupata viene usata la successiva (3001…). Per chiudere: Ctrl+C nella finestra del terminale.
`npm test` esegue 13 test API/sicurezza (richiede `npm install` completo, con le devDependencies).
Dati in `data/` (da includere nei backup): `data/projects/…`, `data/cosing.db`, `data/config.json`.
Variabili: `PORT`, `HOST`, `COSFORMULA_DATA` (cartella dati), `COSFORMULA_ALLOWED_HOSTS` (host extra, separati da virgola), `COSING_LIVE_URL` (vedi sotto).

## Materie prime: SDS e TDS dei fornitori
Sezione **Materie prime** (selettore in alto nella barra laterale). Per ogni materia prima: identificazione (nome, INCI con autocompletamento CosIng, fornitore/codice, CAS/EC, titolo %), dati della **TDS** (aspetto, pH, densità, dose massima, note), dati della **SDS** (classificazione CLP/frasi H, allergeni, impurezze, **NOAEL**, fonte, **assorbimento dermico**) e i **documenti del fornitore** (SDS, TDS, CoA, altro) con data, revisione e lingua. Si caricano trascinando i file: il tipo è dedotto dal nome (es. `SDS_…`, `TDS_…`, `scheda tecnica`) e modificabile. Nella scheda formula l'ingrediente si **collega** a una materia prima (autocompletamento sul nome, oppure 📚+ per crearla dalla riga): compaiono i marcatori SDS✔/✗ e TDS✔/✗ e i dati vengono usati nel PIF.

## PIF — Product Information File (Reg. CE 1223/2009)
Nella scheda formula la scheda **PIF** contiene: dati generali (prodotto, persona responsabile, fabbricante/GMP, uso ed esposizione, valutatore) e le sezioni dell'**art. 11** e dell'**Allegato I** (relazione sulla sicurezza, Parte A punti 1–10 e Parte B punti 1–4; metodo di fabbricazione e GMP; prova degli effetti dichiarati; sperimentazione animale), ognuna con un editor di testo libero (con foto/file) e, dove applicabile, **dati collegati in tempo reale**:
- A.1 composizione quali-quantitativa (ingredienti, INCI, CAS/EC, funzione, %, restrizioni CosIng); A.4 impurezze e allergeni dalle materie prime; A.5–A.6 esposizione; A.7–A.8 **SED e MoS** per ingrediente; metodo di fabbricazione dal processo della scheda; allegato con SDS/TDS per ingrediente.
- Calcolo: `A = g/giorno × 1000 × RF / peso corporeo` (default 60 kg), `SED = A × C/100 × DA/100` (C = % ingrediente × titolo; DA default 100 %), `MoS = NOAEL/SED`, soglia indicativa 100. I valori di default per categoria (crema viso, lozione corpo, shampoo…) provengono dalle SCCS Notes of Guidance (SCCS/1647/22, https://health.ec.europa.eu/publications/sccs-notes-guidance-testing-cosmetic-ingredients-and-their-safety-evaluation-12th-revision_en): **verificarli sul documento originale** prima dell'uso.
- Una **checklist di completezza** segnala dati mancanti (PR, GMP, valutatore, INCI da verificare, ingredienti non collegati, SDS/TDS/NOAEL mancanti, MoS < 100, sezioni vuote).
- Esportazione: *PIF → PDF / Stampa* e *PIF → HTML* (stesso motore del booklet).
- **Limiti**: lo strumento organizza e calcola, non sostituisce la valutazione di un valutatore della sicurezza qualificato (art. 10) né la notifica CPNP (art. 13); il PIF va conservato 10 anni dall'ultimo lotto immesso sul mercato e reso accessibile alle autorità (art. 11(1)).

## Drag & drop
I file si possono rilasciare: **nell'editor** (processo e sezioni PIF) nel punto del cursore, dove vengono inseriti nel testo (immagini visibili, video con lettore, altri file come link); **ovunque nella scheda formula** (diventano allegati); **nella zona Documenti** di una materia prima (SDS/TDS/CoA). Rilasciare un file fuori da queste aree non apre più il file nel browser.

## Foto e file dentro il processo
Nell'editor del processo il pulsante **📎 Allegato** inserisce, alla posizione del cursore, un allegato della formula: le **immagini** compaiono nel testo, i **video** come lettore incorporato, gli altri file come link. In alternativa si possono **trascinare o incollare** file direttamente nell'editor (vengono caricati e inseriti). Nel DB il riferimento è `cosfile:<nome-file>` (stabile tra export/import); eliminando l'allegato i riferimenti vengono rimossi dal testo.

## Export, PDF e booklet
- **Scheda singola**: pulsanti *PDF / Stampa* (pagina impaginata → dialogo di stampa → “Salva come PDF”) e *HTML* (file autonomo con immagini incorporate, apribile anche in Word/LibreOffice).
- **Booklet**: *Booklet / PDF…* in alto → scegli tutte o alcune schede, formato (A4/A5/Letter), copertina, indice, allegati → *Anteprima / PDF* oppure *Scarica HTML autonomo*. Ogni scheda: dati, tabella formula con totali, lista INCI per % decrescente, note, processo con le immagini, allegati. I video sono sostituiti da un segnaposto con il nome file.
- Il PDF è generato dal motore di stampa del browser (nessuna dipendenza aggiuntiva). Disattiva “Intestazioni e piè di pagina” nel dialogo; i numeri di pagina e il piè di pagina sono inseriti dal CSS `@page` (richiede un browser Chromium recente; altrimenti mancano solo quelli). Per un libretto fronte/retro usa A5 oppure la funzione “opuscolo” del visualizzatore PDF.

## Verifica INCI (fonti ufficiali)
- Nella procedura guidata si può scegliere un **seed minimale NON ufficiale** (148 nomi INCI comuni, `data/cosing-seed.csv`); l'interfaccia mostra un avviso finché non si importa il dataset completo.
- Dataset completo: scarica il CSV "COSING Ingredients – Fragrance Inventory" da https://data.europa.eu/data/datasets/cosmetic-ingredient-database-ingredients-and-fragrance-inventory (portale: https://single-market-economy.ec.europa.eu/sectors/cosmetics/cosmetic-ingredient-database_en), poi caricalo da **Database → Carica dataset INCI CosIng (CSV)** (o, da terminale: `npm run import-cosing -- percorso/COSING.csv`).
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
