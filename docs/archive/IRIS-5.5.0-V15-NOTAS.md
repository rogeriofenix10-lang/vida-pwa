# Iris 5.5.0 — V15

## Bloco completo entregue

- Backup local JSON e restauração local já integrados na Central de Segurança.
- PIN local opcional: hash SHA-256 no navegador, sem envio e sem inclusão no backup.
- Fila de autorizações com aprovar, cancelar e revogar autorizações aprovadas.
- Diagnóstico ampliado de PWA, Service Worker, IndexedDB com leitura/escrita, síntese e reconhecimento de voz, MediaRecorder, microfone, armazenamento, idioma e rede.
- Arquivo Inteligente com filtro por mês e indicação do período do resumo financeiro.
- Classificação, revisão pendente, confiança, duplicidade e consolidação de gastos mantidos.
- Instalador e modo demo cross-platform em Node.js, sem dependência obrigatória de Bash no Windows.
- Integrações externas continuam bloqueadas por padrão e não são executadas sem autorização explícita.

## Validação

- Preflight gratuito: aprovado.
- TypeScript: aprovado.
- Build: aprovado.
- Vitest: 56 arquivos e 333 testes aprovados.
- ZIP: integridade verificada com `unzip -t`.

## Instalação Windows

1. Extraia o ZIP inteiro.
2. Execute `instalar-iris.bat`.
3. Ao finalizar, use `iniciar-iris.bat` para abrir novamente.
4. Acesse `http://localhost:3000`.

## Primeiro uso recomendado

1. Abra **Segurança** e baixe um backup inicial.
2. Se quiser, ative o PIN local.
3. Abra **Diagnóstico** e confira os recursos do navegador.
4. Em **Arquivo Inteligente**, adicione um exame e uma fatura de teste.
5. Instale como PWA pelo navegador quando estiver usando HTTPS.
