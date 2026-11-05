import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Activity, CalendarDays, FileSearch, Mail, RotateCcw, Send, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

const scenarios = [
  { id: "gmail-read", label: "Ler e-mails", icon: Mail, provider: "google:gmail", action: "messages.list", input: {} },
  { id: "drive-search", label: "Buscar no Drive", icon: FileSearch, provider: "google:drive", action: "files.search", input: { query: "clientes" } },
  { id: "calendar-read", label: "Consultar agenda", icon: CalendarDays, provider: "google:calendar", action: "events.list", input: {} },
  { id: "gmail-send", label: "Simular envio", icon: Send, provider: "google:gmail", action: "messages.send", input: { to: "teste@exemplo.com", subject: "Teste IRIS", body: "Mensagem simulada pelo Laboratório Local." } },
  { id: "calendar-create", label: "Simular criação de evento", icon: CalendarDays, provider: "google:calendar", action: "events.create", input: { summary: "Evento IRIS", start: "2030-01-15T14:00:00-03:00", end: "2030-01-15T15:00:00-03:00" } },
];

export default function LocalLab() {
  const [status, setStatus] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const response = await fetch("/api/local-lab/status");
    setStatus(await response.json());
  }
  useEffect(() => { void refresh(); }, []);

  async function run(scenario: typeof scenarios[number]) {
    setBusy(true);
    try {
      const confirmed = scenario.id.includes("send") || scenario.id.includes("create");
      const response = await fetch("/api/local-lab/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...scenario, confirmed }) });
      setResult(await response.json());
      await refresh();
    } finally { setBusy(false); }
  }

  async function reset() {
    const response = await fetch("/api/local-lab/reset", { method: "POST" });
    setResult(await response.json());
    await refresh();
  }

  return <main className="profile-page"><div className="profile-card">
    <div style={{display:"flex",justifyContent:"space-between",gap:16,alignItems:"flex-start",flexWrap:"wrap"}}>
      <div><Link href="/operacao" className="back-link">← Operação</Link><div className="profile-heading"><div className="profile-icon"><Activity size={22}/></div><div><div className="eyebrow">IRIS 5.5.1 · PWA LOCAL</div><h1>Laboratório local</h1><p>Simulação segura de Gmail, Calendar e Drive sem chamadas externas.</p></div></div></div>
      <Button variant="outline" onClick={() => void reset()}><RotateCcw size={16}/> Reiniciar cenário</Button>
    </div>
    <div className="notification-settings"><strong><ShieldCheck size={17}/> Modo offline-simulator</strong><p>As ações são fictícias e não enviam mensagens, não criam eventos e não acessam nenhuma conta.</p><p>Execuções: {status?.runs ?? 0} · E-mails simulados enviados: {status?.counts?.sentMessages ?? 0}</p><div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:10}}><Link href="/seguranca" className="back-link">Central de Segurança →</Link><Link href="/midia" className="back-link">Estúdio de Mídia Local →</Link></div></div>
    <div className="memory-settings"><strong>Testes disponíveis</strong>{scenarios.map((s) => { const Icon=s.icon; return <div className="memory-row" key={s.id}><span><b>{s.label}</b><br/><small>{s.provider} · {s.action}</small></span><Button size="sm" variant="outline" disabled={busy} onClick={() => void run(s)}><Icon size={15}/> Executar</Button></div>; })}</div>
    <div className="memory-settings"><strong>Resultado</strong><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",fontSize:12}}>{result ? JSON.stringify(result,null,2) : "Execute um cenário para ver o resultado."}</pre></div>
  </div></main>;
}
