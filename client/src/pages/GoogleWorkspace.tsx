import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, CalendarDays, ExternalLink, FolderOpen, Plus, RefreshCw } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  googleCalendarCreate,
  googleCalendarEvents,
  googleCalendarStatus,
  googleDriveCreateFolder,
  googleDriveFiles,
  googleDriveStatus,
  isIrisAccessUnlocked,
  startGoogleOAuth,
  type GoogleCalendarEvent,
  type GoogleDriveFile,
} from "@/lib/irisWorker";

function messageFor(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export default function GoogleWorkspace() {
  const [driveAuthorized, setDriveAuthorized] = useState(false);
  const [calendarAuthorized, setCalendarAuthorized] = useState(false);
  const [files, setFiles] = useState<GoogleDriveFile[]>([]);
  const [events, setEvents] = useState<GoogleCalendarEvent[]>([]);
  const [folder, setFolder] = useState("");
  const [eventTitle, setEventTitle] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const retryAfterUnlock = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setMessage("");
    const [driveResult, calendarResult] = await Promise.allSettled([
      googleDriveStatus(),
      googleCalendarStatus(),
    ]);
    let failed = false;

    if (driveResult.status === "fulfilled") {
      const authorized = driveResult.value.authorized === true;
      setDriveAuthorized(authorized);
      if (authorized) {
        try {
          setFiles((await googleDriveFiles()).files ?? []);
        } catch (error) {
          failed = true;
          setMessage(messageFor(error, "Não foi possível consultar o Google Drive."));
        }
      } else {
        setFiles([]);
      }
    } else {
      failed = true;
      setMessage(messageFor(driveResult.reason, "Não foi possível consultar o Google Drive."));
    }

    if (calendarResult.status === "fulfilled") {
      const authorized = calendarResult.value.authorized === true;
      setCalendarAuthorized(authorized);
      if (authorized) {
        try {
          setEvents((await googleCalendarEvents()).items ?? []);
        } catch (error) {
          failed = true;
          setMessage(messageFor(error, "Não foi possível consultar o Google Calendar."));
        }
      } else {
        setEvents([]);
      }
    } else {
      failed = true;
      setMessage(messageFor(calendarResult.reason, "Não foi possível consultar o Google Calendar."));
    }

    retryAfterUnlock.current = failed && !isIrisAccessUnlocked();
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onAccessChanged = () => {
      if (!isIrisAccessUnlocked() || !retryAfterUnlock.current) return;
      retryAfterUnlock.current = false;
      void refresh();
    };
    window.addEventListener("iris-access-changed", onAccessChanged);
    return () => window.removeEventListener("iris-access-changed", onAccessChanged);
  }, [refresh]);

  const connectGoogle = async (product: "drive" | "calendar") => {
    setMessage("");
    try {
      await startGoogleOAuth(product);
    } catch (error) {
      setMessage(messageFor(error, "Não foi possível iniciar a autorização Google."));
    }
  };

  const createFolder = async () => {
    if (!folder.trim()) return;
    if (!window.confirm("Criar esta pasta no Google Drive?")) return;
    try {
      await googleDriveCreateFolder(folder.trim(), true);
      setFolder("");
      setMessage("Pasta criada no Google Drive.");
      await refresh();
    } catch (error) {
      setMessage(messageFor(error, "Falha ao criar pasta."));
    }
  };

  const createEvent = async () => {
    if (!eventTitle.trim()) return;
    const start = new Date(Date.now() + 3600000).toISOString();
    const end = new Date(Date.now() + 7200000).toISOString();
    if (!window.confirm("Criar este evento no Google Calendar?")) return;
    try {
      await googleCalendarCreate({ summary: eventTitle.trim(), start, end }, true);
      setEventTitle("");
      setMessage("Evento criado no Google Calendar.");
      await refresh();
    } catch (error) {
      setMessage(messageFor(error, "Falha ao criar evento."));
    }
  };

  return (
    <main className="profile-page">
      <div className="profile-card">
        <Link href="/" className="back-link"><ArrowLeft size={16} /> Voltar ao Radar</Link>
        <div className="profile-heading">
          <div className="profile-icon"><FolderOpen size={22} /></div>
          <div>
            <div className="eyebrow">IRIS GOOGLE WORKSPACE · OAUTH</div>
            <h1>Drive e Calendar</h1>
            <p>Conecte ou consulte serviços somente após desbloquear o acesso remoto. Alterações exigem confirmação explícita.</p>
          </div>
        </div>

        <section className="memory-settings" aria-labelledby="google-drive-heading">
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <strong id="google-drive-heading"><FolderOpen size={16} /> Google Drive</strong>
            {driveAuthorized
              ? <span className="iris-pwa-safe">Autorizado</span>
              : <Button onClick={() => void connectGoogle("drive")}>Autorizar Drive</Button>}
            <Button variant="outline" onClick={() => void refresh()} disabled={loading}>
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} /> Atualizar
            </Button>
          </div>
          {driveAuthorized && <>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <input value={folder} onChange={(event) => setFolder(event.target.value)} placeholder="Nome da nova pasta" />
              <Button onClick={() => void createFolder()}><Plus size={15} /> Criar pasta</Button>
            </div>
            {files.length === 0 ? <small>Nenhum arquivo retornado.</small> : files.slice(0, 50).map((file) => (
              <div className="memory-row" key={file.id}>
                <span><b>{file.name}</b><br /><small>{file.mimeType ?? "arquivo"} · {file.modifiedTime ?? ""}</small></span>
                {file.webViewLink && <a href={file.webViewLink} target="_blank" rel="noreferrer" aria-label={`Abrir ${file.name}`}><ExternalLink size={15} /></a>}
              </div>
            ))}
          </>}
        </section>

        <section className="memory-settings" aria-labelledby="google-calendar-heading">
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <strong id="google-calendar-heading"><CalendarDays size={16} /> Google Calendar</strong>
            {calendarAuthorized
              ? <span className="iris-pwa-safe">Autorizado</span>
              : <Button onClick={() => void connectGoogle("calendar")}>Autorizar Calendar</Button>}
          </div>
          {calendarAuthorized && <>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <input value={eventTitle} onChange={(event) => setEventTitle(event.target.value)} placeholder="Título do próximo evento" />
              <Button onClick={() => void createEvent()}><Plus size={15} /> Criar evento</Button>
            </div>
            {events.length === 0 ? <small>Nenhum evento próximo.</small> : events.slice(0, 30).map((event) => (
              <div className="memory-row" key={event.id}>
                <span><b>{event.summary || "Sem título"}</b><br /><small>{event.start?.dateTime || event.start?.date || ""}</small></span>
              </div>
            ))}
          </>}
        </section>
        {message && <div className="profile-message" role="status">{message}</div>}
      </div>
    </main>
  );
}
