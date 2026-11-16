import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CalendarDays, Check, ChevronLeft, ChevronRight, Download, FileText, Pencil, Plus, Receipt, Search, Trash2, Upload, WalletCards, X } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { assertLocalFileSize, csvCell, downloadBlob, downloadJson, readLocal, writeLocal, writeLocalBatch } from "@/lib/irisLocalStore";
import { buildStatementEntries, financialFileHash, groupExpenses, INCOME_CATEGORIES, preserveBlockedStatementData, readFinancialDocument, type FinanceCategory, type FinancialEntry } from "@/lib/financeDocuments";
import { financeHolderLabel, matchesFinanceHolder, parseFinanceHolder, propagateDocumentHolder, type FinanceHolder, type FinanceHolderFilter } from "@/lib/financeOwnership";
import { buildMonthlySeries, filterEntriesByMonth, formatPeriodLabel, getDocumentMonth, getEntryPeriod, localToday, summarizeEntries } from "@/lib/financePeriods";
import FinanceMonthlyChart from "@/components/FinanceMonthlyChart";
import { EXPENSE_CATEGORIES, parseBrazilianAmount, type ExpenseCategory } from "@shared/expenseParser";
import { extractStatementDueAt, redactFinancialIdentifiers } from "@shared/cardStatement";
import "./finance-hub.css";

