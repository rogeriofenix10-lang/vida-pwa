import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Download,
  FileArchive,
  FileText,
  FileWarning,
  FolderHeart,
  ReceiptText,
  ScanText,
  Search,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { csvCell, downloadBlob, readLocal, writeLocal, writeLocalBatch, assertLocalFileSize } from "@/lib/irisLocalStore";
import { downloadIrisFile } from "@/lib/irisWorker";
import { readDocumentText, type DocumentReadResult } from "@/lib/localOcr";
import {
  buildStatementEntries,
  financialFileHash,
  readFinancialDocument,
  type FinancialEntry,
} from "@/lib/financeDocuments";
import { parseCardStatement, redactFinancialIdentifiers } from "@shared/cardStatement";
import { parseExpenseLines, type ExpenseCategory, type ParsedExpense } from "@shared/expenseParser";
import "./document-vault.css";

type Kind = "saude" | "financeiro" | "geral";
type Money = {
  category: ExpenseCategory;
  amount: number;
  source: string;
  date?: string;
};
type FinanceEntry = FinancialEntry;
type DocumentRecord = {
  id: string;
  name: string;
  mime: string;
  size: number;
  folder: string;
  kind: Kind;
  createdAt: string;
  extractedText: string;
  analysis:
    | "texto extraído"
    | "arquivado · OCR necessário"
    | "arquivado · formato não textual";
  institution?: string;
  brand?: string;
  total?: number;
  statementTotal?: number;
  statementDueAt?: string;
  warnings?: string[];
  money: Money[];
  markers: Record<string, number>;
  hash?: string;
  storageKey?: string;
  reviewStatus?: "pending" | "confirmed";
  confidence?: number;
  blob?: Blob;
  processing?: boolean;
  processingError?: string;
};

const healthTerms =
  /exame|laudo|hemoglobina|glicose|colesterol|triglicer|press[aã]o|consulta|laborat[oó]rio/i;
const financeTerms =
  /fatura|cart[aã]o|vencimento|parcela|estabelecimento|compra|lan[cç]amento|banco|visa|mastercard|elo|amex/i;
const explicitFinanceTerms =
  /fatura|cart[aã]o|transa[cç][oõ]es?|extrato|lan[cç]amentos?/i;
const statementSectionTerms = /^\s*(?:transa[cç][oõ]es\b|compras\s*(?:\/\s*pagamentos?)?\b)/im;

function safeStoredText(value: string, maxLength = 200000) {
  return redactFinancialIdentifiers(
    value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " "),
  ).slice(0, maxLength);
}

function safeFileName(value: string) {
  const leaf = value.replaceAll("\\", "/").split("/").pop() ?? value;
  return safeStoredText(leaf.replace(/[\u0000-\u001F\u007F]/g, "_"), 180).trim() || "documento";
}

function safeExpenses(expenses: ParsedExpense[]): Money[] {
  return expenses.map((expense) => ({
    ...expense,
    source: safeStoredText(expense.source, 500),
  }));
}

function safeWarnings(warnings: string[]) {
  return warnings.map((warning) => safeStoredText(warning, 500)).filter(Boolean);
}

function sanitizeDocumentForStorage(document: DocumentRecord): DocumentRecord {
  return {
    ...document,
    name: safeFileName(document.name),
    hash: document.hash && /^[a-f\d]{64}$/i.test(document.hash) ? document.hash : undefined,
    extractedText: safeStoredText(document.extractedText),
    institution: document.institution ? safeStoredText(document.institution, 100) : undefined,
    brand: document.brand ? safeStoredText(document.brand, 60) : undefined,
    warnings: safeWarnings(document.warnings ?? []),
    money: safeExpenses(document.money ?? []),
    processingError: document.processingError
      ? safeStoredText(document.processingError, 500)
      : undefined,
  };
}

function sanitizeFinanceEntries(entries: FinanceEntry[]) {
  return entries.map((entry) => ({
    ...entry,
    description: safeStoredText(entry.description, 500),
    source: entry.source ? safeStoredText(entry.source, 180) : undefined,
    institution: entry.institution ? safeStoredText(entry.institution, 100) : undefined,
    brand: entry.brand ? safeStoredText(entry.brand, 60) : undefined,
  }));
}

