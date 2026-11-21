# Iris 5.5 — entregas desta rodada

- [x] Interface inicial com atalhos recolhíveis, preservando rotas existentes.
- [x] Barra PWA com status essenciais e menu de módulos.
- [x] Arquivo Inteligente local para arquivar PDFs, imagens, textos e CSV.
- [x] Classificação local em saúde, finanças e documentos gerais.
- [x] Comparação local de marcadores de exames quando houver texto extraível.
- [x] Consolidação de gastos por categoria sem envio externo.
- [x] Limitações de OCR e análise exibidas ao usuário.
- [x] Validação TypeScript, build e testes.

# Fase autorizada — persistência e IA conectada
- [x] Criar tabelas D1 para memória autorizada, tarefas sincronizadas e cadastro comercial.
- [x] Expor GET/POST dessas entidades no código do Worker, preservando o fallback local.
- [x] Ligar os clientes Pages às rotas D1 sem usar `/api/trpc`.
- [x] Publicar no Worker de produção as rotas D1 e os modos avançados com autenticação, CORS restrito, bindings preservados e quota de armazenamento que não zera a cada mês.
- [x] Expandir o código do Worker para visão, tradução, comparação documental e geração estruturada.
- [x] Preparar Drive e Calendar com escopos OAuth e aprovação explícita para escrita; a conexão Google ainda pode exigir consentimento/reconexão do usuário.
- [ ] Manter redes sociais, Outlook, Waze e reservas bloqueados até credenciais próprias.

# Reparos solicitados — importação, agenda e utilidades (11/11/2026)

- [x] **PDF/documentos e gastos:** “quando baixarmos o PDF a Iris deverá analisar todos os documentos, fazer a separação dos gastos e fazer o lançamento individualizado de cada um, exemplo, hotel, posto de combustível, supermercado, etc.”; o original importado aparece no Arquivo local, permanece neste dispositivo e pode ser baixado novamente, sem envio automático. Planilhas Excel devem ser exportadas como CSV para leitura segura.
- [x] **Agenda:** permitir editar e apagar cada compromisso, com confirmação antes de efetivar alterações no Google Calendar; a alteração real continua sujeita a desbloqueio e consentimento da conta Google.
- [x] **Análises:** ativar os atalhos/cartões e permitir gerar relatório útil com os dados locais disponíveis, sem apresentar dados ausentes como se fossem zero.
- [x] **Tradução:** permitir digitar ou colar texto no campo de origem e acionar tradução manual entre os idiomas selecionados, além do modo de voz.
- [x] **Catálogo:** fazer os botões de exportação do catálogo baixarem arquivos JSON e CSV utilizáveis.
- [x] **PWA:** não exibir “não instalado” como falha; conferir manifesto, ícones com dimensões corretas e registro real do Service Worker.
- [x] **URL publicada:** usar o endereço estável do app; URLs com hash identificam implantações antigas e não recebem atualização.

# Ajuste solicitado de layout (11/11/2026)
- [x] Remover o painel fixo de serviços remotos do layout geral e manter o controle acessível em Configurações, sem alterar autenticação, sessão ou dados locais.

# Acesso lembrado por dispositivo e recuperação de PIN (12/11/2026)
- [x] Após validar a senha mestra uma vez neste navegador/dispositivo, manter acesso remoto ao reabrir ou recarregar sem salvar a senha mestra. Usar credencial rotativa de dispositivo com 90 dias de inatividade, renovação automática, expiração e revogação em Configurações. Expiração/revogação/limpeza do navegador exigem nova validação.
- [x] Após validar o PIN local uma vez, permitir lembrar este navegador e não pedi-lo a cada reabertura; invalidar lembrança ao trocar/remover o PIN. Distinguir explicitamente PIN local da senha mestra remota.
- [x] Recuperar PIN local esquecido pela validação da senha mestra remota, removendo somente a proteção PIN e preservando documentos, finanças, catálogo e demais dados locais. Mostrar/ocultar entrada e mensagens claras de rede/credencial incorreta.

# Leitura e agrupamento de faturas de cartão (12/11/2026)
- [x] Ler PDFs de gastos de cartão com camada textual ou OCR, interpretar transações individuais, identificar e agrupar segmentos como Hotel, Restaurante e Posto de combustível, além de outras categorias reconhecíveis, sem duplicar totais, pagamentos ou reimportações. Exibir itens incertos para revisão, sem inventar despesas.
- [x] Identificar somente bandeira e instituição financeira quando legíveis; não extrair números de conta/cartão, nem mantê-los em descrições, texto derivado, nomes exibidos ou relatórios/exportações de análise. O original é documento local separado e não é enviado automaticamente.
- [x] Permitir nova leitura dos arquivos já importados sem lançamentos para que a correção possa ser aplicada à fatura que falhou; informar progresso, resultado e limitações.

