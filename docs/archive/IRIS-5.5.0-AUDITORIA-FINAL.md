# Iris 5.5.0 — Auditoria e pacote final

## Resultado

Projeto recebido auditado, corrigido e validado em ambiente Linux local. O comportamento padrão continua **offline-first**, com custo zero e sem envio externo automático.

## Correções e melhorias aplicadas

- Backup local leve em JSON, sem binários.
- Backup local completo em **ZIP real**, criado no navegador, incluindo PDFs e imagens arquivados no IndexedDB.
- Restauração aceita JSON leve ou ZIP completo.
- Confirmação antes de limpar todos os dados locais.
- Resumo financeiro respeita o filtro mensal selecionado.
- Exportação CSV local dos gastos por categoria, período, bandeira e instituição.
- Comparação histórica de marcadores numéricos de exames, com aviso informativo e sem diagnóstico médico.
- Classificação e extração continuam heurísticas; imagens e PDFs escaneados permanecem sinalizados como OCR necessário, sem inventar resultados.
- Novo `pnpm run cloud` para Cloud Shell: entra na pasta do projeto, libera a porta configurada e inicia a Iris.
- Fallback automático para instalar `pnpm@10.4.1` via npm quando o Corepack falhar por erro de assinatura.
- Instalador Windows reforçado com verificação de porta e fallback de pnpm.
- Build `build:static` com modo local sem consultas de autenticação/backend.
- Workflow GitHub Pages e fallback `404.html` para publicação permanente gratuita.
- Rotas convertidas para carregamento sob demanda, reduzindo o bundle inicial; módulos pesados como Mídia, Comercial e Arquivo Inteligente são carregados quando acessados.
- OCR local opcional com Tesseract.js para imagens e PDFs sem camada de texto. O documento não é enviado; o modelo de idioma pode ser baixado uma vez pelo navegador e ficar em cache.
- Backups completos agora registram SHA-256 dos arquivos internos e a restauração verifica a integridade antes de substituir dados.
- Tela de primeira execução com escolha entre Demonstração local e Conectado; no build estático o modo Conectado fica bloqueado.
- Diagnóstico ampliado com OCR local, último backup, armazenamento, PWA, voz, microfone e rede.

## Validação executada

- Preflight custo zero: aprovado.
- TypeScript `tsc --noEmit`: aprovado.
- Vitest: **56 arquivos e 333 testes aprovados**.
- Build Vite + esbuild: aprovado.
- Build PWA estático: aprovado, com `dist/public/index.html`, `404.html`, manifesto e service worker.
- Code splitting: aprovado; telas aparecem em chunks separados e o índice principal ficou menor.
- Home `/`: HTTP 200.
- Arquivo Inteligente `/documentos`: HTTP 200.
- Manifesto PWA: respondeu corretamente.
- `bash -n scripts/iniciar-iris-cloud.sh`: aprovado.
- `node --check scripts/iris-demo.mjs`: aprovado.

## Observação

O build informa apenas um aviso de otimização: o bundle principal ultrapassa 500 kB. Isso não bloqueia a execução. A próxima melhoria opcional seria dividir telas por `import()` para reduzir o carregamento inicial.

## Segurança

A Iris mantém as integrações externas condicionadas a conexão e autorização explícita. Este pacote não ativa Gmail, WhatsApp, Drive ou qualquer envio automático. Os documentos e backups são processados localmente.
