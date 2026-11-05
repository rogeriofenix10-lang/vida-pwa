# Iris 5.5 — recomendações executadas

## Ativas e locais

- Painel inicial com atalhos para as funções principais.
- `/comercial` para clientes e fornecedores.
- `/catalogo` com produtos, imagens, importação/exportação CSV e JSON.
- `/offline` para tarefas e notas locais.
- `/configuracoes` para idioma, modo, privacidade e PIN.
- PIN local opcional por hash SHA-256 no navegador; não substitui autenticação de servidor.
- Indicador global Online/Offline.
- Backup/restauração ampliado com contatos, produtos, tarefas e notas.
- Revogação global de autorizações.
- Diagnóstico PWA, voz, IndexedDB, MediaRecorder e armazenamento.
- Estúdio de Mídia local.
- Nove idiomas na camada global.
- Scripts Windows de instalar, iniciar, parar, atualizar e diagnosticar.
- Instalador pergunta a URL oficial e clona somente se o usuário informar uma URL válida; caso contrário, usa a pasta do ZIP.

## Mantidas como opcionais

- Tradução integral de todas as telas legadas ainda exige substituir textos fixos do Command Center e páginas antigas.
- Sincronização com servidor é deliberadamente manual e não está ativa.
- Gmail, Drive, WhatsApp, Calendar, redes sociais, armazenamento remoto e IA avançada permanecem desativados.
- O instalador não inventa URL de GitHub/GitLab e não ativa cobrança.

## Validação

Preflight gratuito, TypeScript, build e 333 testes passaram. O ZIP não inclui `node_modules`, `dist`, `.env` ou arquivos de log.
