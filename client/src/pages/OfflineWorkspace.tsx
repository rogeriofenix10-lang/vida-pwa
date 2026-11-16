import { useEffect, useState } from "react";
import { ArrowLeft, ClipboardList, Trash2 } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { isIrisAccessUnlocked, isIrisRemoteModeEnabled, loadIrisData, saveIrisData } from "@/lib/irisWorker";
import { readLocal, writeLocal } from "@/lib/irisLocalStore";

type Entry = { id: string; text: string; done: boolean; createdAt: string; kind: "task" | "note"; dueAt?: string };

export default function OfflineWorkspace() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [text, setText] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    void readLocal<Entry[]>("offlineWorkspace", []).then(async (local) => {
      if (active) setEntries(local);
      if (!isIrisRemoteModeEnabled() || !isIrisAccessUnlocked()) return;
      try {
        const { items } = await loadIrisData("tasks");
        const merged = new Map(local.map((entry) => [entry.id, entry]));
        for (const row of items) {
          const id = String(row.id);
          if (!merged.has(id)) merged.set(id, {
            id,
            text: String(row.title ?? ""),
            done: String(row.status ?? "pending") === "completed",
            createdAt: String(row.created_at ?? new Date().toISOString()),
            kind: (row.payload as { kind?: string } | undefined)?.kind === "note" ? "note" : "task",
            dueAt: row.due_at ? String(row.due_at) : undefined,
          });
        }
        if (active) setEntries([...merged.values()]);
      } catch {
        // Local notes and legacy task records remain available without a connection.
      }
    }).catch(() => {
      if (active) setMessage("Não foi possível abrir as notas locais. Nenhum dado foi alterado.");
    });
    return () => { active = false; };
  }, []);

  const saveNote = async (next: Entry[], changed?: Entry) => {
    await writeLocal("offlineWorkspace", next);
    setEntries(next);
    if (!changed || !isIrisRemoteModeEnabled() || !isIrisAccessUnlocked()) return false;
    try {
      await saveIrisData("tasks", {
        id: changed.id,
        title: changed.text,
        detail: "",
        status: changed.done ? "completed" : "pending",
        priority: "normal",
        category: "Notas",
        due_at: changed.dueAt ?? null,
        payload: { kind: "note", createdAt: changed.createdAt },
      });
      return true;
    } catch { return false; }
  };

  const add = async () => {
    if (!text.trim()) return;
    const entry: Entry = { id: crypto.randomUUID(), text: text.trim(), done: false, createdAt: new Date().toISOString(), kind: "note" };
    try {
      const synced = await saveNote([entry, ...entries], entry);
      setText("");
      setMessage(synced ? "Nota salva neste dispositivo e sincronizada." : "Nota salva neste dispositivo. Sincronização remota não realizada.");
    } catch {
      setMessage("Não foi possível salvar a nota. Os registros anteriores foram preservados.");
    }
  };

  const removeNote = async (id: string) => {
    if (!window.confirm("Excluir esta nota somente deste dispositivo? A cópia remota, se existir, não será excluída.")) return;
    try {
      await saveNote(entries.filter((entry) => entry.id !== id || entry.kind !== "note"));
      setMessage("Nota removida deste dispositivo. Uma cópia remota existente permanece preservada.");
    } catch { setMessage("Não foi possível excluir a nota. Nenhum registro anterior foi substituído."); }
  };

  const notes = entries.filter((entry) => entry.kind === "note");
  const legacyTasks = entries.filter((entry) => entry.kind === "task");
  return (
    <main className="profile-page"><div className="profile-card">
      <Link href="/" className="back-link"><ArrowLeft size={16} /> Voltar ao início</Link>
      <div className="profile-heading">
        <div className="profile-icon"><ClipboardList size={22} /></div>
        <div><div className="eyebrow">IRIS LOCAL-FIRST</div><h1>Notas</h1><p>Anotações neste dispositivo. A gestão de tarefas fica em Menu → Tarefas.</p></div>
      </div>
      <div className="memory-settings">
        <strong>Nova nota</strong>
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <input value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void add(); }} placeholder="Escreva uma nota…" style={{ flex: 1, minWidth: 180 }} />
          <Button onClick={() => void add()}>Salvar nota</Button>
        </div>
      </div>
      {message && <div className="profile-message" role="status">{message}</div>}
      <div className="memory-settings">
        <strong>Notas ({notes.length})</strong>
        {notes.length === 0 ? <small>Nenhuma nota salva.</small> : notes.map((entry) => (
          <div className="memory-row" key={entry.id}>
            <span>{entry.text}<br /><small>{new Date(entry.createdAt).toLocaleString("pt-BR")}</small></span>
            <Button size="sm" variant="ghost" aria-label="Excluir nota local" onClick={() => void removeNote(entry.id)}><Trash2 size={15} /></Button>
          </div>
        ))}
      </div>
      {legacyTasks.length > 0 && <details className="memory-settings">
        <summary>Tarefas antigas deste espaço ({legacyTasks.length}) · consulta</summary>
        <p>Esses registros foram preservados com seus identificadores originais. Novas tarefas e seu gerenciamento ficam em <Link href="/?view=tarefas">Menu → Tarefas</Link>; os registros antigos não foram migrados nem excluídos.</p>
        {legacyTasks.map((entry) => <div className="memory-row" key={entry.id}><span>{entry.text}<br /><small>{entry.done ? "Concluída" : "Pendente"} · {new Date(entry.createdAt).toLocaleString("pt-BR")}</small></span></div>)}
      </details>}
    </div></main>
  );
}
