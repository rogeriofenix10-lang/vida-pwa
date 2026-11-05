import { useEffect, useState } from "react";
import { ArrowLeft, Check, ClipboardList, Trash2 } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { readLocal, writeLocal } from "@/lib/irisLocalStore";

type Entry = { id: string; text: string; done: boolean; createdAt: string };
export default function OfflineWorkspace() {
  const [entries, setEntries] = useState<Entry[]>([]); const [text, setText] = useState(""); const [kind, setKind] = useState<"task" | "note">("task");
  useEffect(() => { void readLocal<Entry[]>("offlineWorkspace", []).then(setEntries); }, []);
  const save = async (next: Entry[]) => { setEntries(next); await writeLocal("offlineWorkspace", next); };
  const add = async () => { if (!text.trim()) return; await save([{id:crypto.randomUUID(),text:text.trim(),done:false,createdAt:new Date().toISOString()},...entries]); setText(""); };
  return <main className="profile-page"><div className="profile-card"><Link href="/" className="back-link"><ArrowLeft size={16}/> Voltar ao Radar</Link><div className="profile-heading"><div className="profile-icon"><ClipboardList size={22}/></div><div><div className="eyebrow">IRIS LOCAL-FIRST</div><h1>Espaço offline</h1><p>Tarefas e notas ficam neste dispositivo e não são sincronizadas automaticamente.</p></div></div><div className="notification-settings"><strong>Estado: salvo localmente</strong><p>Use este espaço sem login ou backend. A fila de sincronização futura será sempre manual e sujeita a aprovação.</p></div><div className="memory-settings"><strong>Nova tarefa ou nota</strong><div style={{display:"flex",gap:8,marginTop:10,flexWrap:"wrap"}}><select value={kind} onChange={(e)=>setKind(e.target.value as typeof kind)}><option value="task">Tarefa</option><option value="note">Nota</option></select><input value={text} onChange={(e)=>setText(e.target.value)} onKeyDown={(e)=>{if(e.key === "Enter") void add();}} placeholder="Escreva aqui..." style={{flex:1,minWidth:180}}/><Button onClick={()=>void add()}>Adicionar</Button></div></div><div className="memory-settings"><strong>Itens locais ({entries.length})</strong>{entries.length===0?<small>Nenhum item salvo.</small>:entries.map((entry)=><div className="memory-row" key={entry.id}><span style={{textDecoration:entry.done?"line-through":undefined}}>{entry.text}<br/><small>{new Date(entry.createdAt).toLocaleString()}</small></span><span style={{display:"flex",gap:6}}><Button size="sm" variant="outline" onClick={()=>void save(entries.map((x)=>x.id===entry.id?{...x,done:!x.done}:x))}><Check size={15}/></Button><Button size="sm" variant="ghost" onClick={()=>void save(entries.filter((x)=>x.id!==entry.id))}><Trash2 size={15}/></Button></span></div>)}</div></div></main>;
}
