# Iris 5.5 — entregas desta rodada

- [x] Interface inicial com atalhos recolhíveis, preservando rotas existentes.
- [x] Barra PWA com status essenciais e menu de módulos.
- [x] Arquivo Inteligente local para arquivar PDFs, imagens, textos e CSV.
- [x] Classificação local em saúde, finanças e documentos gerais.
- [x] Comparação local de marcadores de exames quando houver texto extraível.
- [x] Consolidação de gastos por categoria sem envio externo.
- [x] Limitações de OCR e análise exibidas ao usuário.
- [x] Validação TypeScript, build e testes.

# Fase autorizada — persistência e IA conectada
- [x] Criar tabelas D1 para memória autorizada, tarefas sincronizadas e cadastro comercial.
- [x] Expor GET/POST dessas entidades no código do Worker, preservando o fallback local.
- [x] Ligar os clientes Pages às rotas D1 sem usar `/api/trpc`.
- [ ] Publicar no Worker de produção as rotas D1 e os modos avançados; o código está versionado, mas o upload multipart foi bloqueado pelo executor Cloudflare.
- [x] Expandir o código do Worker para visão, tradução, comparação documental e geração estruturada.
- [ ] Preparar Drive e Calendar com escopos OAuth e aprovação para escrita.
- [ ] Manter redes sociais, Outlook, Waze e reservas bloqueados até credenciais próprias.
