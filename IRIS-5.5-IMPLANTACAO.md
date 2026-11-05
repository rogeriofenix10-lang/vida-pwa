# Iris 5.5 — implantação

## Recursos comerciais e operação local

A rota `/catalogo` oferece cadastro local de produtos com nome, código, preço, estoque, categoria, descrição e imagem. O catálogo pode ser pesquisado e exportado para JSON ou CSV; os dados permanecem no IndexedDB até uma exportação manual.

A rota `/documentos` é o Arquivo Inteligente local. Ela aceita PDF, imagens, textos, CSV e formatos comuns, classifica documentos em `Exames`, `Financeiro` ou `Documentos`, extrai texto disponível e mostra um resumo de gastos por tipo de estabelecimento. O processamento não aciona e-mail, WhatsApp, Drive ou qualquer outra integração.

PDFs com camada de texto podem ser analisados localmente. PDFs escaneados e imagens são preservados e marcados como `OCR necessário`; a Iris não apresenta uma leitura como concluída quando não conseguiu extrair texto. Exames são informativos e não substituem orientação médica.

A Home usa menus recolhíveis para reduzir a poluição visual. Nenhuma funcionalidade foi removida: módulos adicionais ficam em **Módulos** no topo ou no menu da barra PWA.

Na Central de Segurança existe agora o botão **Revogar todas as autorizações**. Os scripts `instalar-iris.bat`, `iniciar-iris.bat`, `parar-iris.bat` e `diagnostico-iris.bat` ajudam a operar a versão local no Windows.

Leia também `CUSTO-ZERO-E-OPERACAO.md` antes de ativar qualquer integração ou serviço de hospedagem.
