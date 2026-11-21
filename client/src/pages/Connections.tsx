import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { ArrowLeft, CheckCircle2, CircleOff, ExternalLink, LockKeyhole, ShieldCheck } from "lucide-react";
import { Link } from "wouter";
import RemoteAccessGate from "@/components/RemoteAccessGate";
import { useCallback, useEffect, useRef, useState } from "react";
import { gmailStatus, googleCalendarStatus, googleDriveStatus, isIrisAccessUnlocked, isIrisRemoteModeEnabled, startGoogleOAuth } from "@/lib/irisWorker";

const GOOGLE = [
  { product: "gmail" as const, label: "Gmail", description: "Análise de e-mails e sugestões. Acesso somente para leitura; envio permanece bloqueado." },
  { product: "drive" as const, label: "Google Drive", description: "Análise e sugestões de organização. Alterações permanecem bloqueadas." },
  { product: "calendar" as const, label: "Google Calendar", description: "Consulta de agenda. Criação/alteração de eventos exige aprovação." },
];
const META = [
  { product: "whatsapp" as const, label: "WhatsApp", description: "Mensagens autorizadas. A IRIS nunca envia sem aprovação." },
  { product: "instagram" as const, label: "Instagram", description: "Leitura de conteúdo; publicações permanecem sob aprovação." },
  { product: "facebook" as const, label: "Facebook", description: "Leitura de páginas; publicações permanecem sob aprovação." },
];
const GOOGLE_PRODUCTS = ["google:gmail", "google:drive", "google:calendar"] as const;

