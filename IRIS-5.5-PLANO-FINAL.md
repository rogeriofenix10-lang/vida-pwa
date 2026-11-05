# Iris 5.5 — plano final executado

## Interface

A Home mantém as funções existentes, mas os atalhos agora ficam em um menu recolhível. A barra inferior da PWA mostra apenas versão, conectividade e um menu compacto com idioma, modo, voz, segurança e módulos. A mudança reduz a sensação de painel antigo sem esconder recursos.

## Arquivo Inteligente

A rota `/documentos` concentra documentos gerais, exames e gastos. O usuário escolhe arquivos localmente; a Iris classifica por nome, MIME e texto disponível e grava metadados, texto extraído e pasta lógica no IndexedDB.

Documentos de saúde ficam na pasta lógica `Exames`, documentos financeiros em `Financeiro` e os demais em `Documentos`. Quando há valores no texto, a Iris agrupa lançamentos por supermercado, posto de combustível, hotel, restaurante, farmácia, transporte, serviços e outros. A tela também mostra bandeira e instituição quando reconhecidas no texto.

## Leitura e limites

Textos, CSV, JSON, XML e PDFs com camada textual recebem extração heurística local. Imagens e PDFs escaneados são arquivados, mas ficam marcados como `OCR necessário`; essa versão não inventa conteúdo e não envia arquivos automaticamente a um provedor. OCR completo de imagens exige incluir um motor local e seus modelos, o que aumenta significativamente o pacote e o consumo do Cloud Shell; a próxima etapa pode ativá-lo de forma opcional.

Comparação de exames é informativa e só compara marcadores numéricos encontrados nos textos disponíveis. Não substitui avaliação médica.

## Operação gratuita

Execute `pnpm run preflight:free` antes do empacotamento. O preflight verifica manifesto, arquivos de ambiente e padrões comuns de segredo. O pacote não habilita billing nem integrações pagas.

No Windows, use `instalar-iris.bat`, `iniciar-iris.bat`, `parar-iris.bat`, `atualizar-iris.bat` e `diagnostico-iris.bat`. A instalação de ferramentas do sistema não é forçada e pode exigir autorização administrativa.

## Limites assumidos

A PWA e os recursos locais podem ser gratuitos. Backend permanente, banco remoto, autenticação externa, armazenamento remoto e IA avançada dependem de serviços com limites próprios. Permanecem como extensões desativadas até autorização explícita.
