# Instalação automática no Windows

1. Extraia o ZIP inteiro para uma pasta, por exemplo `C:\Iris\iris-5.5-final-local-first-v5`.
2. Na raiz, clique duas vezes em `instalar-iris.bat`.
3. Quando o Windows perguntar, responda `S` para instalar Node.js LTS e Python. O instalador tenta primeiro `winget` e depois Chocolatey, se já existir.
4. O script ativa Corepack, instala pnpm 10.4.1, instala dependências, executa o preflight de custo zero, valida TypeScript e inicia a Iris.
5. Abra `http://localhost:3000`.

O script pode solicitar confirmação administrativa para instalar ferramentas do sistema. Isso é uma ação do Windows e não ativa billing, APIs pagas ou integrações externas.

Se `winget` e Chocolatey não estiverem disponíveis, o script informa a situação e você pode instalar Node.js LTS manualmente em https://nodejs.org/ e executar novamente.

A versão entregue é baseada no ZIP. Clonagem Git automática só pode ser adicionada quando existir uma URL oficial de repositório definida pelo proprietário; o instalador não inventa uma origem.

Para parar: `parar-iris.bat` ou `Ctrl+C` na janela do servidor.
