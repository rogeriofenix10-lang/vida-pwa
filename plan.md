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

## Complemento — separação financeira por titular (16/11/2026)

Acrescentar em `FinanceHub` o campo de titular opcional `Rogério`/`Aline` para lançamentos e documentos de fatura, com filtros de visão por titular e opção “Titular não definido”. Novas faturas são analisadas localmente para encontrar nome correspondente somente em um campo explícito e legível de titular/portador; autoatribuir e propagar às compras apenas se houver uma única correspondência confiável. Fatura sem nome legível, sem rótulo inequívoco ou com ambiguidade permanece sem titular para revisão manual. Não inferir pela loja, nome do arquivo, banco, bandeira, valores nem número de cartão/conta. Novos lançamentos permitem seleção explícita; atribuir titular a uma fatura atualiza apenas os lançamentos ligados a esse documento que estejam sem titular ou ainda sigam o titular anterior, sem substituir exceções editadas individualmente. Totais, categorias, gráficos, exportação CSV e resumos de fatura respeitam o filtro atual. Histórico anterior permanece sem classificação até reimportação/leitura explícita ou seleção manual; não modificar valores/datas, criar cadastro de contas ou persistir números completos de cartões/contas. Todo o estado continua local no IndexedDB com os campos legados preservados.

Lançamentos derivados distinguem titular herdado da fatura de override manual, inclusive fixar deliberadamente uma despesa como “Titular não definido”; a edição permite retornar a seguir a fatura. Se a releitura não encontrar linhas suficientes ou não reconciliar todo o histórico, preservar despesas, metadados e vencimento anterior (usado para determinar o período) e avisar sem alterar os totais históricos.

A visualização inicial é “Visão geral”: soma os lançamentos dos titulares, omite o titular nas linhas e no resumo de faturas, e mantém seus dados inalterados no armazenamento. “Todos os titulares — nomes visíveis”, Rogério, Aline e “Titular não definido” continuam disponíveis. O CSV filtrado permanece consolidado e não contém coluna de titular.


## Complemento — navegação sem duplicidade e Arquivo de Documentos (15/11/2026)

- Na navegação ativa da Home, manter apenas Sugestões, Finanças, Agenda e Menu como acessos principais; Documentos/Contratos fica disponível como item único no Menu. Remover o atalho Arquivos da barra principal e o botão Análises, junto dos cartões repetidos de Financeiro, Documentos e Radar. Preservar a gestão operacional de tarefas sob o nome “Tarefas” dentro do Menu, sem apagar itens existentes nem a estrutura de dados.
- Centralizar cálculos, importação de faturas, categorias, receitas/despesas, gráficos e lançamentos exclusivamente em `FinanceHub`. `DocumentVault` serve para arquivar, pesquisar, revisar, ler/OCR e baixar documentos/contratos originais neste dispositivo; deve parar de criar novos lançamentos financeiros. Faturas já arquivadas permanecem intactas e podem ser encaminhadas a Finanças para análise; nenhuma coleção histórica será apagada.
- Dar classificação própria a contratos, manter o arquivo original e o OCR/extração local com dados financeiros mascarados. Remover da interface documental a aba Gastos, o resumo por categoria/CSV financeiro e detalhes monetários que já são de Finanças; documentos financeiros antigos continuam acessíveis como documentos arquivados.
- Tratar a Agenda bloqueada no modo Demonstração como bloqueio esperado de privacidade, não como falha de sistema: explicar que nenhum dado foi enviado e apontar Configurações, sem ativar modo remoto, autenticar ou solicitar acesso automaticamente.
- Manter aliases históricos de rota do FinanceHub para não quebrar favoritos e centralizar os pontos de navegação visíveis na Home/Menu ativos; componentes QuickLaunch/PWA não montados não devem reintroduzir atalhos duplicados se reutilizados.

A revisão secundária encontrou coleções de tarefas diferentes: `radar` (IDs numéricos) e `offlineWorkspace`/`tasks` (UUID). Não migrar nem converter IDs silenciosamente. Novas tarefas ficam na view Tarefas da Home; a página `/offline` vira Notas e mantém a consulta recolhível de tarefas antigas, sem segundo conjunto de ações de tarefas. O Calendar é concentrado na Agenda da Home, incluindo a criação anteriormente disponível apenas em `/google`; `/google` mantém Drive. Links contextuais `/?view=agenda` e `/?view=tarefas` abrem somente views conhecidas, sem executar ação externa.

## Complemento — uploads do computador, clientes e Agenda (15/11/2026)

Manter o design azul-noite, local-first e módulos únicos. `ProductCatalog` recebe upload direto do computador de imagens/catálogos e download dos originais, além de PDF do catálogo de produtos, CSV e JSON. `BusinessHub` passa a distinguir anexar original de importar uma relação de clientes: ler PDF com texto/OCR, CSV, JSON, TXT e formatos Office suportados localmente; construir candidatos por cliente com campos disponíveis, grupo econômico, cidade e UF, preservando campos adicionais e apontando ausências/ambiguidade. Revisão editável e confirmação precedem gravação. Não inventar nem substituir clientes existentes; deduplicar entradas sem apagar históricos. Filtros por nome, grupo, cidade e estado, detalhes individuais e exportação local da relação. O upload do arquivo nunca depende de Drive.

