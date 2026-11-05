#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
PORT="${PORT:-3000}"

ensure_pnpm() {
  if command -v pnpm >/dev/null 2>&1 && pnpm --version >/dev/null 2>&1; then return 0; fi
  echo "Corepack/pnpm indisponível; instalando pnpm 10.4.1 via npm..."
  npm install -g pnpm@10.4.1
}

ensure_pnpm
if command -v fuser >/dev/null 2>&1; then
  fuser -k "${PORT}/tcp" >/dev/null 2>&1 || true
fi
if [[ ! -f "$ROOT/package.json" ]]; then
  echo "package.json não encontrado em $ROOT"
  exit 1
fi
if [[ ! -x "$ROOT/node_modules/.bin/tsx" ]]; then
  echo "Dependências ausentes. Execute pnpm install --prod=false --ignore-scripts."
  exit 1
fi
echo "Iris 5.5 local"
echo "Pasta: $ROOT"
echo "Porta: $PORT"
echo "Abra o Web Preview na porta $PORT."
exec pnpm run demo
