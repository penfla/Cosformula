#!/usr/bin/env bash
# License-Identifier: PolyForm-Noncommercial-1.0.0
# Copyright (c) 2026 Flavio Pendolino
# https://polyformproject.org/licenses/noncommercial/1.0.0
#
# Author: Flavio Pendolino | Version: 0.1.0 | License: PolyForm Noncommercial 1.0.0 | Commercial use: penfla@me.com
# Purpose: avvio "ready to use" di Cosformula (macOS/Linux): controlla Node, installa le dipendenze se mancano, apre il browser.
# Disclaimer: validate the results against your own reference samples before any analytical, engineering, safety or regulatory use.
# AI disclosure: questo strumento esegue calcoli deterministici; non genera contenuto tramite IA generativa (art. 50 AI Act non applicabile).
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js non trovato. Installa Node.js 20 o superiore da https://nodejs.org/ e rilancia."; exit 1
fi
MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$MAJOR" -lt 20 ]; then echo "Serve Node.js >= 20 (trovato $(node -v)). https://nodejs.org/"; exit 1; fi
if [ ! -d node_modules ]; then
  echo "Prima esecuzione: installo le dipendenze (serve Internet, ~1 minuto)…"
  npm install --omit=dev --no-audit --no-fund
fi
exec node server/index.js --open
