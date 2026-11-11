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