# Reconciliação e vencimento da fatura do cartão (12/11/2026)
- [x] Mostrar com destaque o total a pagar conforme o PDF separado da soma de despesas individualizadas; explicar que saldo anterior, pagamentos, créditos e ajustes podem fazer os valores diferirem e nunca somar o total da fatura como uma nova despesa.
- [x] Registrar e mostrar junto da fatura a data de vencimento apenas quando estiver legível e rotulada no documento; não inferir nem criar uma data quando ausente ou ambígua.
- [x] Manter a data no resumo da fatura, sem copiá-la para cada compra ou marcar despesas individuais como vencidas.

# Gestão financeira mês a mês (15/11/2026)
- [x] Organizar receitas e despesas por mês/ano, com seleção clara do período e opção de consultar o histórico completo.
- [x] Manter os lançamentos salvos localmente e disponíveis ao mudar de mês ou adicionar períodos novos; permitir conferência dos registros históricos, preservando exclusão somente como ação manual confirmada e oferecendo exportação/backup para cópia durável.
- [x] Oferecer gerenciamento de receitas e gastos — cadastrar, editar, categorizar, marcar situação e excluir com confirmação — com filtros úteis no livro mensal.
- [x] Mostrar gráfico responsivo, por mês, comparando receitas, despesas e saldo, com valores calculados apenas dos lançamentos reais e sem preencher meses sem dados como se houvesse movimento.
- [x] Manter a experiência intuitiva, funcional, moderna e adequada ao celular, indicando que o arquivo local reside neste dispositivo.

# Navegação sem duplicidades e Arquivo de Documentos (15/11/2026)
- [x] **Agenda em Demonstração:** informar que a Agenda do Google requer acesso remoto/consentimento e está bloqueada de propósito no modo local; esclarecer que nenhum dado foi enviado e oferecer Configurações, sem desbloquear ou conectar automaticamente.
- [x] **Uma entrada por módulo:** manter Finanças no botão próprio; colocar Documentos e contratos como botão do Menu; remover os atalhos duplicados Arquivos/Análises e os cartões repetidos de Finanças, Documentos e Radar. Preservar tarefas úteis sob “Tarefas” no Menu, sem apagar os itens existentes.
- [x] **Documentos e contratos sem gestão financeira duplicada:** manter armazenamento local, busca, revisão, OCR/leitura para documentos não financeiros e download dos originais; adicionar filtro de contratos; retirar a aba Gastos e o resumo financeiro. Somente FinanceHub importa faturas e cria/gerencia lançamentos. Faturas antigas continuam arquivadas, sem exclusão ou alteração automática, e podem ser encaminhadas a Finanças.
- [x] **Auditoria de navegação:** conferir que nenhum menu/componente ativo volta a exibir o mesmo ícone ou função em vários lugares, preservando rotas antigas que possam estar salvas nos favoritos.
- [x] **Duplicidades secundárias:** deixar `/offline` como Notas; preservar tarefas antigas dessa coleção em consulta, sem migrar/apagar IDs ou manter um segundo CRUD de tarefas. Calendar tem consulta, criação, edição e exclusão na Agenda; `/google` fica apenas com Drive, mantendo OAuth/consentimento e confirmação de escritas.

# Uploads, catálogo PDF, clientes e Agenda (15/11/2026 — rodada seguinte)
- [x] **Catálogo e arquivos do PC:** importar imagens e catálogos diretamente por upload do computador, não apenas Drive; baixar o catálogo de produtos em PDF e continuar exportações JSON/CSV, além de baixar os arquivos originais importados em seus formatos. Não enviar arquivos automaticamente nem apagar produtos existentes.
- [x] **Tradução disponível e acesso claro:** diagnosticar a falha, permitir traduzir texto digitado/colado após clique, com resultado real, erro/limitação claro e caminho de ativação/sessão ou alternativa manual quando necessário. Nada é enviado durante digitação/ditado; não ativar serviços nem conectar automaticamente. A tradução local pode solicitar, com ação explícita, o download de um modelo do navegador; o fallback remoto exige serviço ativado, sessão desbloqueada e clique em Traduzir.
- [x] **Importação de clientes:** importar PDF e outros formatos suportados do computador e montar relação cliente por cliente com todos os campos legíveis disponíveis; preservar original e campos adicionais, indicar dados ausentes ou ambíguos e permitir revisão antes de salvar sem inventar informações. Manter cadastros existentes e evitar duplicações por reimportação.
- [x] **Consulta da carteira:** verificar e filtrar clientes por nome, grupo econômico, cidade e estado; abrir dados individuais completos e baixar/exportar a relação filtrada, sem depender de Drive.
- [x] **Agenda completa e calendário:** puxar compromissos Google por paginação sem corte silencioso; incluir botão para calendário mensal e acesso à lista/agenda, com período selecionável e origem das agendas. Perguntas à Iris sobre agenda devem responder com dados reais e filtros de datas, não informações inventadas. Escritas exigem confirmação e permissão da agenda correta. Agendas/páginas sem acesso são identificadas como resultado parcial; convites e emails de participantes não são devolvidos à aplicação.
- [x] **Google e Agenda desbloqueáveis:** oferecer caminho acionável de ativação/sessão lembrada por dispositivo e OAuth Google; não deixar apenas botões inativos sem solução. Não retirar autenticação, não abrir OAuth nem enviar dados automaticamente.
- [x] **Apagar documentos e contratos:** oferecer exclusão manual confirmada do documento escolhido deste dispositivo, esclarecendo o escopo; preservar todos os demais arquivos, lançamentos financeiros e históricos. Não excluir objetos remotos silenciosamente.


