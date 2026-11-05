import { useEffect, useState } from "react";
import { ArrowLeft, Check, ClipboardList, Trash2 } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { loadIrisData, saveIrisData } from "@/lib/irisWorker";
import { readLocal, writeLocal } from "@/lib/irisLocalStore";

type Entry = { id: string; text: string; done: boolean; createdAt: string; kind: "task" | "note"; dueAt?: string };

export default function OfflineWorkspace() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [text, setText] = useState("");
  const [kind, setKind] = useState<"task" | "note">("task");
  const [message, setMessage] = useState("");

  useEffect(() => {
    void readLocal<Entry[]>("offlineWorkspace", []).then((local) => {
      setEntries(local);
      void loadIrisData("tasks").then(({ items }) => {
        const remote = items.map((row) => ({
          id: String(row.id),
          text: String(row.title ?? ""),
          done: String(row.status ?? "pending") === "completed",
          createdAt: String(row.created_at ?? new Date().toISOString()),
          kind: ((row.payload as { kind?: string } | undefined)?.kind === "note" ? "note" : "task") as Entry["kind"],
          dueAt: row.due_at ? String(row.due_at) : undefined,
        }));
        if (remote.length) setEntries(remote);
      }).catch(() => undefined);
    });
  }, []);

  const save = async (next: Entry[]) => {
    setEntries(next);
    await writeLocal("offlineWorkspace", next);
    await Promise.all(next.map((entry) => saveIrisData("tasks", {
      id: entry.id,
      title: entry.text,
      detail: "",
      status: entry.done ? "completed" : "pending",
      priority: "normal",
      category: entry.kind === "note" ? "Notas" : "Tarefas",
      due_at: entry.dueAt ?? null,
      payload: { kind: entry.kind, createdAt: entry.createdAt },
    }).catch(() => undefined)));
  };

  const add = async () => {
    if (!text.trim()) return;
    const entry: Entry = { id: crypto.randomUUID(), text: text.trim(), done: false, createdAt: new Date().toISOString(), kind };
    await save([entry, ...entries]);
    setText("");
    setMessage("Salvo neste dispositivo e sincronizado no D1 quando disponível.");
  };

  return <main className="profile-page"><div className="profile-card">
    <Link href="/" className="back-link"><ArrowLeft size={16}/> Voltar ao Radar</Link>
    <div className="profile-heading"><div className="profile-icon"><ClipboardList size={22}/></div><div><div className="eyebrow">IRIS LOCAL-FIRST</div><h1>Espaço de tarefas</h1><p>O fallback local permanece ativo; quando disponível, tarefas e notas são sincronizadas no D1.</p></div></div>
    <div className="notification-settings"><strong>Sincronização protegida</strong><p>Nenhuma ação externa é executada sem autorização. Exclusões continuam locais nesta fase.</p></div>
    <div className="memory-settings"><strong>Nova tarefa ou nota</strong><div style={{display:"flex",gap:8,marginTop:10,flexWrap:"wrap"}}><select value={kind} onChange={(e)=>setKind(e.target.value as typeof kind)}><option value="task">Tarefa</option><option value="note">Nota</option></select><input value={text} onChange={(e)=>setText(e.target.value)} onKeyDown={(e)=>{if(e.key === "Enter") void add();}} placeholder="Escreva aqui..." style={{flex:1,minWidth:180}}/><Button onClick={()=>void add()}>Adicionar</Button></div></div>
    {message && <div className="profile-message">{message}</div>}
    <div className="memory-settings"><strong>Itens ({entries.length})</strong>{entries.length===0?<small>Nenhum item salvo.</small>:entries.map((entry)=><div className="memory-row" key={entry.id}><span style={{textDecoration:entry.done?"line-through":undefined}}>{entry.text}<br/><small>{entry.kind === "note" ? "Nota" : "Tarefa"} · {new Date(entry.createdAt).toLocaleString()}</small></span><span style={{display:"flex",gap:6}}><Button size="sm" variant="outline" onClick={()=>void save(entries.map((x)=>x.id===entry.id?{...x,done:!x.done}:x))}><Check size={15}/></Button><Button size="sm" variant="ghost" onClick={()=>void save(entries.filter((x)=>x.id!==entry.id))}><Trash2 size={15}/></Button></span></div>)}</div>
  </div></main>;
}
