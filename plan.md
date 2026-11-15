# Iris 5.5 — Interface compacta e Arquivo Inteligente

## Objetivo

Reduzir a densidade visual da Home sem remover funções e criar um fluxo local-first para arquivar documentos, extrair texto disponível, separar exames médicos de documentos financeiros e consolidar gastos por categoria.

## Design

**Estilos considerados:** dashboard operacional minimalista (0,07), glassmorphism escuro (0,08), workspace documental editorial (0,06). Escolha: workspace documental editorial.

**Movimento:** superfícies escuras com poucos comandos primários, menus recolhíveis e cartões de resumo somente quando houver dados.

**Princípios:** hierarquia visual clara; uma ação principal por área; detalhes sob demanda; linguagem de privacidade explícita.

**Paleta:** azul-noite para foco, ciano apenas para estado ativo e verde para armazenamento seguro; evitar dezenas de pills simultâneos.

**Layout:** cabeçalho compacto, menu de módulos recolhível e uma página de Arquivo Inteligente com abas Documentos, Exames e Gastos.

**Interação:** arquivos permanecem locais por padrão; nenhuma mensagem, upload externo ou compartilhamento é disparado.

## Implementação

- `IrisQuickLaunch` será um menu recolhível.
- `PwaStatusBar` terá somente status essenciais e menu compacto.
- `DocumentVault` aceitará PDF, imagens, texto, CSV e documentos comuns como arquivo local, classificará por nome/MIME e persistirá metadados/texto no IndexedDB.
- PDFs com camada de texto terão extração heurística local; PDFs escaneados e imagens serão arquivados e sinalizados como “OCR necessário”, sem inventar conteúdo.
- Documentos médicos terão pasta lógica e comparação de marcadores numéricos encontrados no texto.
- Faturas/extratos terão leitura heurística de valores e classificação de posto, hotel, supermercado e outras categorias.
- A tela exibirá confiança, origem e limitações de cada análise.

## Publicação permanente

- O modo PWA estático será gerado por `pnpm run build:static`.
- O build não consulta autenticação, tRPC ou backend e mantém os dados no navegador.
- O workflow `.github/workflows/deploy-pages.yml` publica `dist/public` no GitHub Pages sem custo.
- Recursos conectados permanecem desativados até existir backend e autorização explícita.

## Fase autorizada de expansão 2026-11
- Preservar R2+D1, Gemini protegido no Worker, Gmail somente leitura, OCR local, fallback local, quota de 98% e confirmações de ações sensíveis.
- Expor pelo Worker D1 a memória autorizada, tarefas sincronizadas e cadastro comercial, sem depender de `/api/trpc` no Pages estático.
- Manter Drive e Calendar atrás de OAuth e escopos explícitos; leituras podem ser preparadas, mas escritas exigem aprovação.
- Adicionar capacidades de visão, tradução, comparação documental e geração de arquivos no Gemini sem expor chaves no frontend.
- Não ativar WhatsApp, Instagram, Facebook, TikTok, X, Outlook, Waze ou reservas de viagem sem credenciais e autorização próprias.


## Complemento — gestão financeira mês a mês (15/11/2026)

A página `FinanceHub` continua usando a coleção local `irisFinances` no IndexedDB, sem serviço novo nem dependência de gráfico. Acrescentar navegação por mês/ano com filtro de receita/despesa/status/categoria, resumos do período, histórico completo e exportação mensal; não apagar registros ao trocar o período ou importar outro mês. Datas de compra conduzem lançamentos importados; data de vencimento conduz itens manuais quando disponível, com data de cadastro apenas como fallback explícito. Renderizar em SVG responsivo um comparativo de 12 meses de receitas, despesas e saldo, mostrando zeros somente para meses sem lançamentos reais. Preservar atualização/exclusão apenas por ação explícita do usuário, confirmar exclusões e avisar que os dados permanecem no dispositivo e podem ser copiados pelo backup/exportação local existentes.

Datas mensais: a data de referência explicitamente escolhida pelo usuário prevalece. Datas de compra completas podem ser usadas diretamente; quando só houver dia/mês, o ano só é reconstruído a partir de vencimento completo e legível da fatura, com aviso de inferência e ajuste na virada do ano. Sem esse contexto, a compra aparece em “Sem data definida” para revisão, nunca no mês de upload por conveniência. Itens manuais legados usam vencimento ou data de cadastro com indicação de origem. Receitas/despesas/saldo do gráfico são movimentações registradas, não saldo bancário real nem total de fatura. Valores em aberto e pagos são identificados separadamente na gestão.