# Separação financeira por titular (16/11/2026)
- [x] **Lançamentos e faturas de Rogério e Aline:** analisar localmente cada fatura e identificar o titular somente quando um nome corresponder a Rogério ou Aline em um campo explícito e legível de titular/portador. Propagar essa identificação às despesas importadas daquela fatura e permitir classificar/filtrar lançamentos e faturas por Rogério, Aline ou “Titular não definido”; aplicar o filtro visível a totais, categorias, gráficos, CSV e faturas do período.
- [x] **Incerteza e histórico:** quando o campo de titular estiver ausente, ilegível, ambíguo ou não corresponder explicitamente, manter a fatura e as despesas como “Titular não definido” para revisão, sem adivinhar por estabelecimento, nome do arquivo, instituição ou bandeira. Manter registros antigos sem classificação até leitura/reimportação explicitamente solicitada ou revisão manual. Ao atribuir titular a uma fatura, atualizar apenas lançamentos ligados a ela que estejam sem titular ou ainda acompanhem a titularidade anterior, preservando valores, datas, edições individuais, documentos originais e todo histórico.
- [x] **Privacidade e escopo:** manter dados locais no IndexedDB, não salvar números completos de cartões/contas e não criar um cadastro separado de contas bancárias/cartões nesta entrega.
- [x] **Exceção manual e releitura segura:** permitir fixar “Titular não definido” numa despesa específica e preservar essa escolha nas releituras; permitir voltar a seguir a fatura. Quando uma releitura não encontrar transações suficientes ou não conciliar lançamentos anteriores, manter intactos lançamentos e metadados que determinam o período (incluindo o vencimento), com aviso claro.
- [x] **Visão geral sem nomear titular:** incluir opção clara para somar e verificar gastos de Rogério e Aline juntos, ocultando o titular nas linhas e no resumo de faturas, sem apagar nem alterar a classificação local. Manter opções para nomes visíveis, filtrar cada titular e ver somente “Titular não definido”; o CSV consolidado não deve mostrar titular.


# Correção de somas, leitura de arquivos e exclusão de histórico financeiro (16/11/2026)
- [x] **Somas auditáveis:** calcular receitas, despesas, saldo e categorias exclusivamente dos lançamentos locais em `irisFinances`, uma vez por registro e em centavos; total a pagar da fatura serve somente à comparação e nunca é somado novamente às compras. Não inferir nem corrigir escala de dados antigos sem fonte verificável. Mostrar diferença entre total informado e linhas individualizadas como alerta explicativo (pagamentos, créditos, saldo e taxas podem legitimamente causar diferença). A aritmética agora é determinística, mas isso não certifica que lançamentos antigos ou leituras anteriores sejam corretos.
- [x] **Leitura financeira conservadora:** não transformar linhas datadas de total, saldo, pagamento, crédito ou estorno em compras. Não adivinhar um valor quando uma linha trouxer vários valores sem rótulo/moeda inequívocos; sinalizar para revisão. Não interpretar CSV/JSON/Office como lançamento por escolher simplesmente o último número. Uma extração parcial ou duvidosa não substitui o histórico existente sem revisão; originais e linhas anteriores permanecem intactos.
- [x] **Excluir histórico sob comando:** permitir apagar todos os lançamentos financeiros deste dispositivo após mostrar a contagem e solicitar confirmação explícita; revalidar a contagem em transação para evitar apagar atualizações concorrentes. A limpeza do livro exclui somente `irisFinances`, preservando `irisDocuments`, contratos, PDFs originais, outros módulos e arquivos remotos; avisa que reler uma fatura preservada pode recriar seus lançamentos. Uma segunda ação, separada e também confirmada, permite apagar documentos financeiros arquivados, preservando os lançamentos e documentos não financeiros. Nenhuma limpeza ocorre durante correção/importação automática.
- [ ] **Conferência de novos arquivos:** os lançamentos antigos e oito originais financeiros foram identificados na sessão autenticada, mas não foi feita auditoria página a página dos PDFs. Após reimportar, conferir um exemplo redigido ou prévia local para validar a leitura do arquivo real; não automatizar correção de escala, duplicidade ou extração com base apenas numa captura de tela, e nunca coletar números completos de cartão/conta.


