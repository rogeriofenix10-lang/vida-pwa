# Iris 5.5.0 — pacote V10

## Entregue nesta revisão

- Home sem barra superior e sem barra inferior fixa.
- Marca Iris flutuante no canto superior esquerdo, com o mesmo globo ocular da interface.
- Botão **Menu** ao lado de **Saúde**, preservando os módulos existentes.
- Arquivo Inteligente local-first com classificação heurística de Saúde, Financeiro e Geral.
- Revisão pendente, confirmação manual e nível de confiança por documento.
- Detecção de duplicidade por nome, tamanho e data de modificação do arquivo.
- Consolidação financeira por tipo de estabelecimento.
- Comparação informativa de marcadores de exames quando houver texto extraível.
- Bloqueio explícito de envios automáticos: nenhum conector externo é acionado pelo arquivamento.
- PDFs escaneados, imagens, DOC/DOCX e XLS/XLSX permanecem arquivados e sinalizados quando exigirem OCR/leitura especializada; não há invenção de resultados.

## Validação

- `pnpm run check` — aprovado.
- `pnpm run build` — aprovado.
- `pnpm test` — 56 arquivos e 333 testes aprovados.

## Execução no Cloud Shell

```bash
cd ~/iris-cloudshell-audit
corepack enable
pnpm install --ignore-scripts
PORT=3000 pnpm run dev
```

Abra o **Web Preview** na mesma porta exibida pelo terminal. Para produção, use o build já gerado em `dist/` com `pnpm start`.

> O modo offline continua local-first. Integrações externas permanecem desativadas até autorização explícita do usuário.
