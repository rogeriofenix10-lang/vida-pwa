#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
printf '\nIris PWA local\nPasta: %s\nVersão: ' "$ROOT"
node -p 'require("./package.json").version'
printf 'URLs: /  /seguranca  /midia  /laboratorio\n\n'
export NODE_ENV=development
export PORT="${PORT:-3000}"
if [ ! -x "$ROOT/node_modules/.bin/tsx" ]; then
  printf 'Dependências de desenvolvimento ausentes; instalando com --prod=false...\n'
  pnpm install --prod=false --ignore-scripts
fi
exec pnpm exec tsx watch server/_core/index.ts