# Totalizações mensais e análise sob demanda da Iris (16/11/2026)
- [x] **Totais mensais e quando solicitados:** manter os totais de receitas/despesas/saldo calculados por mês selecionado a partir dos lançamentos locais; permitir abrir histórico completo e períodos sem data quando o usuário quiser. Exibir os valores exatos mês a mês junto do gráfico anual.
- [x] **Comparação contínua mês a mês:** manter sempre o comparativo janeiro–dezembro do ano escolhido, mesmo quando o usuário abre um único mês para consultar lançamentos; comparar receitas, despesas e saldo em escala comum e permitir seleção do mês.
- [x] **Análise financeira pela Iris sob solicitação:** oferecer ação/pergunta explícita para analisar os totais do período e a evolução mensal, nunca executar/enviar automaticamente. Calcular os totais localmente e, ao pedir análise IA, enviar somente agregados por mês/categoria e contagens necessários para responder, sem descrições, titulares, números de cartão/conta nem documentos originais. Respeitar o modo remoto, sessão e autorizações atuais; se bloqueado, não enviar e mostrar como habilitar. A Iris deve distinguir registros fornecidos de fatos conferidos e declarar quando o arquivo original não foi auditado.


# Separação da Biblioteca de Documentos e materiais financeiros (16/11/2026)
- [x] **Biblioteca sem materiais financeiros:** não relacionar faturas, extratos ou outros documentos identificados como financeiros na aba Todos, Revisão, busca, contadores ou filtros de Documentos e Contratos; eles são consultados/geridos em Finanças. Não ocultar contratos que contenham valores ou termos financeiros.
- [x] **Preservação e roteamento:** a separação visual da Biblioteca não migra nem altera nenhum registro; arquivos que só são identificados como financeiros depois da leitura local permanecem arquivados e são encaminhados a Finanças, sem criar lançamentos automaticamente. A exclusão dos originais financeiros é uma ação separada, protegida por confirmação e escopo, e não altera lançamentos nem os demais documentos.

# Data atual e interpretação específica de feriados (21/11/2026)
- [x] **Data automática:** usar relógio atual e fuso do dispositivo em cada pergunta, inclusive após virar o dia, sem pedir que o usuário informe a data. No Worker validar o fuso e usar relógio do servidor como fallback; incluir data/hora atual no contexto de toda chamada de conversa/visão.
- [x] **Pergunta singular/plural e período:** “qual o próximo feriado” deve retornar somente um feriado; “quais os próximos feriados” deve retornar uma lista claramente delimitada, respeitando quantidade e período explícitos e virada de ano. Não inventar feriados nem aumentar o escopo silenciosamente.
- [x] **Feriados, localidade e fontes sob demanda:** responder com feriados nacionais brasileiros de fontes oficiais quando não houver localidade; pedir cidade/UF somente para feriados locais. Não confundir ponto facultativo com feriado, não deduzir cidade pelo fuso e não afirmar fatos sem base. Omitir fonte, link, URL, citação e rodapé por padrão; só mostrar quando o usuário pedir explicitamente. Se a fonte for pedida em seguida, informar a referência correspondente à resposta anterior. Perguntas fora da base devem receber limitação explícita.
- [x] **Interpretação geral e preservação:** reforçar resposta direta apenas ao que foi perguntado, esclarecer ambiguidade necessária e distinguir dados comprovados de inferência. Preservar alterações Gmail, dados locais, autorização Google e confirmações de ações externas; não solicitar senha mestra no chat.

Evidência: 24 testes de contexto temporal e integração Worker, com regressões adicionais para fontes ocultas por padrão, exibição quando pedidas e consulta de seguimento; suíte completa 84 arquivos / 590 testes aprovada, assim como `pnpm check`, `pnpm build` e `pnpm build:static`. A regra de precisão no prompt reduz extrapolações, mas não é garantia de infalibilidade de IA em perguntas gerais; calendários fora da base exigem verificação/esclarecimento.
