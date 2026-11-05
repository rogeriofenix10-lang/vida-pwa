# Publicação permanente da Iris como PWA

A versão estática mantém o Arquivo Inteligente, IndexedDB, backup JSON/ZIP, relatórios financeiros, comparação de exames, PIN local, modo demonstração e instalação como aplicativo. Ela não tenta autenticar, consultar tRPC ou enviar dados para Gmail, WhatsApp, Drive ou qualquer serviço externo.

## Publicação gratuita pelo GitHub Pages

1. Crie um repositório no GitHub, por exemplo `iris-pwa`.
2. Envie todo o conteúdo deste projeto para a branch `main`.
3. Em **Settings → Pages**, escolha **GitHub Actions** como fonte.
4. O workflow `.github/workflows/deploy-pages.yml` instalará as dependências e publicará `dist/public`.
5. O endereço será parecido com `https://SEU_USUARIO.github.io/iris-pwa/`.

O primeiro build pode demorar alguns minutos. As rotas do PWA usam `404.html` como fallback para que a navegação continue funcionando em hospedagem estática.

## Build local para conferência

```bash
pnpm install --prod=false --ignore-scripts
pnpm run build:static
```

O resultado estará em `dist/public`. Pode ser servido localmente com qualquer servidor HTTP estático.

## O que permanece desligado

Autenticação externa, banco remoto, IA conectada, Gmail, WhatsApp, Drive, notificações remotas e integrações pagas permanecem desligados no build estático. Para ativá-los no futuro será necessário um backend hospedado e autorização explícita; isso não acontece automaticamente.
