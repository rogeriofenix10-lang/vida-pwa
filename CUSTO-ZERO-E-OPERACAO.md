# Iris 5.5 — política de custo zero e operação segura

## Modos

**Local** usa IndexedDB, Canvas, Web Speech, MediaRecorder e arquivos do dispositivo. Não exige login nem chamadas externas.

**Demonstração** usa dados fictícios e simuladores. É o modo recomendado para o Cloud Shell e para testes sem cobrança.

**Conectado** prepara a interface para autenticação e integrações opcionais, mas não autoriza envio, publicação, exclusão ou compartilhamento. Cada ação deve passar por permissões e aprovação explícita.

## Regra de custo

O pacote não habilita faturamento, chaves de APIs pagas, armazenamento remoto ou geração externa por padrão. Recursos avançados de IA permanecem instalados como pontos de extensão, mas inativos sem configuração posterior.

Cloud Shell é um ambiente de desenvolvimento e demonstração, não uma promessa de hospedagem permanente gratuita. Sessões podem expirar, o armazenamento é limitado e serviços adicionais do Google Cloud podem ter cobrança se o faturamento estiver habilitado. Antes de habilitar qualquer serviço, verifique cotas e billing no próprio Google Cloud.

## Funcionalidades gratuitas ativas

A Iris pode trabalhar localmente com catálogo de produtos, imagens, backups JSON, filtros, rotação, áudio WAV de teste, vídeo WebM, diagnóstico do navegador, idiomas, auditoria e fila de aprovação.

## Integrações externas

Gmail, Drive, Calendar, WhatsApp, redes sociais, autenticação OAuth, hospedagem persistente e modelos generativos avançados ficam desativados até decisão explícita. Não inclua chaves em `.env` no ZIP e não execute migrações de banco para o modo demonstração.

## Hospedagem futura

Para acesso 24 horas no celular, será preciso separar PWA estática e backend persistente HTTPS. Essa escolha deve ser feita somente depois de comparar limites gratuitos, armazenamento, banco, logs, autenticação e política de cobrança do provedor. Até lá, use Cloud Shell para desenvolvimento e demonstração.
