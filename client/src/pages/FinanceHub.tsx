import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  Download,
  FileText,
  Plus,
  Receipt,
  Trash2,
  Upload,
  WalletCards,
} from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { assertLocalFileSize, downloadJson, readLocal, writeLocal } from "@/lib/irisLocalStore";
import { readDocumentText } from "@/lib/localOcr";
import { parseExpenseLines, type ExpenseCategory } from "@shared/expenseParser";
import "./finance-hub.css";

type Entry = {
  id: string;
  type: "income" | "expense";
  description: string;
  amount: number;
  status: "open" | "paid" | "overdue";
  dueAt: string;
  createdAt: string;
  category?: ExpenseCategory;
  source?: string;
  sourceDocumentId?: string;
};

type StoredFinanceDocument = {
  id: string;
  name: string;
  mime: string;
  size: number;
  folder: string;
  kind: "saude" | "financeiro" | "geral";
  createdAt: string;
  extractedText: string;
  analysis: "texto extraído" | "arquivado · OCR necessário" | "arquivado · formato não textual";
  total?: number;
  money: Array<{
    category: ExpenseCategory;
    amount: number;
    source: string;
    date?: string;
  }>;
  markers: Record<string, number>;
  hash: string;
  reviewStatus: "pending" | "confirmed";
  confidence: number;
  blob?: Blob;
  processing?: boolean;
  processingError?: string;
};

const empty = {
  type: "expense" as Entry["type"],
  description: "",
  amount: "",
  status: "open" as Entry["status"],
  dueAt: "",
};
const expenseCategories: ExpenseCategory[] = [
  "Hotel",
  "Posto de combustível",
  "Supermercado",
  "Restaurante",
  "Farmácia",
  "Transporte",
  "Serviços",
  "Outros",
];
const healthTerms =
  /exame|laudo|hemoglobina|glicose|colesterol|triglicer|press[aã]o|consulta|laborat[oó]rio/i;
const financeTerms =
  /fatura|cart[aã]o|vencimento|parcela|estabelecimento|compra|lan[cç]amento|banco|visa|mastercard|elo|amex/i;
const money = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

async function upsertStoredDocument(document: StoredFinanceDocument) {
  const stored = await readLocal<StoredFinanceDocument[]>("irisDocuments", []);
  const next = [document, ...stored.filter((item) => item.id !== document.id)];
  await writeLocal("irisDocuments", next);
}

function classifyDocument(file: File, text: string): StoredFinanceDocument["kind"] {
  const combined = `${file.name} ${text}`;
  if (healthTerms.test(combined)) return "saude";
  if (financeTerms.test(combined) || parseExpenseLines(text).length > 0) {
    return "financeiro";
  }
  return "geral";
}

