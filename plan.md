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
