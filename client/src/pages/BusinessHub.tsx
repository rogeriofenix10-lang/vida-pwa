import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, BriefcaseBusiness, Download, FileDown, Paperclip, Plus, Search, Trash2 } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { downloadJson, readLocal, writeLocal } from "@/lib/irisLocalStore";
import { downloadIrisFile, loadIrisData, saveIrisData, uploadIrisFile } from "@/lib/irisWorker";

type Kind = "cliente" | "fornecedor" | "pedido" | "comissao" | "meta" | "inadimplencia";
type RecordItem = {
  id: string; kind: Kind; name: string; company: string; amount: number; status: string;
  notes: string; createdAt: string; storageKey?: string; fileName?: string; fileMime?: string;
};
const labels: Record<Kind, string> = { cliente: "Cliente", fornecedor: "Fornecedor", pedido: "Pedido", comissao: "Comissão", meta: "Meta", inadimplencia: "Inadimplência" };
const empty = { kind: "cliente" as Kind, name: "", company: "", amount: "", status: "aberto", notes: "" };
const money = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function BusinessHub() {
  const [items, setItems] = useState<RecordItem[]>([]);
  const [draft, setDraft] = useState(empty);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void readLocal<RecordItem[]>("businessRecords", []).then((local) => {
      setItems(local);
      void loadIrisData("business").then(({ items: rows }) => {
        const remote: RecordItem[] = rows.map((row) => {
          const payload = (row.payload ?? {}) as { amount?: number; status?: string; createdAt?: string; storageKey?: string; fileName?: string; fileMime?: string };
          return {
            id: String(row.id),
            kind: (Object.keys(labels).includes(String(row.kind)) ? String(row.kind) : "cliente") as Kind,
            name: String(row.name ?? ""), company: String(row.company ?? ""), notes: String(row.notes ?? ""),
            amount: Number(payload.amount ?? 0), status: String(payload.status ?? "aberto"),
            createdAt: String(payload.createdAt ?? row.created_at ?? new Date().toISOString()),
            storageKey: payload.storageKey, fileName: payload.fileName, fileMime: payload.fileMime,
          };
        });
        if (remote.length) { setItems(remote); void writeLocal("businessRecords", remote); }
      }).catch(() => undefined);
    });
  }, []);

  const persist = async (item: RecordItem) => {
    await saveIrisData("business", {
      id: item.id, kind: item.kind, name: item.name, company: item.company, notes: item.notes,
      payload: { amount: item.amount, status: item.status, createdAt: item.createdAt, storageKey: item.storageKey, fileName: item.fileName, fileMime: item.fileMime },
    });
  };

  const add = async () => {
    if (!draft.name.trim()) { setMessage("Informe um nome ou referência."); return; }
    setBusy(true);
    try {
      const item: RecordItem = {
        id: crypto.randomUUID(), kind: draft.kind, name: draft.name.trim(), company: draft.company.trim(),
        amount: Number(String(draft.amount).replace(",", ".")) || 0, status: draft.status, notes: draft.notes.trim(),
        createdAt: new Date().toISOString(),
      };
      if (attachment) {
        const remote = await uploadIrisFile(attachment, item.id);
        item.storageKey = remote.key; item.fileName = attachment.name; item.fileMime = attachment.type || "application/octet-stream";
      }
      const next = [item, ...items];
      setItems(next); await writeLocal("businessRecords", next); await persist(item);
      setDraft(empty); setAttachment(null); setMessage(`${labels[item.kind]} salvo${item.fileName ? " com anexo no R2" : ""} e sincronizado.`);
    } catch (error) {
      setMessage(error instanceof Error ? `Não foi possível salvar: ${error.message}` : "Não foi possível salvar o registro.");
    } finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    const item = items.find((entry) => entry.id === id);
    if (!item || !window.confirm(`Excluir o registro “${item.name}” deste dispositivo?`)) return;
    const next = items.filter((entry) => entry.id !== id); setItems(next); await writeLocal("businessRecords", next);
    setMessage("Registro removido deste dispositivo. O arquivo remoto permanece protegido até uma exclusão autorizada.");
  };

  const download = async (item: RecordItem) => {
    if (!item.storageKey) { setMessage("Este registro não possui arquivo anexado."); return; }
    try {
      const blob = await downloadIrisFile(item.id);
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = item.fileName || item.name; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000); setMessage(`Download de ${item.fileName || item.name} iniciado.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível baixar o arquivo."); }
  };

  const filtered = useMemo(() => items.filter((item) => `${item.name} ${item.company} ${item.kind} ${item.notes}`.toLowerCase().includes(query.toLowerCase())), [items, query]);
  return <main className="profile-page"><div className="profile-card">
    <Link href="/" className="back-link"><ArrowLeft size={16} /> Voltar ao Radar</Link>
    <div className="profile-heading"><div className="profile-icon"><BriefcaseBusiness size={22} /></div><div><div className="eyebrow">IRIS COMERCIAL · D1 + R2 + LOCAL</div><h1>Administração comercial</h1><p>Clientes, pedidos, comissões, metas e inadimplência com cópia local, anexos físicos e sincronização persistente.</p></div></div>
    <div className="notification-settings"><strong>Governança comercial</strong><p>Alterações externas e exclusões exigem confirmação explícita. Anexos são enviados ao R2 somente quando você salva o registro.</p></div>
    <div className="memory-settings"><strong>Novo registro</strong><div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", marginTop: 10 }}>
      <select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as Kind })}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Nome ou referência" />
      <input value={draft.company} onChange={(event) => setDraft({ ...draft, company: event.target.value })} placeholder="Cliente / marca / empresa" />
      <input inputMode="decimal" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} placeholder="Valor opcional" />
      <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}><option value="aberto">Aberto</option><option value="em_andamento">Em andamento</option><option value="concluido">Concluído</option><option value="atrasado">Atrasado</option></select>
      <textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="Observações" rows={2} />
      <label className="back-link" style={{ display: "flex", gap: 7, alignItems: "center", cursor: "pointer" }}><Paperclip size={15} /> {attachment ? attachment.name : "Anexar arquivo"}<input type="file" hidden accept=".pdf,.csv,.xlsx,.xls,.doc,.docx,image/*" onChange={(event) => setAttachment(event.target.files?.[0] ?? null)} /></label>
      <Button disabled={busy} onClick={() => void add()}><Plus size={15} /> {busy ? "Salvando…" : "Salvar"}</Button>
    </div></div>
    <div className="memory-settings"><div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><strong style={{ marginRight: "auto" }}>Registros ({filtered.length})</strong><div style={{ display: "flex", gap: 6, alignItems: "center" }}><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar" /></div><Button variant="outline" onClick={() => downloadJson("iris-comercial.json", { format: "iris-business", exportedAt: new Date().toISOString(), records: items })}><Download size={15} /> Exportar</Button></div>
      {filtered.length === 0 ? <small>Nenhum registro comercial.</small> : filtered.map((item) => <div className="memory-row" key={item.id}><span><b>{labels[item.kind]} · {item.name}</b><br /><small>{item.company || "Sem empresa"} · {item.amount ? money(item.amount) : "sem valor"} · {item.status}{item.notes ? ` · ${item.notes}` : ""}{item.fileName ? ` · ${item.fileName}` : ""}</small></span><div style={{ display: "flex", gap: 4 }}>{item.storageKey && <Button size="sm" variant="ghost" onClick={() => void download(item)} aria-label={`Baixar ${item.fileName || item.name}`}><FileDown size={15} /></Button>}<Button size="sm" variant="ghost" onClick={() => void remove(item.id)} aria-label={`Excluir ${item.name}`}><Trash2 size={15} /></Button></div></div>)}
    </div>{message && <div className="profile-message">{message}</div>}
  </div></main>;
}
