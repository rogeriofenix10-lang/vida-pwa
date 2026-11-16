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
- [ ] Preparar Drive e Calendar com escopos OAuth e aprovação para escrita; a conexão Google ainda pode exigir consentimento/reconexão do usuário.
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