export default function Connections() {
  const { isAuthenticated } = useAuth();
  const policy = trpc.radar.connectorPermissionPolicy.useQuery(undefined, { enabled: isAuthenticated });
  const integrations = trpc.radar.integrations.useQuery(undefined, { enabled: isAuthenticated });
  const connectorOAuth = trpc.radar.connectorOAuthStart.useMutation();
  const [message, setMessage] = useState("");
  const [remoteAccessUnlocked, setRemoteAccessUnlocked] = useState(
    () => isIrisRemoteModeEnabled() && isIrisAccessUnlocked(),
  );
  const [googleOAuthPending, setGoogleOAuthPending] = useState(false);
  const [workerGoogleConnections, setWorkerGoogleConnections] = useState<Set<string>>(() => new Set());
  const [googleStatusWarning, setGoogleStatusWarning] = useState("");
  const failedReads = useRef({ policy: false, integrations: false });

  useEffect(() => {
    failedReads.current.policy = policy.isError;
    failedReads.current.integrations = integrations.isError;
  }, [policy.isError, integrations.isError]);

  const refreshGoogleStatuses = useCallback(async () => {
    if (!remoteAccessUnlocked) {
      setWorkerGoogleConnections(new Set());
      setGoogleStatusWarning("");
      return;
    }
    const results = await Promise.allSettled([
      gmailStatus(),
      googleDriveStatus(),
      googleCalendarStatus(),
    ]);
    const next = new Set<string>();
    results.forEach((result, index) => {
      if (result.status === "fulfilled" && result.value.authorized) {
        next.add(GOOGLE_PRODUCTS[index]);
      }
    });
    setWorkerGoogleConnections(next);
    setGoogleStatusWarning(
      results.some((result) => result.status === "rejected")
        ? "Não foi possível confirmar o status de todas as conexões Google. Verifique o acesso remoto e atualize a página."
        : "",
    );
  }, [remoteAccessUnlocked]);

  useEffect(() => {
    void refreshGoogleStatuses();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshGoogleStatuses();
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshGoogleStatuses]);

  useEffect(() => {
    const updateAccessState = () => {
      setRemoteAccessUnlocked(isIrisRemoteModeEnabled() && isIrisAccessUnlocked());
    };
    const onAccessChanged = () => {
      const unlocked = isIrisRemoteModeEnabled() && isIrisAccessUnlocked();
      setRemoteAccessUnlocked(unlocked);
      if (!unlocked) return;
      if (failedReads.current.policy) {
        failedReads.current.policy = false;
        void policy.refetch();
      }
      if (failedReads.current.integrations) {
        failedReads.current.integrations = false;
        void integrations.refetch();
      }
    };
    window.addEventListener("iris-access-changed", onAccessChanged);
    window.addEventListener("iris-mode-changed", updateAccessState);
    return () => {
      window.removeEventListener("iris-access-changed", onAccessChanged);
      window.removeEventListener("iris-mode-changed", updateAccessState);
    };
  }, [policy.refetch, integrations.refetch]);

  const connected = new Set([
    ...(integrations.data?.connected ?? []).map((x: any) => x.provider),
    ...workerGoogleConnections,
  ]);
  const connectGoogle = async (product: "gmail" | "drive" | "calendar") => {
    if (!isIrisRemoteModeEnabled() || !isIrisAccessUnlocked()) {
      setRemoteAccessUnlocked(false);
      setMessage("Desbloqueie o acesso remoto antes de conectar uma conta Google. Nenhuma solicitação foi enviada.");
      return;
    }
    setGoogleOAuthPending(true);
    setMessage("");
    try { await startGoogleOAuth(product); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Não foi possível iniciar a conexão Google."); }
    finally { setGoogleOAuthPending(false); }
  };
  const connectMeta = async (product: "whatsapp" | "instagram" | "facebook") => {
    try { const { url } = await connectorOAuth.mutateAsync({ provider: "meta", product }); window.location.assign(url); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Não foi possível iniciar a conexão Meta."); }
  };

  const card = (provider: string, label: string, description: string, onConnect: () => void) => {
    const isConnected = connected.has(provider);
    const isGoogle = provider.startsWith("google:");
    return <div className="memory-settings" key={provider}>
      <div style={{display:"flex",justifyContent:"space-between",gap:16,alignItems:"flex-start"}}>
        <div><strong>{label}</strong><p>{description}</p></div>
        {isConnected ? <CheckCircle2 size={20} aria-label="Conectado" /> : <CircleOff size={20} aria-label="Não conectado" />}
      </div>
      <Button type="button" variant="outline" onClick={onConnect} disabled={connectorOAuth.isPending || (isGoogle && (!remoteAccessUnlocked || googleOAuthPending))}>
        {isGoogle && !remoteAccessUnlocked ? "Desbloqueie para conectar" : isConnected ? "Reconectar" : "Conectar"}<ExternalLink size={15} />
      </Button>
    </div>;
  };

  return <main className="profile-page"><div className="profile-card">
    <Link href="/" className="back-link"><ArrowLeft size={16} /> Voltar ao início</Link>
    <RemoteAccessGate />
    <div className="profile-heading"><div className="profile-icon"><LockKeyhole size={22} /></div><div><div className="eyebrow">IRIS 5.5.1 · PWA LOCAL</div><h1>Conexões e permissões</h1><p>Conecte contas somente depois de revisar as regras de acesso.</p></div></div>
    <div className="notification-settings"><strong><ShieldCheck size={17}/> Regra de segurança ativa</strong><p>A IRIS pode analisar e sugerir somente quando você pedir. Alterar, excluir, enviar, compartilhar ou organizar exige aprovação explícita.</p><div className="memory-row"><span>Acesso ao Worker</span><b role="status">{remoteAccessUnlocked ? "Unlocked · desbloqueado" : "Locked · bloqueado"}</b></div><div className="memory-row"><span>Analisar</span><b>Permitido após conexão</b></div><div className="memory-row"><span>Modificar / enviar / excluir / compartilhar / organizar</span><b>Bloqueado sem aprovação</b></div></div>
    {!isAuthenticated && <div className="notification-settings"><strong>Conexões Google</strong><p>Na publicação móvel, Gmail, Drive e Calendar usam o acesso remoto da IRIS; não é necessário entrar em uma conta Manus para autorizar o Google.</p></div>}
    <h2>Google</h2>
    {GOOGLE.map(x => card(`google:${x.product}`, x.label, x.description, () => void connectGoogle(x.product)))}
    {isAuthenticated && <><h2>Meta</h2>{META.map(x => card(`meta:${x.product}`, x.label, x.description, () => void connectMeta(x.product)))}</>}
    <div className="notification-settings"><strong>Política técnica</strong><p>{policy.data?.rule ?? "Analisar/sugerir somente quando solicitado; executar alterações somente após aprovação explícita."}</p><small>Não existe um modo global de “sempre permitir” ações de alteração no IRIS 5.5.1.</small></div>
    {googleStatusWarning && <div className="profile-message" role="status">{googleStatusWarning}</div>}
    {message && <div className="profile-message" role="alert">{message}</div>}
  </div></main>;
}
