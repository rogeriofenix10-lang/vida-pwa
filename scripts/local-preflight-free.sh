#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' 'IRIS 5.5 · PREFLIGHT LOCAL/CUSTO ZERO'
[[ -f package.json ]] || { echo 'package.json ausente'; exit 1; }
[[ -f client/public/manifest.webmanifest ]] || { echo 'manifesto PWA ausente'; exit 1; }
if find . -path './node_modules' -prune -o -path './dist' -prune -o -type f \( -name '.env' -o -name '.env.*' \) -print | grep -q .; then
  echo 'ATENCAO: arquivo de ambiente encontrado; mantenha-o fora dos ZIPs.'
fi
if grep -RIn --exclude-dir=node_modules --exclude-dir=dist --exclude='*.lock' -E 'sk-[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{20,}|BEGIN (RSA|OPENSSH) PRIVATE KEY' . >/dev/null 2>&1; then
  echo 'ERRO: possivel segredo detectado'; exit 1
fi
printf 'Modo seguro: integracoes externas continuam dependentes de aprovacao.\n'
printf 'Preflight concluido.\n'