function parseMarkers(value: string) {
  const markers: Record<string, number> = {};
  const rules: [string, RegExp][] = [
    ["Hemoglobina", /hemoglobina[^\d]{0,20}(\d+[,.]?\d*)/i],
    ["Glicose", /glicose[^\d]{0,20}(\d+[,.]?\d*)/i],
    ["Colesterol total", /colesterol(?: total)?[^\d]{0,20}(\d+[,.]?\d*)/i],
    ["Triglicerídeos", /triglicer[ií]deos?[^\d]{0,20}(\d+[,.]?\d*)/i],
    ["TSH", /\bTSH[^\d]{0,20}(\d+[,.]?\d*)/i],
  ];
  for (const [label, rule] of rules) {
    const hit = value.match(rule);
    if (hit) markers[label] = Number(hit[1].replace(",", "."));
  }
  return markers;
}

function classify(file: File, text: string): Kind {
  const combined = `${file.name} ${text}`;
  if (statementSectionTerms.test(text) && explicitFinanceTerms.test(combined)) return "financeiro";
  const healthDocument = healthTerms.test(combined);
  if (healthDocument) return "saude";
  if (parseCardStatement(text).expenses.length > 0 || parseExpenseLines(text).length > 0) return "financeiro";
  if (financeTerms.test(combined)) return "financeiro";
  return "geral";
}

function moneyTotal(items: DocumentRecord[]) {
  return items
    .flatMap((item) => item.money)
    .reduce((sum, item) => sum + item.amount, 0);
}

function labelKind(kind: Kind) {
  return kind === "saude" ? "Saúde" : kind === "financeiro" ? "Financeiro" : "Geral";
}

function needsOcr(file: File) {
  return file.type.startsWith("image/") ||
    file.type === "application/pdf" ||
    /\.(pdf|jpe?g|png|tiff?|webp)$/i.test(file.name);
}

