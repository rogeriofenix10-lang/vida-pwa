import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import { Activity, AlertTriangle, CheckCircle2, Clock3, Database, RefreshCw, Server } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function IntegrationHealth() {
  const { isAuthenticated } = useAuth();
  const health = trpc.radar.health.useQuery(undefined, { enabled: isAuthenticated, refetchInterval: 10_000 });
  if (!isAuthenticated) return <main className="profile-page"><div className="profile-card"><h1>Saúde da IRIS</h1><p>Entre na sua conta para consultar o estado operacional.</p></div></main>;
  const data = health.data;
  const ok = data?.status === "ok";
  return <main className="profile-page"><div className="profile-card">
    <div style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}><Link href="/" className="back-link">← Voltar ao Radar</Link><a href="/laboratorio" className="back-link">Laboratório local →</a></div>
    <div className="profile-heading"><div className="profile-icon"><Activity size={22}/></div><div><div className="eyebrow">IRIS 5.0.8</div><h1>Saúde operacional</h1><p>Monitoramento de conectores, fila, eventos e auditoria.</p></div></div>
    <div className="notification-settings"><strong>{ok ? <CheckCircle2 size={17}/> : <AlertTriangle size={17}/>} Estado: {ok ? "operacional" : "indisponível"}</strong><p>Atualização automática a cada 10 segundos.</p><Button variant="outline" onClick={() => void health.refetch()} disabled={health.isFetching}><RefreshCw size={16} className={health.isFetching ? "animate-spin" : ""}/> Atualizar</Button></div>
    <div className="memory-settings"><strong><Server size={17}/> Conectores</strong>{(data?.connectors ?? []).map((c:any)=><div className="memory-row" key={c.provider}><span><b>{c.provider}</b><br/><small>{c.runtime?.circuit === "open" ? "Circuit breaker aberto" : "Circuito fechado"} · falhas: {c.runtime?.failures ?? 0}</small></span><span>{c.runtime?.circuit === "open" ? "⚠️" : "✓"}</span></div>)}</div>
    <div className="memory-settings"><strong><Database size={17}/> Fila e eventos</strong><p>Jobs: {JSON.stringify(data?.jobs ?? {})}</p><p>Eventos: {JSON.stringify(data?.events ?? {})}</p></div>
    <div className="memory-settings"><strong><Clock3 size={17}/> Auditoria recente</strong>{(data?.recentAudits ?? []).slice(0,10).map((a:any)=><div className="memory-row" key={a.id}><span>{a.provider} · {a.action}</span><small>{a.status}</small></div>)}</div>
  </div></main>;
}
