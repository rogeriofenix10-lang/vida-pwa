# VIDA PWA — publicação

## O que já está preparado
- nome VIDA
- ícones 192/512
- tela de abertura
- manifest PWA
- modo standalone
- layout mobile
- meta tags para Android/iOS
- frontend do VIDA 2.0

## Para obter um link https://vida-app...
Hospede esta pasta em uma plataforma de hospedagem estática HTTPS. Exemplos:
- Vercel
- Netlify
- Cloudflare Pages
- GitHub Pages

Para a IA real funcionar, o frontend deve apontar para a API segura do VIDA 2.0, que não deve ficar dentro da hospedagem estática. No arquivo `app.js`, configure a URL da API em `API`.

## Teste
Depois da publicação HTTPS:
1. Abra o endereço no celular.
2. No Android, use o menu do navegador e escolha instalar/adicionar à tela inicial.
3. No iPhone, use Compartilhar > Adicionar à Tela de Início.

## Atenção
Eu não consigo criar sozinho um domínio público `https://vida-app...` sem acesso a uma conta de hospedagem/domínio. O pacote abaixo está preparado para ser publicado. A URL pública nasce quando você fizer o deploy em uma conta de hospedagem.