export default function DocumentVault() {
  const [items, setItems] = useState<DocumentRecord[]>([]);
  const [tab, setTab] = useState<"todos" | Kind | "revisao">("todos");
  const [query, setQuery] = useState("");
  const [month, setMonth] = useState("all");
  const [message, setMessage] = useState("");
  const [ocrId, setOcrId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void readLocal<DocumentRecord[]>("irisDocuments", [])
      .then((local) => {
        if (active) setItems(local);
      })
      .catch(() => {
        if (active) setMessage("Não foi possível abrir os documentos locais.");
      });
    return () => {
      active = false;
    };
  }, []);

  const save = async (next: DocumentRecord[]) => {
    const sanitized = next.map(sanitizeDocumentForStorage);
    setItems(sanitized);
    await writeLocal("irisDocuments", sanitized);
  };

  const persistDocument = async (document: DocumentRecord) => {
    const latest = await readLocal<DocumentRecord[]>("irisDocuments", items);
    const next = [document, ...latest.filter((item) => item.id !== document.id)];
    await save(next);
  };

  const upsertFinanceEntries = async (document: DocumentRecord) => {
    const safeDocument = sanitizeDocumentForStorage(document);
    const [latestDocuments, currentFinances] = await Promise.all([
      readLocal<DocumentRecord[]>("irisDocuments", items),
      readLocal<FinanceEntry[]>("irisFinances", []),
    ]);
    const nextDocuments = [safeDocument, ...latestDocuments
      .filter((item) => item.id !== safeDocument.id)
      .map(sanitizeDocumentForStorage)];
    if (safeDocument.kind === "financeiro" && safeDocument.money.length > 0) {
      const nextFinances = sanitizeFinanceEntries(
        buildStatementEntries(safeDocument, currentFinances),
      );
      await writeLocalBatch({ irisDocuments: nextDocuments, irisFinances: nextFinances });
    } else {
      // Empty/failed OCR never clears previously saved expense entries.
      await writeLocal("irisDocuments", nextDocuments);
    }
    setItems(nextDocuments);
  };

  const ingest = async (files: FileList | null) => {
    if (!files) return;

    const selected = Array.from(files);
    let currentItems = await readLocal<DocumentRecord[]>("irisDocuments", items);
    let archived = 0;
    let duplicates = 0;
    let failures = 0;
    const rejectedForSize: string[] = [];
    const knownHashes = new Set(
      currentItems.map((item) => item.hash).filter((hash): hash is string => Boolean(hash)),
    );

    for (const file of selected) {
      try {
        assertLocalFileSize(file, file.name);
      } catch {
        rejectedForSize.push(safeFileName(file.name));
        continue;
      }
      let hash: string;
      try {
        hash = await financialFileHash(file);
      } catch {
        failures += 1;
        setMessage("Não foi possível calcular uma impressão digital local segura; este arquivo não foi arquivado.");
        continue;
      }
      if (knownHashes.has(hash)) {
        duplicates += 1;
        continue;
      }
      knownHashes.add(hash);

      const record: DocumentRecord = {
        id: crypto.randomUUID(),
        name: safeFileName(file.name),
        mime: file.type || "application/octet-stream",
        size: file.size,
        folder: "Documentos",
        kind: classify(file, ""),
        createdAt: new Date().toISOString(),
        extractedText: "",
        analysis: needsOcr(file)
          ? "arquivado · OCR necessário"
          : "arquivado · formato não textual",
        money: [],
        markers: {},
        hash,
        reviewStatus: "pending",
        confidence: 0,
        // Keep the exact original bytes and MIME type locally without persisting its raw filename.
        blob: new Blob([file], { type: file.type || "application/octet-stream" }),
        processing: true,
      };

      try {
        // Persist the original and expose its row before starting PDF/OCR work.
        const latest = await readLocal<DocumentRecord[]>("irisDocuments", currentItems);
        currentItems = [record, ...latest.filter((item) => item.id !== record.id)]
          .map(sanitizeDocumentForStorage);
        setItems(currentItems);
        await writeLocal("irisDocuments", currentItems);
        archived += 1;
      } catch (error) {
        failures += 1;
        setMessage(
          `Não foi possível arquivar ${safeFileName(file.name)}; o processamento desse arquivo foi ignorado e o lote continuará.${error instanceof Error ? ` ${safeStoredText(error.message, 500)}` : ""}`,
        );
        continue;
      }

      try {
        setMessage(`Original de ${record.name} salvo localmente. Iniciando leitura…`);
        const onProgress = ({ progress, status }: { progress: number; status: string }) => {
          setMessage(
            `${record.name} · ${status} (${Math.round(progress * 100)}%). Original já salvo localmente.`,
          );
        };
        let financialRead: Awaited<ReturnType<typeof readFinancialDocument>> | undefined;
        let reading: DocumentReadResult;
        let kind: Kind;
        if (record.kind === "financeiro") {
          financialRead = await readFinancialDocument(file, onProgress);
          reading = financialRead.reading;
          kind = "financeiro";
        } else {
          reading = await readDocumentText(file, onProgress);
          kind = classify(file, reading.text);
          if (kind === "financeiro") {
            financialRead = await readFinancialDocument(file, onProgress);
            reading = financialRead.reading;
          }
        }
        const reliable = financialRead?.reliable ?? (
          Boolean(reading.text) && (reading.method !== "ocr" || reading.confidence >= 45)
        );
        const parsedExpenses = financialRead?.statement.expenses ?? [];
        const money = reliable && kind === "financeiro" ? safeExpenses(parsedExpenses) : [];
        const statement = financialRead?.statement;
        const warnings = financialRead
          ? safeWarnings([...(statement?.warnings ?? []), ...(reading.warning ? [reading.warning] : [])])
          : [];
        const updated: DocumentRecord = {
          ...record,
          folder:
            kind === "saude"
              ? "Exames"
              : kind === "financeiro"
                ? "Financeiro"
                : "Documentos",
          kind,
          extractedText: reliable ? safeStoredText(reading.text) : "",
          analysis: reliable
            ? "texto extraído"
            : needsOcr(file)
              ? "arquivado · OCR necessário"
              : "arquivado · formato não textual",
          institution: reliable && statement?.institution
            ? safeStoredText(statement.institution, 100)
            : undefined,
          brand: reliable && statement?.brand
            ? safeStoredText(statement.brand, 60)
            : undefined,
          total: money.reduce((sum, line) => sum + line.amount, 0) || undefined,
          statementTotal: reliable ? statement?.statementTotal : undefined,
          statementDueAt: reliable ? statement?.statementDueAt : undefined,
          warnings,
          money,
          markers: kind === "saude" && reliable ? parseMarkers(reading.text) : {},
          confidence: reading.confidence / 100,
          processing: false,
          processingError: undefined,
        };
        currentItems = [updated, ...currentItems.filter((item) => item.id !== updated.id)];
        if (updated.kind === "financeiro") await upsertFinanceEntries(updated);
        else await persistDocument(updated);
      } catch (error) {
        failures += 1;
        const latestRecords = await readLocal<DocumentRecord[]>("irisDocuments", currentItems).catch(
          () => currentItems,
        );
        const latestRecord = latestRecords.find((item) => item.id === record.id) ?? record;
        const failed: DocumentRecord = {
          ...latestRecord,
          processing: false,
          processingError: safeStoredText(
            error instanceof Error ? error.message : "Falha durante a leitura local.",
            500,
          ),
        };
        try {
          await persistDocument(failed);
          currentItems = [failed, ...currentItems.filter((item) => item.id !== failed.id)];
        } catch {
          // The original was persisted before parsing; keep the in-memory row if retry storage fails.
          setItems([failed, ...currentItems.filter((item) => item.id !== failed.id)]);
        }
      }
    }

    const notices = [
      `${archived} arquivo(s) arquivado(s) localmente`,
      duplicates ? `${duplicates} duplicado(s) ignorado(s)` : "",
      rejectedForSize.length
        ? `${rejectedForSize.length} arquivo(s) acima de 50 MB recusado(s) antes de leitura e arquivamento: ${rejectedForSize.slice(0, 3).join(", ")}${rejectedForSize.length > 3 ? "…" : ""}`
        : "",
      failures ? `${failures} falha(s) individual(is); os originais arquivados continuam disponíveis` : "",
    ].filter(Boolean);
    setMessage(notices.join("; ") + ".");
  };

  const availableMonths = useMemo(
    () =>
      [...new Set(items.map((item) => item.createdAt.slice(0, 7)))]
        .sort()
        .reverse(),
    [items],
  );
  const filtered = useMemo(
    () =>
      items.filter(
        (item) =>
          (tab === "todos" || tab === "revisao" || item.kind === tab) &&
          (tab !== "revisao" || item.reviewStatus === "pending") &&
          (month === "all" || item.createdAt.slice(0, 7) === month) &&
          item.name.toLowerCase().includes(query.toLowerCase()),
      ),
    [items, tab, query, month],
  );

  const confirmDocument = async (id: string) => {
    const latest = await readLocal<DocumentRecord[]>("irisDocuments", items);
    await save(
      latest.map((item) =>
        item.id === id ? { ...item, reviewStatus: "confirmed" as const } : item,
      ),
    );
  };

  const runOcr = async (item: DocumentRecord, forceOcr = false) => {
    setOcrId(item.id);
    setMessage("Leitura local em andamento. O original permanece arquivado neste dispositivo.");

    let started: DocumentRecord = {
      ...item,
      name: safeFileName(item.name),
      hash: undefined,
      processing: true,
      processingError: undefined,
    };
    try {
      const source = item.blob ?? (item.storageKey ? await downloadIrisFile(item.id) : null);
      if (!source) {
        throw new Error("O arquivo original não está disponível para leitura local.");
      }

      started = { ...started, hash: await financialFileHash(source) };
      await persistDocument(started);
      const file = new File([source], started.name, { type: item.mime });
      const onProgress = ({ progress, status }: { progress: number; status: string }) => {
        setMessage(`Leitura local de ${item.name} · ${status} (${Math.round(progress * 100)}%).`);
      };
      let financialRead: Awaited<ReturnType<typeof readFinancialDocument>> | undefined;
      let reading: DocumentReadResult;
      let kind: Kind;
      if (item.kind === "financeiro" || classify(file, "") === "financeiro") {
        financialRead = await readFinancialDocument(file, onProgress, forceOcr);
        reading = financialRead.reading;
        kind = "financeiro";
      } else {
        reading = await readDocumentText(file, onProgress);
        kind = reading.text ? classify(file, reading.text) : item.kind;
        if (kind === "financeiro") {
          financialRead = await readFinancialDocument(file, onProgress, forceOcr);
          reading = financialRead.reading;
        }
      }
      const reliable = financialRead?.reliable ?? (
        Boolean(reading.text) && (reading.method !== "ocr" || reading.confidence >= 45)
      );
      const parsedExpenses = financialRead?.statement.expenses ?? [];
      const parsedMoney = reliable && kind === "financeiro" ? safeExpenses(parsedExpenses) : [];
      const money = reliable && kind === "financeiro"
        ? parsedMoney.length > 0 ? parsedMoney : item.money
        : reliable ? [] : item.money;
      const statement = financialRead?.statement;
      const warnings = financialRead && reliable
        ? safeWarnings([...(statement?.warnings ?? []), ...(reading.warning ? [reading.warning] : [])])
        : item.warnings ?? [];
      const updated: DocumentRecord = {
        ...started,
        folder:
          kind === "saude"
            ? "Exames"
            : kind === "financeiro"
              ? "Financeiro"
              : item.folder,
        kind,
        extractedText: reliable ? safeStoredText(reading.text) : item.extractedText,
        analysis: reliable ? "texto extraído" : item.analysis,
        institution: reliable && statement?.institution
          ? safeStoredText(statement.institution, 100)
          : item.institution,
        brand: reliable && statement?.brand
          ? safeStoredText(statement.brand, 60)
          : item.brand,
        total: money.length > 0
          ? money.reduce((sum, line) => sum + line.amount, 0)
          : item.total,
        statementTotal: reliable && statement?.statementTotal !== undefined
          ? statement.statementTotal
          : item.statementTotal,
        statementDueAt: reliable && statement?.statementDueAt !== undefined
          ? statement.statementDueAt
          : item.statementDueAt,
        warnings,
        money,
        markers: reliable
          ? kind === "saude"
            ? parseMarkers(reading.text)
            : {}
          : item.markers,
        confidence: reliable ? reading.confidence / 100 : item.confidence,
        processing: false,
        processingError: undefined,
      };
      if (updated.kind === "financeiro") await upsertFinanceEntries(updated);
      else await persistDocument(updated);
      setMessage(
        reliable
          ? `Leitura local concluída · confiança ${Math.round(reading.confidence)}%.${reading.warning ? ` ${safeStoredText(reading.warning, 500)}` : ""}`
          : `Documento continua pendente: leitura insuficiente (confiança ${Math.round(reading.confidence)}%).${reading.warning ? ` ${safeStoredText(reading.warning, 500)}` : ""}`,
      );
    } catch (error) {
      const latestRecords = await readLocal<DocumentRecord[]>("irisDocuments", items).catch(
        () => items,
      );
      const latestRecord = latestRecords.find((current) => current.id === item.id) ?? started;
      const failed = {
        ...latestRecord,
        processing: false,
        processingError: safeStoredText(
          error instanceof Error ? error.message : "OCR local indisponível.",
          500,
        ),
      };
      await persistDocument(failed).catch(() => undefined);
      setMessage(
        error instanceof Error
          ? `Falha na leitura local; o original continua arquivado. ${error.message}`
          : "Falha na leitura local; o original continua arquivado.",
      );
    } finally {
      setOcrId(null);
    }
  };

  const downloadDocument = async (item: DocumentRecord) => {
    try {
      if (item.blob) {
        downloadBlob(item.name, item.blob, item.mime);
      } else if (item.storageKey) {
        const blob = await downloadIrisFile(item.id);
        downloadBlob(item.name, blob, item.mime || blob.type || "application/octet-stream");
      } else {
        setMessage("O arquivo original não está disponível para download neste dispositivo.");
        return;
      }
      setMessage(`Download de ${item.name} iniciado.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível baixar o documento.");
    }
  };

  const financeItems = items.filter(
    (item) =>
      item.kind === "financeiro" &&
      (month === "all" || item.createdAt.slice(0, 7) === month),
  );
  const finance = useMemo(() => {
    const map = new Map<ExpenseCategory, number>();
    for (const item of financeItems) {
      for (const entry of item.money) {
        map.set(entry.category, (map.get(entry.category) ?? 0) + entry.amount);
      }
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [financeItems]);
  const exams = [...items.filter((item) => item.kind === "saude")].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt),
  );
  const latest = exams[0];
  const previous = exams[1];

  const exportCsv = () => {
    const rows = [
      ["arquivo", "data", "categoria", "valor", "bandeira", "instituicao"],
      ...financeItems.flatMap((item) =>
        item.money.map((entry) => [
          item.name,
          entry.date ?? item.createdAt.slice(0, 10),
          entry.category,
          entry.amount.toFixed(2),
          item.brand ?? "",
          item.institution ?? "",
        ]),
      ),
    ];
    const csv = rows
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n");
    downloadBlob(
      `iris-gastos-${month === "all" ? "todos" : month}.csv`,
      `\uFEFF${csv}`,
      "text/csv;charset=utf-8",
    );
  };

  return (
    <main className="document-vault">
      <div className="document-vault-head">
        <Link href="/" className="back-link">
          <ArrowLeft size={16} /> Radar
        </Link>
        <div>
          <div className="eyebrow">IRIS LOCAL · ARQUIVO INTELIGENTE</div>
          <h1>Documentos sob controle</h1>
          <p>
            Arquive, organize e analise no dispositivo. Cada resultado informa
            sua origem e seus limites.
          </p>
        </div>
        <div className="document-trust">
          <ShieldCheck size={16} /> Sem envio automático
        </div>
      </div>

      <section className="document-upload">
        <div>
          <strong>Adicionar documentos</strong>
          <p>
            PDF, imagens, texto e CSV até 50 MB por arquivo. Para analisar uma planilha Excel, salve ou exporte como CSV.
            PDFs aceitos para OCR têm até 100 páginas e 16 milhões de pixels por página.
            O original fica local, sem alterar seu conteúdo, e pode conter números identificadores. Textos e lançamentos derivados são mascarados e não são enviados a armazenamentos remotos.
          </p>
        </div>
        <label className="button-like">
          <Upload size={16} /> Escolher arquivos
          <input
            type="file"
            multiple
            accept=".pdf,.txt,.csv,.json,.xml,.doc,.docx,image/*"
            hidden
            onChange={(event) => {
              void ingest(event.target.files);
              event.currentTarget.value = "";
            }}
          />
        </label>
      </section>

      <div className="document-tabs">
        <button className={tab === "todos" ? "active" : ""} onClick={() => setTab("todos")}>
          Todos <span>{items.length}</span>
        </button>
        <button className={tab === "saude" ? "active" : ""} onClick={() => setTab("saude")}>
          <FolderHeart size={15} /> Exames <span>{exams.length}</span>
        </button>
        <button className={tab === "financeiro" ? "active" : ""} onClick={() => setTab("financeiro")}>
          <ReceiptText size={15} /> Gastos{" "}
          <span>{items.filter((item) => item.kind === "financeiro").length}</span>
        </button>
        <button className={tab === "revisao" ? "active" : ""} onClick={() => setTab("revisao")}>
          Revisão{" "}
          <span>{items.filter((item) => item.reviewStatus === "pending").length}</span>
        </button>
      </div>

      {message && <div className="document-message" role="status">{message}</div>}

      <section className="document-layout">
        <div className="document-list">
          <div className="document-list-head">
            <strong>Arquivo local</strong>
            <select
              className="document-month-filter"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
              aria-label="Filtrar por mês"
            >
              <option value="all">Todos os meses</option>
              {availableMonths.map((value) => (
                <option value={value} key={value}>{value}</option>
              ))}
            </select>
            <label>
              <Search size={15} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar arquivo"
              />
            </label>
          </div>

          {filtered.length === 0 ? (
            <div className="document-empty">
              <FileArchive size={30} />
              <p>Nenhum documento nesta visão.</p>
            </div>
          ) : (
            filtered.map((item) => (
              <article className="document-row" key={item.id}>
                <div className="document-icon"><FileText size={18} /></div>
                <div className="document-row-main">
                  <strong>{item.name}</strong>
                  <small>
                    {labelKind(item.kind)} · pasta {item.folder} · {(item.size / 1024).toFixed(0)} KB
                  </small>
                  {item.kind === "financeiro" && item.statementDueAt && <small>Vencimento da fatura: {item.statementDueAt.split("-").reverse().join("/")}</small>}
                  {item.processing && (
                    <small className="document-warn">
                      Processando localmente… o original já foi salvo neste dispositivo.
                    </small>
                  )}
                  {item.processingError && (
                    <small className="document-warn">
                      Falha individual de leitura; original preservado. {item.processingError}
                    </small>
                  )}
                  <small className={item.analysis === "texto extraído" ? "document-ok" : "document-warn"}>
                    {item.analysis} ·{" "}
                    <span className="document-confidence">
                      confiança {Math.round((item.confidence ?? 0) * 100)}%{" "}
                      <span className="document-confidence-meter" aria-hidden="true">
                        <i style={{ width: `${Math.round((item.confidence ?? 0) * 100)}%` }} />
                      </span>
                    </span>
                  </small>
                  {item.reviewStatus === "pending" && (
                    <button
                      className="document-confirm"
                      type="button"
                      disabled={item.processing}
                      onClick={() => void confirmDocument(item.id)}
                    >
                      Confirmar revisão
                    </button>
                  )}
                  {(item.kind === "financeiro"
                    ? Boolean(item.blob || item.storageKey)
                    : !item.extractedText && Boolean(item.blob || item.storageKey)) && (
                    <button
                      className="document-confirm"
                      type="button"
                      disabled={ocrId === item.id || item.processing}
                      onClick={() => void runOcr(item)}
                    >
                      <ScanText size={14} />{" "}
                      {ocrId === item.id
                        ? "Lendo localmente…"
                        : item.kind === "financeiro" && item.extractedText
                          ? "Reprocessar fatura"
                          : "Tentar leitura local"}
                    </button>
                  )}
                  {item.kind === "financeiro" && item.blob && (
                    <button
                      className="document-confirm"
                      type="button"
                      disabled={ocrId === item.id || item.processing}
                      onClick={() => void runOcr(item, true)}
                    >
                      <ScanText size={14} /> Forçar OCR
                    </button>
                  )}
                  {item.kind === "financeiro" && (
                    <small>
                      {item.brand ?? "Bandeira não identificada"}
                      {` · ${item.institution ?? "Instituição não identificada"}`}
                      {item.total !== undefined ? ` · Soma identificada: R$ ${item.total.toFixed(2).replace(".", ",")}` : ""}
                    </small>
                  )}
                  {item.kind === "financeiro" && item.statementTotal !== undefined && (
                    <small>
                      Total informado na fatura: R$ {item.statementTotal.toFixed(2).replace(".", ",")} · comparação com lançamentos é informativa.
                    </small>
                  )}
                  {item.kind === "financeiro" && item.warnings?.map((warning, index) => (
                    <small className="document-warn" key={`${item.id}-warning-${index}`}>
                      Conferência informativa: {warning}
                    </small>
                  ))}
                  {(item.blob || item.storageKey) && (
                    <button
                      className="document-confirm"
                      type="button"
                      onClick={() => void downloadDocument(item)}
                    >
                      <Download size={14} /> Baixar arquivo original
                    </button>
                  )}
                </div>
              </article>
            ))
          )}
        </div>

        <aside className="document-insights">
          <div className="insight-card">
            <strong>Resumo financeiro</strong>
            <button
              className="document-export"
              type="button"
              onClick={exportCsv}
              disabled={financeItems.length === 0}
            >
              <Download size={13} /> CSV
            </button>
            <small className="document-period-label">
              {month === "all" ? "Todos os períodos" : `Período ${month}`}
            </small>
            <b>R$ {moneyTotal(financeItems).toFixed(2).replace(".", ",")}</b>
            {finance.length === 0 ? (
              <small>Adicione uma fatura com valores legíveis para consolidar.</small>
            ) : (
              finance.map(([category, amount]) => (
                <div className="insight-line" key={category}>
                  <span>{category}</span>
                  <span>R$ {amount.toFixed(2).replace(".", ",")}</span>
                </div>
              ))
            )}
          </div>

          <div className="insight-card">
            <strong>Comparação de exames</strong>
            {!latest ? (
              <small>Adicione PDF ou imagem de exame.</small>
            ) : (
              <>
                {Object.entries(latest.markers).map(([name, value]) => (
                  <div className="insight-line" key={name}>
                    <span>{name}</span>
                    <span>{value}</span>
                  </div>
                ))}
                {previous && (
                  <small>
                    Comparação com {previous.name}: {" "}
                    {Object.keys(latest.markers).filter(
                      (name) => typeof previous.markers[name] === "number",
                    ).length}{" "}
                    marcador(es) em comum.
                    {Object.entries(latest.markers)
                      .filter(([name]) => typeof previous.markers[name] === "number")
                      .map(
                        ([name, value]) =>
                          ` ${name}: ${value - (previous.markers[name] ?? value) >= 0 ? "+" : ""}${(value - (previous.markers[name] ?? value)).toFixed(2)};`,
                      )}
                  </small>
                )}
                <small>Informativo; não substitui avaliação médica.</small>
              </>
            )}
          </div>
        </aside>
      </section>

      <p className="document-footnote">
        <span className="document-disclaimer">
          <FileWarning size={15} /> PDFs com camada de texto e arquivos textuais
          podem ser lidos localmente. PDFs escaneados, imagens, DOC/DOCX e
          XLS/XLSX ficam arquivados com segurança e sinalizados para leitura
          local; esta versão não inventa resultados, não substitui profissionais
          e não envia arquivos automaticamente a serviços externos.
        </span>
      </p>
    </main>
  );
}
