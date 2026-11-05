# Iris 5.5 — interface compacta e Arquivo Inteligente

A Home foi reorganizada para não exibir oito cartões grandes ao mesmo tempo. O acesso principal agora é `Arquivo Inteligente` e `Visão geral`; os demais módulos ficam no menu recolhível `Módulos`. A barra PWA inferior foi reduzida a versão, conectividade e um menu com idioma, modo, voz, segurança e rotas.

A nova rota `/documentos` arquiva arquivos no IndexedDB do navegador. PDFs, imagens, textos e CSV são classificados localmente em `Exames`, `Financeiro` ou `Documentos`. Textos, CSV, JSON, XML e PDFs com camada textual têm extração heurística. Imagens e PDFs escaneados são armazenados e identificados como `OCR necessário`.

Para faturas ou extratos com valores em texto, a tela reconhece valores em reais e agrupa os trechos por supermercado, posto de combustível, hotel, restaurante, farmácia, transporte, serviços e outros. Para exames com marcadores textuais conhecidos, a tela mostra valores encontrados e indica que a comparação é apenas informativa.

Nenhum arquivo é enviado automaticamente. Não há ativação de Drive, WhatsApp, e-mail ou API paga. A leitura não apresenta conteúdo como reconhecido quando o arquivo é uma imagem ou PDF escaneado sem OCR.