`Interpreter` deve diagnosticar e resolver o caminho de sessão/serviço, sem enviar o texto durante digitação/ditado nem ativar remoto sozinho. `GoogleWorkspace` e Agenda usam um acesso explícito e acionável para modo remoto, credencial lembrada por dispositivo e OAuth, preservando os controles atuais. Não burlar Google consentimento nem solicitar senha em chat. Tradução pode usar capacidade real local do navegador quando suportada; o fallback conectado depende de autorização e disponibilidade reais, com motivo claro e alternativa manual.

Agenda terá calendário mensal e lista sem corte silencioso de 12 eventos, consulta paginada de compromissos Google nos períodos selecionados e identificação das agendas acessíveis. Eventos de outras agendas, quando disponíveis no escopo autorizado, devem carregar identidade/permissão corretas para não editar no calendário errado. Consultas à Iris sobre agenda usam compromissos reais e filtros temporais, sem criar/editar/excluir por pergunta. Escritas continuam confirmadas e protegidas. `DocumentVault` oferece Excluir por documento após confirmação, removendo somente a cópia local selecionada, sem apagar lançamentos financeiros, outros documentos ou objetos remotos.

Estrutura: páginas em `client/src/pages`, componentes de acesso/calendário em `client/src/components`, leitores e exportadores locais em `client/src/lib`; integração Google em `client/src/lib/irisWorker.ts` e `worker/worker-iris-gmail.js`. Reutilizar OCR e download existentes; dependências de PDF/Office serão lazy-loaded. Publicar somente após testes e build; nenhuma validação deve gravar dados reais.


## Complemento — revisão financeira, parser conservador e limpeza local (16/11/2026)

A página `FinanceHub` lê registros somente do IndexedDB do navegador; nenhum registro real pode ser lido, corrigido ou apagado do Sandbox. Não converter automaticamente valores históricos nem inferir se 153 lançamentos estão em reais, centavos, duplicados ou corretos a partir da captura de tela. Auditar soma sempre a partir de `irisFinances`; o total da fatura permanece metadado de reconciliação e nunca vira outra despesa.

O leitor deve rejeitar como compras linhas de total/saldo/pagamento mesmo quando prefixadas por data e dentro da seção de transações. Para linhas com vários valores, só escolher um valor quando o rótulo de compra ou a moeda BRL o identificar sem ambiguidade; caso contrário excluir da soma automática e mostrar aviso para revisão. CSV/JSON/Office não devem ser interpretados como transações por heurística de “último número”. PDF/OCR conserva o original local; extração parcial, texto corrompido, divergência entre camadas e duplicidade provável são mostrados como avisos, não como resultado validado. As novas extrações devem ser revisadas explicitamente antes de atualizar lançamentos já salvos.

`FinanceHub` oferece “Apagar todo o histórico financeiro” em área de risco com a quantidade atual, confirmação explícita e verificação transacional de que a coleção não mudou desde o diálogo. A ação apaga somente a chave local `irisFinances`; não usa `clearLocalWorkspace`, não modifica `irisDocuments`, contratos, PDFs, Blobs, backups ou dados remotos. Lançamentos derivados de faturas mantidas podem ser recriados em uma releitura posterior, o que deve ser informado.


## Complemento — totalizações mensais e análise sob demanda (16/11/2026)

Manter o seletor de período com o mês e o histórico completo; tornar a tabela de valores exatos do comparativo anual mês a mês prontamente visível e manter o gráfico com os 12 meses do ano selecionado sempre que o usuário consulta outro período. Somente lançamentos financeiros locais alimentam totais. Adicionar análise da Iris acionável pelo usuário para o período selecionado, acompanhada de comparativo mensal: transmitir somente totais agregados por mês/categoria e contagens necessários à pergunta, sem descrições, nomes de titulares, números de cartão/conta nem PDFs. Não enviar nada automaticamente. A solicitação usa o Worker já protegido; se o modo remoto/sessão estiver bloqueado, explicar que a análise IA requer ativação e desbloqueio, sem burlar a guarda. Instruir o modelo a considerar os valores como os registros informados, apontar discrepâncias/limitações e não afirmar auditoria dos documentos originais. Toda análise numérica determinística é calculada localmente primeiro.


## Complemento — materiais financeiros fora da Biblioteca de Documentos (16/11/2026)

A biblioteca Documentos e Contratos lista apenas arquivos gerais, exames e contratos. Faturas e extratos são omitidos dos contadores, filtros, pesquisa e linhas da Biblioteca, permanecendo integralmente na coleção local `irisDocuments` para que Finanças continue a analisá-los; nenhuma migração, exclusão ou alteração de lançamentos ocorre por ocultar a lista. Um arquivo reconhecido como financeiro pelo conteúdo fica preservado localmente e é gerido em Finanças; quando o nome já o identifica com clareza, indicar para importá-lo diretamente em Finanças. Contratos continuam na biblioteca mesmo quando contêm termos monetários.
