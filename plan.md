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


## Complemento — navegação sem duplicidade e Arquivo de Documentos (15/11/2026)

- Na navegação ativa da Home, manter apenas Sugestões, Finanças, Agenda e Menu como acessos principais; Documentos/Contratos fica disponível como item único no Menu. Remover o atalho Arquivos da barra principal e o botão Análises, junto dos cartões repetidos de Financeiro, Documentos e Radar. Preservar a gestão operacional de tarefas sob o nome “Tarefas” dentro do Menu, sem apagar itens existentes nem a estrutura de dados.
- Centralizar cálculos, importação de faturas, categorias, receitas/despesas, gráficos e lançamentos exclusivamente em `FinanceHub`. `DocumentVault` serve para arquivar, pesquisar, revisar, ler/OCR e baixar documentos/contratos originais neste dispositivo; deve parar de criar novos lançamentos financeiros. Faturas já arquivadas permanecem intactas e podem ser encaminhadas a Finanças para análise; nenhuma coleção histórica será apagada.
- Dar classificação própria a contratos, manter o arquivo original e o OCR/extração local com dados financeiros mascarados. Remover da interface documental a aba Gastos, o resumo por categoria/CSV financeiro e detalhes monetários que já são de Finanças; documentos financeiros antigos continuam acessíveis como documentos arquivados.
- Tratar a Agenda bloqueada no modo Demonstração como bloqueio esperado de privacidade, não como falha de sistema: explicar que nenhum dado foi enviado e apontar Configurações, sem ativar modo remoto, autenticar ou solicitar acesso automaticamente.
- Manter aliases históricos de rota do FinanceHub para não quebrar favoritos e centralizar os pontos de navegação visíveis na Home/Menu ativos; componentes QuickLaunch/PWA não montados não devem reintroduzir atalhos duplicados se reutilizados.

A revisão secundária encontrou coleções de tarefas diferentes: `radar` (IDs numéricos) e `offlineWorkspace`/`tasks` (UUID). Não migrar nem converter IDs silenciosamente. Novas tarefas ficam na view Tarefas da Home; a página `/offline` vira Notas e mantém a consulta recolhível de tarefas antigas, sem segundo conjunto de ações de tarefas. O Calendar é concentrado na Agenda da Home, incluindo a criação anteriormente disponível apenas em `/google`; `/google` mantém Drive. Links contextuais `/?view=agenda` e `/?view=tarefas` abrem somente views conhecidas, sem executar ação externa.