type Entry = FinancialEntry & { referenceDate?: string; holder?: FinanceHolder };
type StoredFinanceDocument = {
  id: string; name: string; mime: string; size: number; folder: string; kind: "saude" | "financeiro" | "geral"; createdAt: string;
  extractedText: string; analysis: "texto extraído" | "arquivado · OCR necessário" | "arquivado · formato não textual"; total?: number;
  money: Array<{ category: ExpenseCategory; amount: number; source: string; date?: string }>; markers: Record<string, number>;
  hash: string; reviewStatus: "pending" | "confirmed"; confidence: number; blob?: Blob; processing?: boolean; processingError?: string;
  institution?: string; brand?: string; statementTotal?: number; statementDueAt?: string; warnings?: string[];
  holder?: FinanceHolder; holderSource?: "statement" | "manual";
};
type Draft = { type: Entry["type"]; description: string; amount: string; category: FinanceCategory; status: Entry["status"]; referenceDate: string; dueAt: string; holder?: FinanceHolder; manualHolderOverride: boolean };
const expenseCategories = EXPENSE_CATEGORIES;
const incomeCategories = INCOME_CATEGORIES;
const allCategories: FinanceCategory[] = [...expenseCategories, ...incomeCategories.filter((category) => !expenseCategories.includes(category as ExpenseCategory))];
const money = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const newDraft = (): Draft => ({ type: "expense", description: "", amount: "", category: "Outros", status: "open", referenceDate: localToday(), dueAt: "", holder: undefined, manualHolderOverride: false });
const statusLabel = (status: Entry["status"]) => ({ open: "Em aberto", paid: "Pago/recebido", overdue: "Vencido" })[status];
const typeLabel = (type: Entry["type"]) => type === "income" ? "Receita" : "Despesa";
const displayDate = (value?: string) => {
  if (!value) return "Não identificada";
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (!year || !month || !day || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "Não identificada";
  return date.toLocaleDateString("pt-BR", { timeZone: "UTC" });
};
function parseBrlAmount(value: string) {
  return parseBrazilianAmount(value);
}
function previousMonth(month: string, direction: -1 | 1) {
  const [year, index] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, index - 1 + direction, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
async function upsertStoredDocument(document: StoredFinanceDocument) {
  const stored = await readLocal<StoredFinanceDocument[]>("irisDocuments", []);
  await writeLocal("irisDocuments", [document, ...stored.filter((item) => item.id !== document.id)]);
}

export default function FinanceHub() {
  const [items, setItems] = useState<Entry[]>([]);
  const [draft, setDraft] = useState<Draft>(newDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [importHolder, setImportHolder] = useState<FinanceHolder | undefined>();
  const [documents, setDocuments] = useState<StoredFinanceDocument[]>([]);
  const [period, setPeriod] = useState(() => localToday().slice(0, 7));
  const [chartYear, setChartYear] = useState(() => Number(localToday().slice(0, 4)));
  const [holderFilter, setHolderFilter] = useState<FinanceHolderFilter>("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [searchText, setSearchText] = useState("");
  const draftCategories: readonly FinanceCategory[] = draft.type === "income" ? incomeCategories : expenseCategories;

  const selectPeriod = (value: string) => {
    setPeriod(value);
    if (/^\d{4}-\d{2}$/.test(value)) setChartYear(Number(value.slice(0, 4)));
  };

  useEffect(() => {
    let active = true;
    const load = () => void Promise.all([readLocal<Entry[]>("irisFinances", []), readLocal<StoredFinanceDocument[]>("irisDocuments", [])]).then(([entries, docs]) => {
      const enrichedDocs = docs.map((doc) => {
        if (doc.statementDueAt || doc.kind !== "financeiro" || !doc.extractedText) return doc;
        const statementDueAt = extractStatementDueAt(doc.extractedText);
        return statementDueAt ? { ...doc, statementDueAt } : doc;
      });
      if (active) { setItems(entries); setDocuments(enrichedDocs); }
      if (active && enrichedDocs.some((doc, index) => doc !== docs[index])) void writeLocal("irisDocuments", enrichedDocs).catch(() => {
        if (active) setMessage("Vencimento identificado, mas não foi possível salvá-lo neste navegador. Use “Ler novamente” para tentar salvar.");
      });
    }).catch(() => { if (active) setMessage("Não foi possível abrir os lançamentos locais."); });
    load();
    window.addEventListener("iris-local-changed", load);
    return () => { active = false; window.removeEventListener("iris-local-changed", load); };
  }, []);

  const financeDocuments = useMemo(() => documents.filter((doc) => doc.kind === "financeiro" || doc.folder === "Financeiro"), [documents]);
  const editingEntry = editingId ? items.find((entry) => entry.id === editingId) : undefined;
  const editingInvoiceDocument = editingEntry
    ? financeDocuments.find((document) => document.id === editingEntry.sourceDocumentId || editingEntry.id.startsWith(`${document.id}:expense:`))
    : undefined;
  const years = useMemo(() => {
    const values = new Set<number>([Number(localToday().slice(0, 4)), chartYear]);
    for (const item of items) { const month = getEntryPeriod(item, financeDocuments).month; if (month) values.add(Number(month.slice(0, 4))); }
    for (const doc of financeDocuments) { const month = getDocumentMonth(doc); if (month) values.add(Number(month.slice(0, 4))); }
    return [...values].filter(Number.isFinite).sort((a, b) => b - a);
  }, [items, financeDocuments, chartYear]);
  const holderDocuments = useMemo(() => financeDocuments.filter((doc) => matchesFinanceHolder(doc, holderFilter)), [financeDocuments, holderFilter]);
  const periodOptions = useMemo(() => {
    const months = new Set<string>([localToday().slice(0, 7)]);
    for (const item of items) { const month = getEntryPeriod(item, financeDocuments).month; if (month) months.add(month); }
    for (const doc of financeDocuments) { const month = getDocumentMonth(doc); if (month) months.add(month); }
    if (/^\d{4}-\d{2}$/.test(period)) months.add(period);
    return [...months].sort((a, b) => b.localeCompare(a));
  }, [items, financeDocuments, period]);
  const periodEntries = useMemo(() => filterEntriesByMonth(items, financeDocuments, period).filter((entry) => matchesFinanceHolder(entry, holderFilter)), [items, financeDocuments, period, holderFilter]);
  const summary = useMemo(() => summarizeEntries(periodEntries), [periodEntries]);
  const annualSeries = useMemo(() => buildMonthlySeries(items.filter((entry) => matchesFinanceHolder(entry, holderFilter)), financeDocuments, chartYear), [items, financeDocuments, chartYear, holderFilter]);
  const categoryGroups = useMemo(() => groupExpenses(periodEntries), [periodEntries]);
  const invoiceDocuments = useMemo(() => holderDocuments.filter((doc) => typeof doc.statementTotal === "number" || Boolean(doc.statementDueAt) || Boolean(doc.institution) || Boolean(doc.brand)), [holderDocuments]);
  const periodInvoiceDocuments = useMemo(() => invoiceDocuments.filter((doc) => period === "all" ? true : period === "undated" ? !getDocumentMonth(doc) : getDocumentMonth(doc) === period), [invoiceDocuments, period]);
  const filteredItems = useMemo(() => {
    const needle = searchText.trim().toLocaleLowerCase("pt-BR");
    return periodEntries.filter((item) => {
      if (typeFilter !== "all" && item.type !== typeFilter) return false;
      if (statusFilter !== "all" && item.status !== statusFilter) return false;
      if (categoryFilter !== "all" && (item.category ?? "Outros") !== categoryFilter) return false;
      return !needle || [item.description, item.category, item.source, item.institution, item.brand].some((value) => String(value ?? "").toLocaleLowerCase("pt-BR").includes(needle));
    });
  }, [periodEntries, typeFilter, statusFilter, categoryFilter, searchText]);

  const mutateEntries = async (update: (latest: Entry[]) => Entry[], successMessage: string) => {
    try {
      const latest = await readLocal<Entry[]>("irisFinances", items);
      const next = update(latest);
      await writeLocal("irisFinances", next);
      setItems(next);
      setMessage(successMessage);
      return true;
    } catch {
      setMessage("Não foi possível salvar as alterações neste dispositivo. Os dados anteriores foram mantidos.");
      return false;
    }
  };
  const saveDraft = async () => {
    const amount = parseBrlAmount(draft.amount);
    if (!draft.description.trim() || !Number.isFinite(amount) || amount <= 0 || Math.round(amount * 100) < 1 || !Number.isSafeInteger(Math.round(amount * 100))) { setMessage("Informe uma descrição e um valor válido maior que zero (ex.: 1.234,56), com até duas casas decimais."); return; }
    const holderSource = editingId && editingInvoiceDocument && !draft.manualHolderOverride
      ? "invoice"
      : editingId && draft.holder === editingEntry?.holder && !draft.manualHolderOverride
        ? editingEntry?.holderSource
        : "manual";
    const holder = editingInvoiceDocument && !draft.manualHolderOverride ? editingInvoiceDocument.holder : draft.holder;
    const fields = { type: draft.type, description: redactFinancialIdentifiers(draft.description.trim()), amount: Math.round(amount * 100) / 100, category: draft.category, status: draft.status, referenceDate: draft.referenceDate || undefined, dueAt: draft.dueAt, holder, holderSource };
    if (editingId) {
      const ok = await mutateEntries((latest) => latest.map((entry) => entry.id === editingId ? { ...entry, ...fields, createdAt: entry.createdAt } : entry), "Alterações salvas neste dispositivo.");
      if (ok) { setEditingId(null); setDraft(newDraft()); }
      return;
    }
    const entry: Entry = { id: crypto.randomUUID(), ...fields, createdAt: new Date().toISOString() };
    if (await mutateEntries((latest) => [entry, ...latest], "Lançamento salvo neste dispositivo.")) setDraft(newDraft());
  };
  const startEdit = (entry: Entry) => {
    const resolved = getEntryPeriod(entry, financeDocuments);
    const categories: readonly FinanceCategory[] = entry.type === "income" ? incomeCategories : expenseCategories;
    setEditingId(entry.id);
    setDraft({ type: entry.type, description: entry.description, amount: String(entry.amount).replace(".", ","), category: entry.category && categories.includes(entry.category) ? entry.category : "Outros", status: entry.status, referenceDate: entry.referenceDate ?? resolved.date ?? "", dueAt: entry.dueAt ?? "", holder: entry.holder, manualHolderOverride: entry.holderSource === "manual" || (entry.holder !== undefined && entry.holderSource === undefined) });
    document.getElementById("finance-entry-form")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  const remove = async (id: string) => {
    const target = items.find((item) => item.id === id);
    if (!target || !window.confirm(`Excluir “${redactFinancialIdentifiers(target.description)}” deste dispositivo? Esta ação não pode ser desfeita.`)) return;
    await mutateEntries((latest) => latest.filter((item) => item.id !== id), "Lançamento removido deste dispositivo.");
    if (editingId === id) { setEditingId(null); setDraft(newDraft()); }
  };

  const updateDocumentHolder = async (documentId: string, value: string) => {
    const nextHolder = parseFinanceHolder(value);
    try {
      const latestDocuments = await readLocal<StoredFinanceDocument[]>("irisDocuments", documents);
      const current = latestDocuments.find((document) => document.id === documentId);
      if (!current) { setMessage("A fatura não foi encontrada neste dispositivo; nenhum registro foi alterado."); return; }
      const latestEntries = await readLocal<Entry[]>("irisFinances", items);
      const nextEntries = propagateDocumentHolder(latestEntries, documentId, current.holder, nextHolder);
      const nextDocuments = latestDocuments.map((document) => document.id === documentId
        ? { ...document, holder: nextHolder, holderSource: "manual" as const }
        : document);
      await writeLocalBatch({ irisDocuments: nextDocuments, irisFinances: nextEntries });
      setDocuments(nextDocuments);
      setItems(nextEntries);
      setMessage(`Titular da fatura atualizado para ${financeHolderLabel(nextHolder)}. Lançamentos editados individualmente foram preservados.`);
    } catch {
      setMessage("Não foi possível salvar o titular neste dispositivo. Os dados anteriores foram mantidos.");
    }
  };

  const importFile = async (file: File, preferredId?: string, forceOcr = false) => {
    const safeName = redactFinancialIdentifiers(file.name);
    try { assertLocalFileSize(file, safeName); } catch (error) { setMessage(error instanceof Error ? error.message : "Arquivo acima do limite local de 50 MB."); return; }
    setBusy(true); setMessage(`Preparando a leitura local de ${safeName}…`);
    let document: StoredFinanceDocument | undefined;
    try {
      const hash = await financialFileHash(file);
      const storedDocuments = await readLocal<StoredFinanceDocument[]>("irisDocuments", []);
      const legacyHash = redactFinancialIdentifiers(`${file.name.toLowerCase()}|${file.size}|${file.lastModified}`);
      const existing = storedDocuments.find((item) => preferredId ? item.id === preferredId : item.hash === hash || item.hash === legacyHash);
      document = { ...existing, id: existing?.id ?? crypto.randomUUID(), name: safeName, mime: file.type || "application/octet-stream", size: file.size, folder: "Financeiro", kind: "financeiro", createdAt: existing?.createdAt ?? new Date().toISOString(), extractedText: existing?.extractedText ?? "", analysis: file.type.startsWith("image/") || file.type === "application/pdf" ? "arquivado · OCR necessário" : "arquivado · formato não textual", money: existing?.money ?? [], markers: {}, hash, reviewStatus: "pending", confidence: 0, holder: existing?.holder, holderSource: existing?.holderSource, blob: existing?.blob ?? new Blob([file], { type: file.type || "application/octet-stream" }), processing: true };
      await upsertStoredDocument(document);
      const { reading: result, statement, reliable } = await readFinancialDocument(file, ({ progress, status }) => setMessage(`${safeName} · ${status} (${Math.round(progress * 100)}%). Sem envio do PDF.`), forceOcr);
      const parsed = reliable ? statement.expenses : [];
      const warnings = [...statement.warnings, ...(result.warning ? [result.warning] : [])];
      const requestedHolder = preferredId ? undefined : importHolder;
      const existingHolderIsManual = existing?.holderSource === "manual";
      const detectedHolder = reliable ? statement.cardholder : undefined;
      const documentHolder = requestedHolder ?? (existingHolderIsManual ? existing?.holder : detectedHolder ?? existing?.holder);
      const documentHolderSource: StoredFinanceDocument["holderSource"] = requestedHolder ? "manual" : existingHolderIsManual ? "manual" : detectedHolder ? "statement" : existing?.holderSource;
      document = { ...document, kind: "financeiro", extractedText: reliable ? redactFinancialIdentifiers(result.text) : document.extractedText, analysis: reliable ? "texto extraído" : file.type.startsWith("image/") || file.type === "application/pdf" ? "arquivado · OCR necessário" : "arquivado · formato não textual", money: parsed.length ? parsed : document.money, total: parsed.length ? parsed.reduce((sum, line) => sum + line.amount, 0) : document.total, institution: statement.institution ?? document.institution, brand: statement.brand ?? document.brand, statementTotal: statement.statementTotal ?? document.statementTotal, statementDueAt: statement.statementDueAt ?? document.statementDueAt, holder: documentHolder, holderSource: documentHolderSource, warnings, confidence: result.confidence / 100, processing: false, processingError: undefined };
      const latestDocuments = await readLocal<StoredFinanceDocument[]>("irisDocuments", []);
      const latestEntries = await readLocal<Entry[]>("irisFinances", []);
      const builtEntries = parsed.length ? buildStatementEntries<Entry>(document, latestEntries) : latestEntries;
      const hasPreviousRows = latestEntries.some((entry) => entry.sourceDocumentId === document!.id || entry.id.startsWith(`${document!.id}:expense:`));
      const replacementBlocked = hasPreviousRows && (!parsed.length || builtEntries === latestEntries);
      let nextEntries = replacementBlocked ? latestEntries : builtEntries;
      if (replacementBlocked) {
        const previous = latestDocuments.find((item) => item.id === document!.id) ?? existing;
        const warning = "A releitura não encontrou transações suficientes ou não correspondeu a todos os lançamentos anteriores. O histórico, o vencimento e o período foram preservados; confira o PDF e tente novamente.";
        document = preserveBlockedStatementData(document, previous, warning);
      } else if (parsed.length > 0 && existing && existing.holder !== document.holder) {
        nextEntries = propagateDocumentHolder(builtEntries, document.id, existing.holder, document.holder);
      }
      const nextDocuments = [document, ...latestDocuments.filter((item) => item.id !== document!.id)];
      await writeLocalBatch({ irisDocuments: nextDocuments, irisFinances: nextEntries });
      setItems(nextEntries); setDocuments(nextDocuments);
      setMessage(replacementBlocked ? "Releitura incompleta ou divergente: nenhum lançamento anterior foi removido ou alterado. O histórico foi preservado; confira o PDF e use Editar para ajustes individuais." : parsed.length
        ? `${parsed.length} lançamento(s) individualizado(s) para revisão. Titular: ${financeHolderLabel(document.holder)}. ${document.institution ?? "Instituição não identificada"} · ${document.brand ?? "Bandeira não identificada"}. Números de conta e cartão omitidos da análise.${warnings.length ? ` ${warnings.join(" ")}` : ""}`
        : reliable ? `A leitura não encontrou transações confiáveis. Nenhum lançamento anterior foi apagado. Use “Ler imagem (OCR)” para tentar outra leitura.${warnings.length ? ` ${warnings.join(" ")}` : ""}` : `Leitura insuficiente (confiança ${Math.round(result.confidence)}%). Nenhum lançamento anterior foi apagado.${warnings.length ? ` ${warnings.join(" ")}` : ""}`);
      if (!preferredId) setImportHolder(undefined);
    } catch (error) {
      if (document) await upsertStoredDocument({ ...document, processing: false, processingError: error instanceof Error ? error.message : "Falha na leitura local." }).catch(() => undefined);
      setMessage(error instanceof Error ? redactFinancialIdentifiers(`Falha na leitura de ${safeName}. ${error.message}`) : `Falha na leitura de ${safeName}.`);
    } finally { setBusy(false); }
  };
  const reprocess = (doc: StoredFinanceDocument, forceOcr = false) => {
    if (!doc.blob) { setMessage("O PDF original não está neste navegador. Importe-o novamente para leitura."); return; }
    void importFile(new File([doc.blob], doc.name, { type: doc.mime }), doc.id, forceOcr);
  };
  const exportCsv = () => {
    const headers = ["Período", "Tipo", "Descrição", "Valor (BRL)", "Categoria", "Situação", "Data de referência", "Vencimento", "Arquivo de origem"];
    const rows = filteredItems.map((entry) => {
      const info = getEntryPeriod(entry, financeDocuments);
      return [info.month ? formatPeriodLabel(info.month) : "Sem data definida", typeLabel(entry.type), redactFinancialIdentifiers(entry.description), entry.amount.toFixed(2).replace(".", ","), entry.category ?? "Outros", statusLabel(entry.status), entry.referenceDate ?? info.date ?? "", entry.dueAt ?? "", redactFinancialIdentifiers(entry.source ?? "")].map(csvCell).join(",");
    });
    const name = period === "all" ? "historico-completo" : period === "undated" ? "sem-data" : period;
    downloadBlob(`iris-financas-${name}.csv`, `\uFEFF${[headers.map(csvCell).join(","), ...rows].join("\r\n")}`, "text/csv;charset=utf-8");
    setMessage("CSV do período e filtros atuais baixado. Dados pessoais derivados são sanitizados.");
  };
  const exportBackup = () => {
    downloadJson("iris-financas-backup.json", { format: "iris-finances", exportedAt: new Date().toISOString(), entries: items, statements: financeDocuments.map((doc) => ({ id: doc.id, name: redactFinancialIdentifiers(doc.name), institution: doc.institution, brand: doc.brand, holder: doc.holder, holderSource: doc.holderSource, statementTotal: doc.statementTotal, statementDueAt: doc.statementDueAt })) });
    setMessage("Cópia JSON do histórico financeiro baixada neste dispositivo.");
  };

  const openIncomeCount = periodEntries.filter((entry) => entry.type === "income" && entry.status === "open").length;
  const openExpenseCount = periodEntries.filter((entry) => entry.type === "expense" && entry.status === "open").length;
  const overdueCount = periodEntries.filter((entry) => entry.status === "overdue").length;
  const periodCaption = period === "all" ? "Histórico completo" : period === "undated" ? "Sem data definida" : formatPeriodLabel(period);
  const isMonth = /^\d{4}-\d{2}$/.test(period);
  const hasFilters = holderFilter !== "all" || typeFilter !== "all" || statusFilter !== "all" || categoryFilter !== "all" || Boolean(searchText.trim());
  const emptyMessage = periodEntries.length === 0
    ? period === "undated" ? "Não há lançamentos sem data definida. Se um registro importado estiver sem ano, use “Definir data” no histórico completo."
      : period === "all" ? "Nenhum lançamento cadastrado. Importe um documento ou crie sua primeira receita ou despesa."
        : "Nenhum lançamento neste mês. Os dados de outros períodos continuam salvos; navegue pelos meses ou abra o histórico completo."
    : "Nenhum lançamento corresponde aos filtros escolhidos. Ajuste ou limpe os filtros para ver outros registros.";

  return <main className="finance-page"><div className="finance-shell">
    <Link href="/" className="finance-back"><ArrowLeft size={18} /> Voltar ao início</Link>
    <header className="finance-hero"><div><div className="finance-eyebrow">IRIS FINANÇAS · LOCAL-FIRST</div><h1>Seu dinheiro, mês a mês</h1><p>Receitas e despesas com histórico, filtros e visão anual — sem misturar o total de uma fatura com as compras que ela detalha.</p></div><span className="finance-safe"><WalletCards size={16} /> Somente neste dispositivo</span></header>

    <section className="finance-period-card" aria-label="Escolher período financeiro">
      <div className="finance-period-title"><div><span className="finance-period-kicker">LIVRO FINANCEIRO</span><h2>{periodCaption}</h2></div><span className="finance-period-count">{periodEntries.length} {periodEntries.length === 1 ? "lançamento" : "lançamentos"}</span></div>
      <div className="finance-period-controls"><div className="finance-period-picker">
        <button type="button" className="finance-icon-button" disabled={!isMonth || period === "0001-01"} aria-label="Mês anterior" title="Mês anterior" onClick={() => isMonth && selectPeriod(previousMonth(period, -1))}><ChevronLeft size={19} /></button>
        <label className="finance-period-select-label"><span>Período</span><select aria-label="Selecionar período" value={period} onChange={(event) => selectPeriod(event.target.value)}><option value="all">Histórico completo</option><option value="undated">Sem data definida</option>{periodOptions.map((month) => <option key={month} value={month}>{formatPeriodLabel(month)}</option>)}</select></label>
        <button type="button" className="finance-icon-button" disabled={!isMonth || period === "9999-12"} aria-label="Próximo mês" title="Próximo mês" onClick={() => isMonth && selectPeriod(previousMonth(period, 1))}><ChevronRight size={19} /></button>
      </div><div className="finance-period-actions"><button type="button" className="finance-text-button" onClick={() => setPeriod("all")}>Histórico completo</button><button type="button" className="finance-text-button" onClick={() => setPeriod("undated")}>Sem data definida</button></div></div>
      <div className="finance-holder-filter"><label><span>Visualização por titular</span><select aria-label="Filtrar Finanças por titular" value={holderFilter} onChange={(event) => setHolderFilter(event.target.value as FinanceHolderFilter)}><option value="all">Todos os titulares</option><option value="rogerio">Rogério</option><option value="aline">Aline</option><option value="unassigned">Titular não definido</option></select></label><small>Os registros antigos sem identificação permanecem em “Titular não definido” até revisão ou nova leitura explícita da fatura.</small></div>
      <small className="finance-local-note">Histórico salvo neste dispositivo; faça backup antes de limpar o navegador.</small>
    </section>
    <section className="finance-summary-grid" aria-label={`Resumo financeiro de ${periodCaption}`}>
      <article className="finance-summary-card finance-summary-income"><span className="finance-summary-label">Receitas</span><strong>{money(summary.income)}</strong><small>{summary.incomeCount} lançamento(s) no período</small></article>
      <article className="finance-summary-card finance-summary-expense"><span className="finance-summary-label">Despesas</span><strong>{money(summary.expense)}</strong><small>{summary.expenseCount} lançamento(s) no período</small></article>
      <article className="finance-summary-card finance-summary-balance"><span className="finance-summary-label">Saldo dos lançamentos</span><strong>{money(summary.balance)}</strong><small>Receitas menos despesas; não é saldo bancário</small></article>
    </section>
    <p className="finance-open-note"><CalendarDays size={15} /> Em aberto: <b>{openIncomeCount} receita(s) · {money(summary.openIncome)} a receber</b> e <b>{openExpenseCount} despesa(s) · {money(summary.openExpense)} a pagar</b>. {overdueCount} vencido(s). Valores já compõem os totais do período.</p>
    <div className="finance-chart-year-control"><label htmlFor="finance-chart-year">Ano do gráfico</label><select id="finance-chart-year" value={chartYear} onChange={(event) => { const year = Number(event.target.value); setChartYear(year); if (isMonth) setPeriod(`${year}-${period.slice(5)}`); }}>{years.map((year) => <option key={year} value={year}>{year}</option>)}</select></div>
    <FinanceMonthlyChart year={chartYear} series={annualSeries} selectedMonth={period} onSelectMonth={selectPeriod} />

    <section className="finance-card finance-ledger-card">
      <div className="finance-section-head"><div><span className="finance-section-kicker">CONTROLE DO PERÍODO</span><h2><FileText size={20} /> Lançamentos</h2></div><span className="finance-filter-count">{filteredItems.length} de {periodEntries.length}</span></div>
      <form id="finance-entry-form" className="finance-entry-form" onSubmit={(event) => { event.preventDefault(); void saveDraft(); }}>
        <div className="finance-form-intro"><div><h3>{editingId ? "Editar lançamento" : "Adicionar lançamento"}</h3><p>Os valores são locais; editar preserva a data de cadastro e a origem do registro.</p></div>{editingId && <button type="button" className="finance-cancel-edit" onClick={() => { setEditingId(null); setDraft(newDraft()); }}><X size={15} /> Cancelar edição</button>}</div>
        <div className="finance-form-grid">
          <label><span>Tipo</span><select value={draft.type} onChange={(event) => { const type = event.target.value as Entry["type"]; const categories: readonly FinanceCategory[] = type === "income" ? incomeCategories : expenseCategories; setDraft({ ...draft, type, category: categories.includes(draft.category) ? draft.category : "Outros" }); }}><option value="income">Receita</option><option value="expense">Despesa</option></select></label>
          <label><span>Titular</span><select value={draft.holder ?? ""} onChange={(event) => setDraft({ ...draft, holder: parseFinanceHolder(event.target.value), manualHolderOverride: true })}><option value="">Titular não definido</option><option value="rogerio">Rogério</option><option value="aline">Aline</option></select></label>
          <label className="finance-form-description"><span>Descrição</span><input required maxLength={500} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Ex.: salário, mercado…" /></label>
          <label><span>Valor (R$)</span><input required inputMode="decimal" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} placeholder="1.234,56" /></label>
          <label><span>Categoria</span><select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value as FinanceCategory })}>{draftCategories.map((category) => <option value={category} key={category}>{category}</option>)}</select></label>
          <label><span>Situação</span><select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as Entry["status"] })}><option value="open">Em aberto</option><option value="paid">Pago/recebido</option><option value="overdue">Vencido</option></select></label>
          <label><span>Data de referência</span><input type="date" value={draft.referenceDate} onChange={(event) => setDraft({ ...draft, referenceDate: event.target.value })} /></label>
          <label><span>Vencimento (opcional)</span><input type="date" value={draft.dueAt} onChange={(event) => setDraft({ ...draft, dueAt: event.target.value })} /></label>
        </div>{editingInvoiceDocument && <label className="finance-holder-override"><input type="checkbox" checked={draft.manualHolderOverride} onChange={(event) => setDraft({ ...draft, manualHolderOverride: event.target.checked, holder: event.target.checked ? draft.holder : editingInvoiceDocument.holder })} /><span>Fixar titular desta despesa manualmente, inclusive como “Titular não definido”. Desmarque para seguir a fatura.</span></label>}<div className="finance-form-footer"><small>Novos lançamentos usam hoje como data de referência; altere se necessário. Vencimento é uma data separada.</small><Button type="submit"><Check size={15} /> {editingId ? "Salvar alterações" : "Salvar lançamento"}</Button></div>
      </form>
      {message && <div className="finance-message" role="status" aria-live="polite">{message}</div>}

      <div className="finance-filter-panel" aria-label="Filtrar lançamentos">
        <label className="finance-search"><span>Buscar</span><span className="finance-search-input"><Search size={16} /><input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Descrição, instituição, origem…" /></span></label>
        <label><span>Tipo</span><select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="all">Todas</option><option value="income">Receitas</option><option value="expense">Despesas</option></select></label>
        <label><span>Situação</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">Todas</option><option value="open">Em aberto</option><option value="paid">Pago/recebido</option><option value="overdue">Vencido</option></select></label>
        <label><span>Categoria</span><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="all">Todas</option>{allCategories.map((category) => <option value={category} key={category}>{category}</option>)}</select></label>
        {hasFilters && <button type="button" className="finance-clear-filters" onClick={() => { setHolderFilter("all"); setTypeFilter("all"); setStatusFilter("all"); setCategoryFilter("all"); setSearchText(""); }}>Limpar filtros</button>}
      </div>
      <div className="finance-list-tools"><span>Exibindo {filteredItems.length} {filteredItems.length === 1 ? "registro" : "registros"} · {periodCaption}</span><div><Button type="button" variant="outline" onClick={exportCsv} disabled={!filteredItems.length}><Download size={15} /> CSV deste filtro</Button><Button type="button" variant="outline" onClick={exportBackup} disabled={!items.length}><Download size={15} /> Backup JSON</Button></div></div>
      {filteredItems.length === 0 ? <div className="finance-empty" role="status">{emptyMessage}{period !== "all" && <div className="finance-empty-actions"><button type="button" onClick={() => setPeriod("all")}>Abrir histórico completo</button><button type="button" onClick={() => setPeriod("undated")}>Ver sem data definida</button></div>}</div> : <div className="finance-entry-list">{filteredItems.map((item) => {
        const date = getEntryPeriod(item, financeDocuments);
        const partialDate = Boolean(item.purchaseDate && /^(?:\d{1,2}[/-]\d{1,2}|\d{1,2}\s+[a-zç]{3,})$/i.test(item.purchaseDate));
        const needsDate = !date.month && (Boolean(item.sourceDocumentId) || partialDate);
        return <article className="finance-row" key={item.id}>
          <div className="finance-row-main"><div className={`finance-type-mark ${item.type}`} aria-label={typeLabel(item.type)}>{item.type === "income" ? "+" : "−"}</div><div className="finance-row-copy"><div className="finance-row-title"><span className={`finance-entry-type ${item.type}`}>{typeLabel(item.type)}</span><strong>{redactFinancialIdentifiers(item.description)}</strong></div><div className="finance-row-meta"><span>{item.category ?? "Outros"}</span><span>{money(item.amount)}</span><span>Titular: {financeHolderLabel(item.holder)}</span><span>{statusLabel(item.status)}</span>{date.month && <span>{date.date ? displayDate(date.date) : formatPeriodLabel(date.month)} · {date.basis}</span>}{item.dueAt && <span>Vencimento {displayDate(item.dueAt)}</span>}{item.source && <span>Origem: {redactFinancialIdentifiers(item.source)}</span>}{item.institution && <span>{redactFinancialIdentifiers(item.institution)}{item.brand ? ` · ${redactFinancialIdentifiers(item.brand)}` : ""}</span>}</div>{needsDate && <div className="finance-undated-notice"><span>{partialDate ? `Data importada “${item.purchaseDate}” sem ano definido` : "Este registro importado não tem período identificado"}. Ele permanece em “Sem data definida” até ser revisado.</span><Button type="button" variant="outline" size="sm" onClick={() => startEdit(item)}><Pencil size={14} /> Definir data</Button></div>}</div></div>
          <div className="finance-row-actions"><label><span>Situação</span><select value={item.status} aria-label={`Situação de ${item.description}`} onChange={(event) => void mutateEntries((latest) => latest.map((row) => row.id === item.id ? { ...row, status: event.target.value as Entry["status"] } : row), "Situação atualizada neste dispositivo.")}><option value="open">Em aberto</option><option value="paid">Pago/recebido</option><option value="overdue">Vencido</option></select></label><Button type="button" variant="outline" size="sm" onClick={() => startEdit(item)} aria-label={`Editar ${item.description}`}><Pencil size={14} /> Editar</Button><Button type="button" variant="ghost" size="sm" onClick={() => void remove(item.id)} aria-label={`Excluir ${item.description}`}><Trash2 size={15} /></Button></div>
        </article>;
      })}</div>}
    </section>

    <section className="finance-card" aria-label="Gastos agrupados por categoria"><h2><Receipt size={20} /> Despesas por categoria · {periodCaption}</h2><p className="finance-privacy-note">Somente despesas individualizadas no período. O total a pagar indicado em uma fatura permanece separado e não é lançado de novo como despesa.</p>{categoryGroups.length === 0 ? <div className="finance-empty">Sem despesas categorizadas neste período.</div> : categoryGroups.map((group) => <details className="finance-group" key={group.category}><summary><span>{group.category} · {group.count} lançamento(s)</span><strong>{money(group.total)}</strong></summary>{group.entries.map((entry) => <div className="finance-group-entry" key={entry.id}><span>{entry.purchaseDate ? `${entry.purchaseDate} · ` : ""}{redactFinancialIdentifiers(entry.description)}</span><b>{money(entry.amount)}</b></div>)}</details>)}</section>

    {periodInvoiceDocuments.length > 0 && <section className="finance-card finance-invoice-overview" aria-label={`Faturas e vencimentos de ${periodCaption}`}>
      <h2><WalletCards size={20} /> Faturas do período · pagamento</h2>
      <p className="finance-privacy-note">Total a pagar informado no documento, separado da soma de compras por segmento. Saldo anterior, pagamentos, créditos, estornos e ajustes podem fazer os valores diferirem. A fatura não é contabilizada como uma nova despesa.</p>
      {periodInvoiceDocuments.map((doc) => <div className="finance-invoice-payment" key={doc.id}>
        <div className="finance-invoice-header"><b>{redactFinancialIdentifiers(doc.name)}</b><small>{redactFinancialIdentifiers(doc.institution ?? "Instituição não identificada")} · {redactFinancialIdentifiers(doc.brand ?? "Bandeira não identificada")}{getDocumentMonth(doc) ? ` · ${formatPeriodLabel(getDocumentMonth(doc)!)}` : " · período não identificado"}</small><small>Titular: {financeHolderLabel(doc.holder)}{doc.holderSource === "statement" ? " · identificado no campo Titular da fatura" : doc.holderSource === "manual" ? " · classificado por você" : " · confira no histórico de documentos"}</small></div>
        <div className="finance-invoice-metrics"><div><span>Total a pagar no documento</span><strong>{typeof doc.statementTotal === "number" ? money(doc.statementTotal) : "Não identificado"}</strong></div><div><span>Vencimento identificado</span><strong>{displayDate(doc.statementDueAt)}</strong></div></div>
        <small>Compras individualizadas: {money((doc.money ?? []).reduce((sum, row) => sum + row.amount, 0))} · {doc.money?.length ?? 0} lançamento(s); valor bruto, não equivalente necessariamente ao total da fatura.</small>
        {!doc.statementDueAt && <small>Data ausente ou ambígua não é estimada. “Ler novamente” pode encontrar vencimento legível.</small>}
      </div>)}
    </section>}

    <section className="finance-import-card">
      <div className="finance-import-heading"><div><span className="finance-section-kicker">IMPORTAÇÃO LOCAL</span><h2>Importar documento de gastos</h2></div><span className="finance-local-chip">Sem envio automático</span></div>
      <p>PDF, JPG, PNG, CSV, TXT e JSON até 50 MB por arquivo. Salve planilhas Excel como CSV. A leitura processa até 100 páginas e até 16 milhões de pixels por página no OCR. A análise derivada omite números de conta e cartão, inclusive últimos dígitos.</p>
      <label className="finance-import-holder"><span>Titular (opcional)</span><select aria-label="Titular para nova fatura" value={importHolder ?? ""} onChange={(event) => setImportHolder(parseFinanceHolder(event.target.value))}><option value="">Identificar na fatura ou revisar depois</option><option value="rogerio">Rogério · escolha manual</option><option value="aline">Aline · escolha manual</option></select><small>Se não escolher, a Iris só atribui automaticamente quando encontrar um único nome correspondente em um campo Titular legível da fatura.</small></label>
      <div className="finance-import-actions"><label className="finance-import-button"><Upload size={17} /> Importar gastos<input type="file" hidden accept=".pdf,.jpg,.jpeg,.png,.csv,.txt,.json" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); event.currentTarget.value = ""; }} /></label></div>
      {message && <div className="finance-message" role="status" aria-live="polite">{message}</div>}
      <small className="finance-privacy-note">O documento original fica separado e local e pode conter dados pessoais. A análise e os relatórios não incluem números de conta/cartão. Os dados permanecem neste dispositivo; faça backup local antes de limpar o navegador.</small>
    </section>

    {holderDocuments.length > 0 && <details className="finance-card finance-document-history">
      <summary><span><FileText size={19} /> Histórico completo de faturas e documentos</span><small>{holderDocuments.length} documento(s) · titular: {holderFilter === "all" ? "todos" : financeHolderLabel(holderFilter === "unassigned" ? undefined : holderFilter)}</small></summary>
      <p className="finance-privacy-note">O histórico continua acessível mesmo ao consultar um mês vazio. Revise o titular identificado na fatura; a classificação ajusta apenas as despesas ligadas ao documento, preservando linhas editadas individualmente.</p>
      {holderDocuments.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((doc) => <div className="finance-statement" key={doc.id}>
        <strong>{redactFinancialIdentifiers(doc.name)}</strong>
        <small>{redactFinancialIdentifiers(doc.institution ?? "Instituição não identificada")} · {redactFinancialIdentifiers(doc.brand ?? "Bandeira não identificada")} · {doc.money?.length ?? 0} lançamento(s)</small>
        <label className="finance-document-holder"><span>Titular</span><select aria-label={`Titular de ${doc.name}`} value={doc.holder ?? ""} disabled={busy} onChange={(event) => void updateDocumentHolder(doc.id, event.target.value)}><option value="">Titular não definido</option><option value="rogerio">Rogério</option><option value="aline">Aline</option></select></label>
        <small>{doc.holderSource === "statement" ? "Iris identificou um nome correspondente no campo titular da fatura." : doc.holderSource === "manual" ? "Titular revisado ou escolhido manualmente." : "Titular não identificado automaticamente; escolha acima se souber quem é."}</small>
        <small>Período identificado: {getDocumentMonth(doc) ? formatPeriodLabel(getDocumentMonth(doc)!) : "Sem data definida"} · Vencimento no PDF: {displayDate(doc.statementDueAt)}</small>
        {typeof doc.statementTotal === "number" && <small>Total informado na fatura: {money(doc.statementTotal)}. Pode incluir saldo anterior e ajustes além das compras individualizadas.</small>}
        {doc.warnings?.map((warning, index) => <small key={index} className="finance-warning">{redactFinancialIdentifiers(warning)}</small>)}
        {doc.processingError && <small className="finance-warning">{redactFinancialIdentifiers(doc.processingError)}</small>}
        <div className="finance-import-actions"><Button type="button" variant="outline" onClick={() => reprocess(doc)} disabled={busy || !doc.blob}>Ler novamente</Button>{/pdf|image/.test(doc.mime) && <Button type="button" variant="outline" onClick={() => reprocess(doc, true)} disabled={busy || !doc.blob}>Ler imagem (OCR)</Button>}{!doc.blob && <small>O arquivo original não está mais neste navegador. Importe-o novamente para reler.</small>}</div>
      </div>)}
    </details>}

    <footer className="finance-footer"><span><WalletCards size={15} /> Histórico salvo neste dispositivo; faça backup antes de limpar o navegador.</span><Link href="/configuracoes">Backup completo nas Configurações <ChevronRight size={15} /></Link></footer>
  </div></main>;
}
