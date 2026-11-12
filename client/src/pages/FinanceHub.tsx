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
import { assertLocalFileSize, downloadJson, readLocal, writeLocal, writeLocalBatch } from "@/lib/irisLocalStore";
import { buildStatementEntries, financialFileHash, groupExpenses, readFinancialDocument, type FinancialEntry } from "@/lib/financeDocuments";
import { EXPENSE_CATEGORIES, inferExpenseCategory, type ExpenseCategory } from "@shared/expenseParser";
import { redactFinancialIdentifiers } from "@shared/cardStatement";
import "./finance-hub.css";

type Entry = FinancialEntry;

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
  institution?: string;
  brand?: string;
  statementTotal?: number;
  warnings?: string[];
};

const empty = {
  type: "expense" as Entry["type"],
  description: "",
  amount: "",
  status: "open" as Entry["status"],
  dueAt: "",
};
const expenseCategories = EXPENSE_CATEGORIES;
const money = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

async function upsertStoredDocument(document: StoredFinanceDocument) {
  const stored = await readLocal<StoredFinanceDocument[]>("irisDocuments", []);
  const next = [document, ...stored.filter((item) => item.id !== document.id)];
  await writeLocal("irisDocuments", next);
}

export default function FinanceHub() {
  const [items, setItems] = useState<Entry[]>([]);
  const [draft, setDraft] = useState(empty);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [documents, setDocuments] = useState<StoredFinanceDocument[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  useEffect(() => {
    let active = true;
    const load = () => void Promise.all([
      readLocal<Entry[]>("irisFinances", []),
      readLocal<StoredFinanceDocument[]>("irisDocuments", []),
    ]).then(([entries, docs]) => {
      if (active) { setItems(entries); setDocuments(docs); }
    }).catch(() => { if (active) setMessage("Não foi possível abrir os lançamentos locais."); });
    load();
    window.addEventListener("iris-local-changed", load);
    return () => { active = false; window.removeEventListener("iris-local-changed", load); };
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
      description: redactFinancialIdentifiers(draft.description.trim()),
      amount,
      status: draft.status,
      dueAt: draft.dueAt,
      createdAt: new Date().toISOString(),
      category: inferExpenseCategory(draft.description),
    };
    await addEntries([entry], "Lançamento salvo neste dispositivo.");
    setDraft(empty);
  };

  const importFile = async (file: File, preferredId?: string, forceOcr = false) => {
    const safeName = redactFinancialIdentifiers(file.name);
    try {
      assertLocalFileSize(file, safeName);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Arquivo acima do limite local de 50 MB.");
      return;
    }
    setBusy(true);
    setMessage(`Preparando a leitura local de ${safeName}…`);
    let document: StoredFinanceDocument | undefined;

    try {
      const hash = await financialFileHash(file);
      const storedDocuments = await readLocal<StoredFinanceDocument[]>("irisDocuments", []);
      const legacyHash = redactFinancialIdentifiers(`${file.name.toLowerCase()}|${file.size}|${file.lastModified}`);
      const existing = storedDocuments.find((item) => preferredId ? item.id === preferredId : item.hash === hash || item.hash === legacyHash);

      document = {
        ...existing,
        id: existing?.id ?? crypto.randomUUID(),
        name: safeName,
        mime: file.type || "application/octet-stream",
        size: file.size,
        folder: "Financeiro",
        kind: "financeiro",
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        extractedText: existing?.extractedText ?? "",
        analysis: file.type.startsWith("image/") || file.type === "application/pdf"
          ? "arquivado · OCR necessário"
          : "arquivado · formato não textual",
        money: existing?.money ?? [],
        markers: {},
        hash,
        reviewStatus: "pending",
        confidence: 0,
        blob: existing?.blob ?? new Blob([file], { type: file.type || "application/octet-stream" }),
        processing: true,
      };
      await upsertStoredDocument(document);

      const { reading: result, statement, reliable } = await readFinancialDocument(file, ({ progress, status }) => {
        setMessage(
          `${safeName} · ${status} (${Math.round(progress * 100)}%). Sem envio do PDF.`,
        );
      }, forceOcr);
      const parsed = reliable ? statement.expenses : [];
      const warnings = [...statement.warnings, ...(result.warning ? [result.warning] : [])];

      document = {
        ...document,
        kind: "financeiro",
        extractedText: reliable ? redactFinancialIdentifiers(result.text) : document.extractedText,
        analysis: reliable
          ? "texto extraído"
          : file.type.startsWith("image/") || file.type === "application/pdf"
            ? "arquivado · OCR necessário"
            : "arquivado · formato não textual",
        money: parsed.length ? parsed : document.money,
        total: parsed.length ? parsed.reduce((sum, line) => sum + line.amount, 0) : document.total,
        institution: statement.institution ?? document.institution,
        brand: statement.brand ?? document.brand,
        statementTotal: statement.statementTotal ?? document.statementTotal,
        warnings,
        confidence: result.confidence / 100,
        processing: false,
        processingError: undefined,
      };
      const latestDocuments = await readLocal<StoredFinanceDocument[]>("irisDocuments", []);
      const latestEntries = await readLocal<Entry[]>("irisFinances", []);
      const nextEntries = parsed.length ? buildStatementEntries(document, latestEntries) : latestEntries;
      const nextDocuments = [document, ...latestDocuments.filter((item) => item.id !== document!.id)];
      await writeLocalBatch({ irisDocuments: nextDocuments, irisFinances: nextEntries });
      setItems(nextEntries);
      setDocuments(nextDocuments);

      if (!parsed.length) {
        setMessage(
          reliable
            ? `A leitura não encontrou transações confiáveis. Nenhum lançamento anterior foi apagado. Use “Ler imagem (OCR)” abaixo para tentar outra leitura.${warnings.length ? ` ${warnings.join(" ")}` : ""}`
            : `Leitura insuficiente (confiança ${Math.round(result.confidence)}%). Nenhum lançamento anterior foi apagado.${warnings.length ? ` ${warnings.join(" ")}` : ""}`,
        );
        return;
      }

      setMessage(`${parsed.length} lançamento(s) individualizado(s) e agrupado(s) para revisão. ${document.institution ?? "Instituição não identificada"} · ${document.brand ?? "Bandeira não identificada"}. Números de conta e cartão omitidos da análise.${warnings.length ? ` ${warnings.join(" ")}` : ""}`);
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
          ? redactFinancialIdentifiers(`Falha na leitura de ${safeName}. ${error.message}`)
          : `Falha na leitura de ${safeName}.`,
      );
    } finally {
      setBusy(false);
    }
  };

  const reprocess = (doc: StoredFinanceDocument, forceOcr = false) => {
    if (!doc.blob) { setMessage("O PDF original não está neste navegador. Importe-o novamente para leitura."); return; }
    void importFile(new File([doc.blob], doc.name, { type: doc.mime }), doc.id, forceOcr);
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
  const groups = useMemo(() => groupExpenses(items), [items]);
  const financialDocuments = documents.filter((doc) => doc.kind === "financeiro" || doc.folder === "Financeiro");
  const filteredItems = categoryFilter === "all" ? items : items.filter((item) => (item.category ?? "Outros") === categoryFilter);

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
            Leitura de todas as páginas, até 100 páginas e 16 milhões de pixels por página no OCR.
            Somente instituição, bandeira, datas, estabelecimentos e valores entram na análise;
            números de conta/cartão são omitidos, inclusive os últimos dígitos.
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
          <small className="finance-privacy-note">O PDF original permanece local e inalterado: ele pode conter dados pessoais. Não é enviado automaticamente, e os relatórios derivados não incluem números de conta/cartão.</small>
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

        <section className="finance-card" aria-label="Gastos agrupados por segmento">
          <h2><Receipt size={20} /> Gastos por segmento</h2>
          <p className="finance-privacy-note">Compras e encargos individualizados. Pagamentos, créditos, saldos transferidos e totais de fatura não são somados como novas despesas. Estabelecimentos sem evidência suficiente ficam em Outros para você revisar.</p>
          {groups.length === 0 ? <div className="finance-empty">Importe a fatura para ver os grupos.</div> : groups.map((group) => (
            <details className="finance-group" key={group.category}>
              <summary><span>{group.category} · {group.count} lançamento(s)</span><strong>{money(group.total)}</strong></summary>
              {group.entries.map((entry) => <div className="finance-group-entry" key={entry.id}><span>{entry.purchaseDate ? `${entry.purchaseDate} · ` : ""}{entry.description}</span><b>{money(entry.amount)}</b></div>)}
            </details>
          ))}
        </section>

        {financialDocuments.length > 0 && <section className="finance-card" aria-label="Faturas importadas">
          <h2><FileText size={20} /> Faturas e documentos importados</h2>
          {financialDocuments.map((doc) => <div className="finance-statement" key={doc.id}>
            <strong>{doc.name}</strong>
            <small>{doc.institution ?? "Instituição não identificada"} · {doc.brand ?? "Bandeira não identificada"} · {doc.money?.length ?? 0} lançamento(s)</small>
            {typeof doc.statementTotal === "number" && <small>Total informado na fatura: {money(doc.statementTotal)}. Pode incluir saldo anterior e ajustes, além dos gastos deste período.</small>}
            {doc.warnings?.map((warning, index) => <small key={index} className="finance-warning">{warning}</small>)}
            <div className="finance-import-actions">
              <Button variant="outline" onClick={() => reprocess(doc)} disabled={busy || !doc.blob}>Ler novamente</Button>
              {/pdf|image/.test(doc.mime) && <Button variant="outline" onClick={() => reprocess(doc, true)} disabled={busy || !doc.blob}>Ler imagem (OCR)</Button>}
            </div>
          </div>)}
        </section>}

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
            <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} aria-label="Filtrar lançamentos por segmento">
              <option value="all">Todos os segmentos</option>
              {expenseCategories.map((category) => <option value={category} key={category}>{category}</option>)}
            </select>
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
            filteredItems.map((item) => (
              <div className="finance-row" key={item.id}>
                <div>
                  <b>{item.type === "income" ? "A receber" : "A pagar"} · {item.description}</b>
                  <small>
                    {item.category || "Outros"} · {money(item.amount)} · {item.status}
                    {item.purchaseDate ? ` · compra ${item.purchaseDate}` : ""}
                    {item.dueAt ? ` · vencimento ${item.dueAt}` : ""}
                    {item.source ? ` · ${item.source}` : ""}
                    {item.institution ? ` · ${item.institution}` : ""}
                    {item.brand ? ` · ${item.brand}` : ""}
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
