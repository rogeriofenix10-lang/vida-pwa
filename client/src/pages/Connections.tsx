import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { ArrowLeft, CheckCircle2, CircleOff, ExternalLink, LockKeyhole, ShieldCheck } from "lucide-react";
import { Link } from "wouter";
import { useState } from "react";

const GOOGLE = [
  { product: "gmail" as const, label: "Gmail", description: "Análise de e-mails e sugestões. Envio permanece bloqueado até aprovação." },
  { product: "drive" as const, label: "Google Drive", description: "Análise e sugestões de organização. Alterações permanecem bloqueadas." },
  { product: "calendar" as const, label: "Google Calendar", description: "Consulta de agenda. Criação/alteração de eventos exige aprovação." },
];
const META = [
  { product: "whatsapp" as const, label: "WhatsApp", description: "Mensagens autorizadas. A IRIS nunca envia sem aprovação." },
  { product: "instagram" as const, label: "Instagram", description: "Leitura de conteúdo; publicações permanecem sob aprovação." },
  { product: "facebook" as const, label: "Facebook", description: "Leitura de páginas; publicações permanecem sob aprovação." },
];

export default function Connections() {
  const { isAuthenticated } = useAuth();
  const policy = trpc.radar.connectorPermissionPolicy.useQuery(undefined, { enabled: isAuthenticated });
  const integrations = trpc.radar.integrations.useQuery(undefined, { enabled: isAuthenticated });
  const googleOAuth = trpc.radar.oauthStart.useMutation();
  const connectorOAuth = trpc.radar.connectorOAuthStart.useMutation();
  const [message, setMessage] = useState("");

  if (!isAuthenticated) return <main className="profile-page"><div className="profile-card"><h1>Conexões</h1><p>Entre na sua conta para gerenciar integrações.</p></div></main>;
  const connected = new Set((integrations.data?.connected ?? []).map((x: any) => x.provider));

  const connectGoogle = async (product: "gmail" | "drive" | "calendar") => {
    try { const { url } = await googleOAuth.mutateAsync({ product }); window.location.assign(url); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Não foi possível iniciar a conexão Google."); }
  };
  const connectMeta = async (product: "whatsapp" | "instagram" | "facebook") => {
    try { const { url } = await connectorOAuth.mutateAsync({ provider: "meta", product }); window.location.assign(url); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Não foi possível iniciar a conexão Meta."); }
  };

  const card = (provider: string, label: string, description: string, onConnect: () => void) => {
    const isConnected = connected.has(provider);
    return <div className="memory-settings" key={provider}>
      <div style={{display:"flex",justifyContent:"space-between",gap:16,alignItems:"flex-start"}}>
        <div><strong>{label}</strong><p>{description}</p></div>
        {isConnected ? <CheckCircle2 size={20} aria-label="Conectado" /> : <CircleOff size={20} aria-label="Não conectado" />}
      </div>
      <Button type="button" variant="outline" onClick={onConnect} disabled={googleOAuth.isPending || connectorOAuth.isPending}>
        {isConnected ? "Reconectar" : "Conectar"}<ExternalLink size={15} />
      </Button>
    </div>;
  };

  return <main className="profile-page"><div className="profile-card">
    <Link href="/" className="back-link"><ArrowLeft size={16} /> Voltar ao Radar</Link>
    <div className="profile-heading"><div className="profile-icon"><LockKeyhole size={22} /></div><div><div className="eyebrow">IRIS 5.5.1 · PWA LOCAL</div><h1>Conexões e permissões</h1><p>Conecte contas somente depois de revisar as regras de acesso.</p></div></div>
    <div className="notification-settings"><strong><ShieldCheck size={17}/> Regra de segurança ativa</strong><p>A IRIS pode analisar e sugerir somente quando você pedir. Alterar, excluir, enviar, compartilhar ou organizar exige aprovação explícita.</p><div className="memory-row"><span>Analisar</span><b>Permitido após conexão</b></div><div className="memory-row"><span>Modificar / enviar / excluir / compartilhar / organizar</span><b>Bloqueado sem aprovação</b></div></div>
    <h2>Google</h2>
    {GOOGLE.map(x => card(`google:${x.product}`, x.label, x.description, () => void connectGoogle(x.product)))}
    <h2>Meta</h2>
    {META.map(x => card(`meta:${x.product}`, x.label, x.description, () => void connectMeta(x.product)))}
    <div className="notification-settings"><strong>Política técnica</strong><p>{policy.data?.rule ?? "Analisar/sugerir somente quando solicitado; executar alterações somente após aprovação explícita."}</p><small>Não existe um modo global de “sempre permitir” ações de alteração no IRIS 5.5.1.</small></div>
    {message && <div className="profile-message">{message}</div>}
  </div></main>;
}