export default function FinanceHub() {
  const [items, setItems] = useState<Entry[]>([]);
  const [draft, setDraft] = useState(empty);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void readLocal<Entry[]>("irisFinances", [])
      .then(setItems)
      .catch(() => setMessage("Não foi possível abrir os lançamentos locais."));
  }, []);

  const addEntries = async (entries: Entry[], notice: string) => {
    const stored = await readLocal<Entry[]>("irisFinances", items);
    const incomingIds = new Set(entries.map((entry) => entry.id));
    const existingById = new Map(stored.map((entry) => [entry.id, entry]));
    const next = [
      ...entries.map((entry) => ({ ...existingById.get(entry.id), ...entry })),
      ...stored.filter((entry) => !incomingIds.has(entry.id)),
    ];
    setItems(next);
    await writeLocal("irisFinances", next);
    setMessage(notice);
  };

  const add = async () => {
    const amount = Number(String(draft.amount).replace(",", "."));
    if (!draft.description.trim() || !Number.isFinite(amount) || amount <= 0) {
      setMessage("Informe descrição e valor válido.");
      return;
    }

    const entry: Entry = {
      id: crypto.randomUUID(),
      type: draft.type,
      description: draft.description.trim(),
      amount,
      status: draft.status,
      dueAt: draft.dueAt,
      createdAt: new Date().toISOString(),
      category: "Outros",
    };
    await addEntries([entry], "Lançamento salvo neste dispositivo.");
    setDraft(empty);
  };

  const importFile = async (file: File) => {
    try {
      assertLocalFileSize(file, file.name);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Arquivo acima do limite local de 50 MB.");
      return;
    }
    setBusy(true);
    setMessage(`Salvando o original de ${file.name} neste dispositivo antes da leitura…`);
    const hash = `${file.name.toLowerCase()}|${file.size}|${file.lastModified}`;
    let document: StoredFinanceDocument | undefined;

    try {
      const storedDocuments = await readLocal<StoredFinanceDocument[]>("irisDocuments", []);
      if (storedDocuments.some((item) => item.hash === hash)) {
        setMessage("Este arquivo já está arquivado localmente; nada foi duplicado.");
        return;
      }

      document = {
        id: crypto.randomUUID(),
        name: file.name,
        mime: file.type || "application/octet-stream",
        size: file.size,
        folder: "Financeiro",
        kind: "financeiro",
        createdAt: new Date().toISOString(),
        extractedText: "",
        analysis: file.type.startsWith("image/") || file.type === "application/pdf"
          ? "arquivado · OCR necessário"
          : "arquivado · formato não textual",
        money: [],
        markers: {},
        hash,
        reviewStatus: "pending",
        confidence: 0,
        blob: file,
        processing: true,
      };
      await upsertStoredDocument(document);

      setMessage(`Original de ${file.name} salvo localmente. Lendo o documento…`);
      const result = await readDocumentText(file, ({ progress, status }) => {
        setMessage(
          `Original de ${file.name} salvo localmente · ${status} (${Math.round(progress * 100)}%).`,
        );
      });
      const kind = classifyDocument(file, result.text);
      const reliable =
        Boolean(result.text) &&
        (result.method !== "ocr" || result.confidence >= 45);
      const parsed = reliable && kind === "financeiro"
        ? parseExpenseLines(result.text)
        : [];

      document = {
        ...document,
        kind,
        extractedText: reliable ? result.text : "",
        analysis: reliable
          ? "texto extraído"
          : file.type.startsWith("image/") || file.type === "application/pdf"
            ? "arquivado · OCR necessário"
            : "arquivado · formato não textual",
        money: parsed,
        total: parsed.reduce((sum, line) => sum + line.amount, 0) || undefined,
        confidence: result.confidence / 100,
        processing: false,
        processingError: undefined,
      };
      await upsertStoredDocument(document);

      if (!parsed.length) {
        setMessage(
          reliable
            ? "Original arquivado. A leitura terminou, mas não encontrei despesas individualizadas para revisar."
            : `Original arquivado para revisão; leitura insuficiente (confiança ${Math.round(result.confidence)}%).${result.warning ? ` ${result.warning}` : ""}`,
        );
        return;
      }

      const entries: Entry[] = parsed.map((line, index) => ({
        id: `${document!.id}:expense:${index}`,
        type: "expense",
        description: line.source,
        amount: line.amount,
        status: "open",
        dueAt: "",
        createdAt: document!.createdAt,
        category: line.category,
        source: document!.name,
        sourceDocumentId: document!.id,
      }));
      await addEntries(
        entries,
        `${entries.length} despesa(s) adicionada(s) para revisão. Original salvo localmente; OCR ${Math.round(result.confidence)}%.`,
      );
    } catch (error) {
      if (document) {
        const failedDocument = {
          ...document,
          processing: false,
          processingError:
            error instanceof Error ? error.message : "Falha na leitura local.",
        };
        await upsertStoredDocument(failedDocument).catch(() => undefined);
      }
      setMessage(
        error instanceof Error
          ? `Falha na leitura de ${file.name}; o original continua arquivado localmente. ${error.message}`
          : `Falha na leitura de ${file.name}; o original continua arquivado localmente.`,
      );
    } finally {
      setBusy(false);
    }
  };

  const updateCategory = async (id: string, category: ExpenseCategory) => {
    const latest = await readLocal<Entry[]>("irisFinances", items);
    const next = latest.map((item) =>
      item.id === id ? { ...item, category } : item,
    );
    setItems(next);
    await writeLocal("irisFinances", next);
    setMessage("Categoria atualizada neste dispositivo.");
  };

  const remove = async (id: string) => {
    if (!window.confirm("Excluir este lançamento local?")) return;
    const latest = await readLocal<Entry[]>("irisFinances", items);
    const next = latest.filter((item) => item.id !== id);
    setItems(next);
    await writeLocal("irisFinances", next);
    setMessage("Lançamento removido deste dispositivo.");
  };

  const totals = useMemo(
    () =>
      items.reduce(
        (acc, item) => {
          acc[item.type] += item.amount;
          return acc;
        },
        { income: 0, expense: 0 },
      ),
    [items],
  );
  const overdue = items.filter(
    (item) =>
      item.status === "overdue" ||
      (item.dueAt &&
        item.dueAt < new Date().toISOString().slice(0, 10) &&
        item.status === "open"),
  );

  return (
    <main className="finance-page">
      <div className="finance-shell">
        <Link href="/" className="finance-back">
          <ArrowLeft size={20} /> Voltar ao Radar
        </Link>
        <div className="finance-hero">
          <div className="finance-eyebrow">IRIS FINANÇAS · LOCAL-FIRST</div>
          <h1>Contas sob controle</h1>
          <p>
            Importe documentos, separe lançamentos e revise contas a pagar e a
            receber sem envio automático.
          </p>
          <span className="finance-safe">
            <Receipt size={18} /> Somente neste dispositivo
          </span>
        </div>

        <section className="finance-import-card">
          <h2>Importar documento de gastos</h2>
          <p>
            PDF, JPG, PNG, CSV, TXT e JSON até 50 MB por arquivo. Salve planilhas Excel como CSV.
            PDFs para OCR
            têm até 100 páginas e 16 milhões de pixels por página. O original é salvo no
            dispositivo antes da leitura local; nenhuma despesa é criada sem
            texto e valores verificáveis.
          </p>
          <div className="finance-import-actions">
            <label className="finance-import-button">
              <Upload size={18} /> Importar gastos
              <input
                type="file"
                hidden
                accept=".pdf,.jpg,.jpeg,.png,.csv,.txt,.json"
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void importFile(file);
                  event.currentTarget.value = "";
                }}
              />
            </label>
          </div>
          {message && <div className="finance-message" role="status">{message}</div>}
        </section>

        <div className="finance-summary-grid">
          <div className="finance-summary-card">
            <WalletCards size={25} />
            <span>A pagar</span>
            <strong>{money(totals.expense)}</strong>
            <small>{items.filter((item) => item.type === "expense").length} lançamento(s)</small>
          </div>
          <div className="finance-summary-card">
            <WalletCards size={25} />
            <span>A receber</span>
            <strong>{money(totals.income)}</strong>
            <small>{items.filter((item) => item.type === "income").length} lançamento(s)</small>
          </div>
          <div className="finance-summary-card">
            <CalendarDays size={25} />
            <span>Vencidos</span>
            <strong>{overdue.length}</strong>
            <small>revisar pendência(s)</small>
          </div>
        </div>

        <section className="finance-card">
          <h2><Plus size={20} /> Novo lançamento</h2>
          <div className="finance-form">
            <select
              value={draft.type}
              onChange={(event) =>
                setDraft({ ...draft, type: event.target.value as Entry["type"] })
              }
            >
              <option value="expense">Conta a pagar</option>
              <option value="income">Conta a receber</option>
            </select>
            <input
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              placeholder="Descrição"
            />
            <input
              inputMode="decimal"
              value={draft.amount}
              onChange={(event) => setDraft({ ...draft, amount: event.target.value })}
              placeholder="Valor"
            />
            <select
              value={draft.status}
              onChange={(event) =>
                setDraft({ ...draft, status: event.target.value as Entry["status"] })
              }
            >
              <option value="open">Em aberto</option>
              <option value="paid">Pago/recebido</option>
              <option value="overdue">Vencido</option>
            </select>
            <input
              type="date"
              value={draft.dueAt}
              onChange={(event) => setDraft({ ...draft, dueAt: event.target.value })}
            />
            <Button onClick={() => void add()}><Plus size={15} /> Salvar</Button>
          </div>
        </section>

        <section className="finance-card">
          <div className="finance-list-head">
            <h2><FileText size={20} /> Lançamentos discriminados ({items.length})</h2>
            <Button
              variant="outline"
              onClick={() =>
                downloadJson("iris-financas.json", {
                  format: "iris-finances",
                  exportedAt: new Date().toISOString(),
                  entries: items,
                })
              }
            >
              <Download size={15} /> Exportar
            </Button>
          </div>
          {items.length === 0 ? (
            <div className="finance-empty">
              Nenhum lançamento cadastrado. Importe um documento de gastos ou
              adicione um lançamento manual.
            </div>
          ) : (
            items.map((item) => (
              <div className="finance-row" key={item.id}>
                <div>
                  <b>{item.type === "income" ? "A receber" : "A pagar"} · {item.description}</b>
                  <small>
                    {item.category || "Outros"} · {money(item.amount)} · {item.status}
                    {item.dueAt ? ` · vencimento ${item.dueAt}` : ""}
                    {item.source ? ` · ${item.source}` : ""}
                  </small>
                </div>
                <select
                  value={item.category ?? "Outros"}
                  onChange={(event) =>
                    void updateCategory(item.id, event.target.value as ExpenseCategory)
                  }
                  aria-label={`Categoria de ${item.description}`}
                >
                  {expenseCategories.map((category) => (
                    <option value={category} key={category}>{category}</option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void remove(item.id)}
                  aria-label={`Excluir ${item.description}`}
                >
                  <Trash2 size={15} />
                </Button>
              </div>
            ))
          )}
        </section>
      </div>
    </main>
  );
}
