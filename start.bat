@echo off
REM License-Identifier: PolyForm-Noncommercial-1.0.0
REM Copyright (c) 2026 Flavio Pendolino
REM https://polyformproject.org/licenses/noncommercial/1.0.0
REM Author: Flavio Pendolino ^| Version: 0.1.0 ^| Commercial use: penfla@me.com
REM Purpose: avvio "ready to use" di Cosformula (Windows): controlla Node, installa le dipendenze se mancano, apre il browser.
REM Disclaimer: validate the results against your own reference samples before any analytical, engineering, safety or regulatory use.
REM AI disclosure: questo strumento esegue calcoli deterministici; non genera contenuto tramite IA generativa (art. 50 AI Act non applicabile).
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js non trovato. Installa Node.js 20 o superiore da https://nodejs.org/ e rilancia.
  pause & exit /b 1
)
if not exist node_modules (
  echo Prima esecuzione: installo le dipendenze ^(serve Internet, circa 1 minuto^)...
  call npm install --omit=dev --no-audit --no-fund || (pause & exit /b 1)
)
node server\index.js --open
pause
