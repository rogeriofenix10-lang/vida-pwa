import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { filterAndSortMemories } from "@shared/memoryFilters";
import { useTheme } from "@/contexts/ThemeContext";
import { ArrowLeft, Check, Loader2, LockKeyhole, Moon, Sun, Trash2, UserRound, ShieldCheck, Database, FileText, Activity, Shield } from "lucide-react";
import { Link } from "wouter";

function decodeKey(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const normalized = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(normalized);
  return Uint8Array.from(Array.from(raw).map((character) => character.charCodeAt(0)));
}

export default function Profile() {
  const { isAuthenticated } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const profile = trpc.profile.me.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  const update = trpc.profile.update.useMutation();
  const pushKey = trpc.notifications.publicKey.useQuery();
  const subscribePush = trpc.notifications.subscribe.useMutation();
  const sendReminder = trpc.notifications.sendTest.useMutation();
  const memories = trpc.memory.list.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  const aiKeys = trpc.ai.keys.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  const healthAudits = trpc.health.audits.useQuery({ limit: 15 }, { enabled: isAuthenticated, retry: false });
  const agentEvents = trpc.control.events.useQuery({ limit: 15 }, { enabled: isAuthenticated, retry: false });
  const saveAiKey = trpc.ai.saveKey.useMutation();
  const removeAiKey = trpc.ai.removeKey.useMutation();
  const aiKeyUtils = trpc.useUtils();
  const createMemory = trpc.memory.create.useMutation();
  const removeMemory = trpc.memory.remove.useMutation();
  const memoryUtils = trpc.useUtils();
  const [pushStatus, setPushStatus] = useState("");
  const [newMemory, setNewMemory] = useState("");
  const [apiKeys, setApiKeys] = useState({ chatgpt: "", gemini: "", kimi: "" });
  const [externalAiConsent, setExternalAiConsent] = useState(() => { try { return localStorage.getItem("iris-external-ai-consent") === "true"; } catch { return false; } });
  const [memoryQuery, setMemoryQuery] = useState("");
  const [memorySource, setMemorySource] = useState("all");
  const [memorySort, setMemorySort] = useState("recent");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!profile.data) return;
    setName(profile.data.name);
    setEmail(profile.data.email);
    setExternalAiConsent(profile.data.externalAiConsent);
    localStorage.setItem("iris-external-ai-consent", String(profile.data.externalAiConsent));
  }, [profile.data]);

  const filteredMemories = useMemo(() => filterAndSortMemories(memories.data ?? [], memoryQuery, memorySource, memorySort as "recent" | "alpha"), [memories.data, memoryQuery, memorySource, memorySort]);

  const save = async () => {
    setSaved(false);
    await update.mutateAsync({ name, email, externalAiConsent });
    setSaved(true);
  };

  const enablePush = async () => {
    if (!pushKey.data?.key || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setPushStatus("Este navegador não oferece notificações Push.");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setPushStatus("Permissão de notificações não concedida.");
      return;
    }
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeKey(pushKey.data.key) });
    const json = subscription.toJSON();
    await subscribePush.mutateAsync({ endpoint: json.endpoint!, p256dh: json.keys?.p256dh!, auth: json.keys?.auth! });
    setPushStatus("Notificações ativadas neste dispositivo.");
  };

  return (
    <main className="profile-page">
      <div className="profile-card">
        <div style={{display:"flex",gap:12,flexWrap:"wrap"}}><Link href="/" className="back-link"><ArrowLeft size={16} /> Voltar ao Radar</Link><Link href="/conexoes" className="back-link"><LockKeyhole size={16} /> Conexões e permissões</Link></div>
        <div className="profile-heading"><div className="profile-icon"><UserRound size={22} /></div><div><div className="eyebrow">MINHA CONTA</div><h1>Perfil e preferências</h1><p>Atualize suas informações para personalizar o Iris.</p></div></div>
        {!isAuthenticated ? <p className="profile-message">Entre na sua conta para editar o perfil.</p> : <form onSubmit={(event) => { event.preventDefault(); void save(); }} className="profile-form"><label>Nome<Input value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} /></label><label>E-mail<Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={320} /></label><Button type="submit" disabled={update.isPending}>{update.isPending ? <Loader2 className="animate-spin" size={16} /> : saved ? <Check size={16} /> : null}{saved ? "Salvo" : "Salvar alterações"}</Button></form>}
        {isAuthenticated && <div className="notification-settings"><strong>Lembretes do Radar</strong><p>Receba avisos quando houver tarefas pendentes.</p><Button type="button" variant="outline" onClick={() => void enablePush()} disabled={subscribePush.isPending}>{subscribePush.isPending ? <Loader2 className="animate-spin" size={16} /> : null}{subscribePush.isPending ? "Ativando…" : "Ativar notificações"}</Button>{pushStatus && <span>{pushStatus}</span>}<Button type="button" variant="outline" onClick={async () => { const result = await sendReminder.mutateAsync(); setPushStatus(`Lembrete enviado para ${result.sent} dispositivo(s).`); }} disabled={sendReminder.isPending}>{sendReminder.isPending ? "Enviando…" : "Enviar lembrete agora"}</Button></div>}
        <div className="theme-settings"><div><strong>Aparência</strong><p>Escolha como o Iris aparece neste dispositivo.</p></div><Button type="button" variant="outline" onClick={() => toggleTheme?.()}>{theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}{theme === "dark" ? "Usar modo claro" : "Usar modo escuro"}</Button></div>
        {isAuthenticated && <div className="provider-key-settings"><strong>Chaves próprias de IA</strong><p>As chaves são cifradas no servidor e nunca retornadas ao navegador depois de salvas.</p><label className="consent-row"><input type="checkbox" checked={externalAiConsent} onChange={(event) => { const checked = event.target.checked; setExternalAiConsent(checked); localStorage.setItem("iris-external-ai-consent", String(checked)); void update.mutateAsync({ name, email, externalAiConsent: checked }); }} /> Autorizo o Iris a enviar mensagens e anexos ao provedor externo escolhido.</label>{(["chatgpt", "gemini", "kimi"] as const).map((provider) => <div className="provider-key-row" key={provider}><label>{provider === "chatgpt" ? "ChatGPT" : provider === "gemini" ? "Gemini" : "Kimi"}<Input type="password" value={apiKeys[provider]} onChange={(event) => setApiKeys((current) => ({ ...current, [provider]: event.target.value }))} placeholder={aiKeys.data?.[provider] ? "Chave configurada — digite para substituir" : "Cole sua chave de API"} autoComplete="off" /></label><div className="provider-key-actions"><Button type="button" variant="outline" onClick={async () => { if (!apiKeys[provider].trim()) return; await saveAiKey.mutateAsync({ provider, key: apiKeys[provider].trim() }); setApiKeys((current) => ({ ...current, [provider]: "" })); await aiKeyUtils.ai.keys.invalidate(); }} disabled={saveAiKey.isPending || !externalAiConsent}>Salvar chave</Button>{aiKeys.data?.[provider] && <Button type="button" variant="ghost" onClick={async () => { await removeAiKey.mutateAsync({ provider }); await aiKeyUtils.ai.keys.invalidate(); }}>Remover</Button>}</div></div>)}</div>}
        {isAuthenticated && <div className="memory-settings"><strong>Memória autorizada</strong><p>O Iris só usa informações que você salvar aqui. Você pode apagar qualquer item quando quiser.</p><div className="memory-filters"><Input value={memoryQuery} onChange={(event) => setMemoryQuery(event.target.value)} placeholder="Buscar memória" aria-label="Buscar memória" /><select value={memorySource} onChange={(event) => setMemorySource(event.target.value)} aria-label="Filtrar memórias por origem"><option value="all">Todas as origens</option><option value="user-approved">Aprovadas por mim</option></select><select value={memorySort} onChange={(event) => setMemorySort(event.target.value)} aria-label="Ordenar memórias"><option value="recent">Mais recentes</option><option value="alpha">Ordem alfabética</option></select></div><div className="memory-entry"><Input value={newMemory} onChange={(event) => setNewMemory(event.target.value)} placeholder="Ex.: prefiro respostas objetivas" maxLength={500} /><Button type="button" onClick={async () => { if (!newMemory.trim()) return; await createMemory.mutateAsync({ content: newMemory.trim() }); setNewMemory(""); await memoryUtils.memory.list.invalidate(); }} disabled={createMemory.isPending}>Salvar memória</Button></div><div className="memory-list">{filteredMemories.map((memory) => <div className="memory-row" key={memory.id}><span>{memory.content}</span><button type="button" aria-label={`Apagar memória ${memory.content}`} onClick={async () => { await removeMemory.mutateAsync({ id: memory.id }); await memoryUtils.memory.list.invalidate(); }}><Trash2 size={15} /></button></div>)}</div></div>}
        {isAuthenticated && (
          <div className="notification-settings" style={{ border: "1px solid rgba(56, 189, 248, 0.35)", background: "rgba(10, 20, 38, 0.85)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <ShieldCheck size={20} color="#22d3ee" />
              <strong>Privacidade &amp; Governança de Dados</strong>
            </div>
            <p>Separação estrita de domínios com criptografia de ponta a ponta e controle exclusivo.</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10, marginTop: 10 }}>
              <div className="memory-row" style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
                <strong>MEMÓRIA CONTROLADA</strong>
                <small>Preferências e contexto aprovados pelo usuário.</small>
              </div>
              <div className="memory-row" style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
                <strong>DADOS DE SAÚDE</strong>
                <small>Laudos, biomarcadores e sinais vitais isolados.</small>
              </div>
              <div className="memory-row" style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
                <strong>DOCUMENTOS</strong>
                <small>Cofre de arquivos criptografados em repouso.</small>
              </div>
              <div className="memory-row" style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
                <strong>DADOS TEMPORÁRIOS</strong>
                <small>Sessões ativas e histórico efêmero de diálogo.</small>
              </div>
            </div>
            <div style={{ marginTop: 16 }}>
              <strong style={{ fontSize: 13, color: "var(--iris-cyan)" }}>Registro de Auditoria de Ações</strong>
              <p style={{ margin: "4px 0 10px", fontSize: 12, color: "var(--iris-muted)" }}>
                Auditoria permanente de leitura, análise e alterações com confirmação explícita.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {(healthAudits.data ?? []).length === 0 ? (
                  <small style={{ color: "var(--iris-muted)" }}>Nenhuma ação registrada nesta sessão.</small>
                ) : (
                  (healthAudits.data ?? []).slice(0, 5).map((audit) => (
                    <div
                      key={audit.id}
                      style={{
                        padding: "8px 12px",
                        borderRadius: "8px",
                        background: "rgba(255, 255, 255, 0.03)",
                        border: "1px solid rgba(255, 255, 255, 0.06)",
                        fontSize: "12px",
                        color: "#cbd5e1",
                      }}
                    >
                      <span style={{ color: "var(--iris-cyan)", fontWeight: 700 }}>
                        {new Date(audit.createdAt).toLocaleDateString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      </span>{" "}
                      — IRIS {audit.action} ({audit.resource || "saúde"}) | Ação: {audit.alteredData ? "escrita/alteração" : "leitura/análise"} | Alteração: {audit.alteredData ? "sim" : "não"} | Compartilhamento: {audit.sharedData ? "sim" : "não"} | Autorização: {audit.authorizationGranted ? "SIM" : "não necessária"}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
        <div className="access-help"><strong>Acesso rápido</strong><p>Use este mesmo link em qualquer celular ou notebook:</p><a href="https://vidatest-c7dgf7bs.manus.space" target="_blank" rel="noreferrer">vidatest-c7dgf7bs.manus.space</a><small><b>Celular:</b> abra no Chrome ou Safari e escolha “Adicionar à tela de início” ou “Instalar aplicativo”. <b>Notebook:</b> no Chrome ou Edge, use o ícone de instalação na barra de endereço ou crie um atalho na área de trabalho.</small></div>
      </div>
    </main>
  );
}
