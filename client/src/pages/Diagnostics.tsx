import { useEffect, useState } from "react";
import { Activity, AlertTriangle, ArrowLeft, CheckCircle2, Info, XCircle } from "lucide-react";
import { Link } from "wouter";
import { useIrisLanguage } from "@/lib/irisI18n";
import { IRIS_STATIC_MODE } from "@/lib/irisRuntime";
import { readLocal, writeLocal } from "@/lib/irisLocalStore";

type CheckStatus = "success" | "error" | "warning" | "info";
type Check = { label: string; status: CheckStatus; detail: string };

type ManifestIcon = { src?: string; sizes?: string; type?: string };
type PwaManifestCheck = { manifestValid: boolean; iconsValid: boolean; detail: string };

async function inspectPwaManifest(manifestHref?: string): Promise<PwaManifestCheck> {
  if (!manifestHref) return { manifestValid: false, iconsValid: false, detail: "Link de manifesto ausente." };
  try {
    const response = await fetch(manifestHref, { cache: "no-store", credentials: "omit" });
    if (!response.ok) throw new Error(`manifesto HTTP ${response.status}`);
    const manifest = await response.json() as { start_url?: string; scope?: string; icons?: ManifestIcon[] };
    const root = new URL("/", manifestHref);
    const start = new URL(manifest.start_url || "/", manifestHref);
    const scope = new URL(manifest.scope || "/", manifestHref);
    const manifestValid = start.origin === root.origin && scope.origin === root.origin && scope.pathname === "/";
    const sizes = ["192x192", "512x512"];
    const results = await Promise.all(sizes.map(async (size) => {
      const icon = manifest.icons?.find((item) => item.type === "image/png" && item.sizes?.split(/\s+/).includes(size));
      if (!icon?.src) return { valid: false, detail: `Ícone ${size} não declarado.` };
      const iconResponse = await fetch(new URL(icon.src, manifestHref), { cache: "no-store", credentials: "omit" });
      if (!iconResponse.ok) return { valid: false, detail: `Ícone ${size} não carregou (HTTP ${iconResponse.status}).` };
      const bytes = new Uint8Array(await iconResponse.arrayBuffer());
      const signature = [137, 80, 78, 71, 13, 10, 26, 10];
      if (bytes.length < 24 || signature.some((byte, index) => bytes[index] !== byte))
        return { valid: false, detail: `Ícone ${size} não é um PNG válido.` };
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const actual = `${view.getUint32(16)}x${view.getUint32(20)}`;
      return { valid: actual === size, detail: actual === size ? `Ícone ${size} validado.` : `Ícone declarado ${size}, dimensões reais ${actual}.` };
    }));
    const iconsValid = results.every((result) => result.valid);
    return {
      manifestValid,
      iconsValid,
      detail: [manifestValid ? "escopo e start_url na raiz" : "escopo/start_url inválido", ...results.map((result) => result.detail)].join("; "),
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "falha ao validar manifesto e ícones";
    return { manifestValid: false, iconsValid: false, detail };
  }
}

async function hasPwaShellCache() {
  try {
    const names = (await caches.keys()).filter((name) => name.startsWith("iris-pwa-"));
    for (const name of names) {
      const cache = await caches.open(name);
      const required = ["/", "/manifest.webmanifest", "/icons/iris-192.png", "/icons/iris-512.png"];
      const entries = await Promise.all(required.map((path) => cache.match(new URL(path, window.location.origin))));
      if (entries.every(Boolean)) return true;
    }
  } catch {
    return false;
  }
  return false;
}

export default function Diagnostics() {
  const { language, setLanguage } = useIrisLanguage();
  const [checks, setChecks] = useState<Check[] | null>(null);

  useEffect(() => {
    let active = true;
    const run = async () => {
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true;
      const isHttps = window.location.protocol === "https:";
      const hasSpeech = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
      const hasRecognition = "SpeechRecognition" in window || "webkitSpeechRecognition" in window;
      const hasRecorder = "MediaRecorder" in window;
      const hasIndexedDb = "indexedDB" in window;
      const hasServiceWorker = "serviceWorker" in navigator;
      const hasManifest = Boolean(document.querySelector('link[rel="manifest"]'));
      let registration: ServiceWorkerRegistration | undefined;
      let serviceWorkerError = "";
      if (hasServiceWorker) {
        try {
          registration = await navigator.serviceWorker.getRegistration();
        } catch (error) {
          serviceWorkerError = error instanceof Error ? error.message : "erro ao consultar o registro";
        }
      }
      const serviceWorkerActive = Boolean(registration?.active);
      const manifestCheck = await inspectPwaManifest(document.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.href);
      const shellCacheReady = await hasPwaShellCache();

      let savedMode = "";
      let localStorageAvailable = false;
      let lastBackup: string | null = null;
      try {
        savedMode = localStorage.getItem("iris.mode") ?? "";
        lastBackup = localStorage.getItem("iris.lastBackupAt");
        localStorageAvailable = true;
      } catch {
        localStorageAvailable = false;
      }

      let indexedDbWritable = false;
      let indexedDbError = "";
      try {
        await writeLocal("iris:diagnostic", { checkedAt: new Date().toISOString() });
        indexedDbWritable = (await readLocal("iris:diagnostic", null)) !== null;
      } catch (error) {
        indexedDbError = error instanceof Error ? error.message : "erro ao gravar";
      }

      let storageDetail = localStorageAvailable
        ? "Preferências locais disponíveis."
        : "Preferências locais indisponíveis ou bloqueadas pelo navegador.";
      try {
        const estimate = await navigator.storage?.estimate();
        if (estimate?.quota) storageDetail += ` Limite estimado: ${(estimate.quota / 1073741824).toFixed(1)} GB.`;
      } catch {
        // A estimativa é opcional e não invalida o armazenamento.
      }

      let permission: PermissionStatus | null = null;
      try {
        if (typeof navigator.permissions?.query === "function") {
          permission = await navigator.permissions.query({ name: "microphone" as PermissionName });
        }
      } catch {
        permission = null;
      }

      const pwaAvailable = isHttps && hasServiceWorker && serviceWorkerActive && manifestCheck.manifestValid && manifestCheck.iconsValid;
      const pwaLabel = standalone
        ? (language === "pt-BR" ? "PWA instalado" : "PWA installed")
        : pwaAvailable
          ? (language === "pt-BR" ? "PWA disponível para instalação" : "PWA available to install")
          : (language === "pt-BR" ? "PWA não instalado; disponibilidade não confirmada" : "PWA not installed; availability unconfirmed");
      const pwaDetail = standalone
        ? (language === "pt-BR" ? "Este navegador informa execução em modo standalone; a instalação foi detectada." : "The browser reports standalone mode; installation was detected.")
        : pwaAvailable
          ? (language === "pt-BR" ? "HTTPS, manifesto, ícones PNG e Service Worker ativo foram validados. O aplicativo ainda não está instalado neste navegador." : "HTTPS, manifest, PNG icons and active Service Worker were validated. The app is not installed in this browser yet.")
          : (language === "pt-BR" ? `Instalação não detectada; disponibilidade PWA não confirmada. ${manifestCheck.detail}` : `Installation not detected; PWA availability unconfirmed. ${manifestCheck.detail}`);

      const next: Check[] = [
        { label: pwaLabel, status: standalone ? "success" : pwaAvailable ? "info" : "warning", detail: pwaDetail },
        {
          label: language === "pt-BR" ? "HTTPS" : "HTTPS",
          status: isHttps ? "success" : "warning",
          detail: isHttps
            ? (language === "pt-BR" ? "A página está sendo servida pelo protocolo HTTPS." : "The page is served over HTTPS.")
            : (language === "pt-BR" ? `A página está em ${window.location.protocol}; HTTPS não foi confirmado.` : `The page uses ${window.location.protocol}; HTTPS was not confirmed.`),
        },
        {
          label: "Service Worker",
          status: !hasServiceWorker ? "error" : serviceWorkerActive ? "success" : "error",
          detail: !hasServiceWorker
            ? (language === "pt-BR" ? "A API de Service Worker não está disponível neste navegador." : "The Service Worker API is unavailable in this browser.")
            : serviceWorkerError
              ? (language === "pt-BR" ? `Não foi possível consultar o registro: ${serviceWorkerError}` : `Could not read the registration: ${serviceWorkerError}`)
              : !registration
                ? (language === "pt-BR" ? "A API existe, mas não há registro para esta página." : "The API exists, but this page has no registration.")
                : !serviceWorkerActive
                  ? (language === "pt-BR" ? "Há um registro, mas nenhum Service Worker está ativo." : "A registration exists, but no Service Worker is active.")
                  : (language === "pt-BR" ? "Registro de Service Worker ativo confirmado." : "An active Service Worker registration was confirmed."),
        },
        {
          label: language === "pt-BR" ? "Manifesto PWA" : "PWA manifest",
          status: hasManifest && manifestCheck.manifestValid ? "success" : "warning",
          detail: hasManifest
            ? (language === "pt-BR" ? `Manifesto carregado; ${manifestCheck.detail}.` : `Manifest loaded; ${manifestCheck.detail}.`)
            : (language === "pt-BR" ? "Nenhum link rel=manifest foi encontrado nesta página." : "No rel=manifest link was found on this page."),
        },
        {
          label: language === "pt-BR" ? "Ícones PWA 192/512" : "PWA icons 192/512",
          status: manifestCheck.iconsValid ? "success" : "warning",
          detail: manifestCheck.detail,
        },
        {
          label: language === "pt-BR" ? "Cache do PWA" : "PWA cache",
          status: shellCacheReady ? "success" : serviceWorkerActive ? "warning" : "info",
          detail: shellCacheReady
            ? (language === "pt-BR" ? "Página, manifesto e os dois ícones foram encontrados no cache Iris." : "Page, manifest and both icons were found in the Iris cache.")
            : (language === "pt-BR" ? "O shell offline ainda não foi confirmado no cache Iris." : "The offline shell was not confirmed in the Iris cache yet."),
        },
        {
          label: "IndexedDB",
          status: indexedDbWritable ? "success" : "error",
          detail: indexedDbWritable
            ? (language === "pt-BR" ? "Leitura e escrita local confirmadas." : "Local read and write confirmed.")
            : (language === "pt-BR" ? `Armazenamento local indisponível ou bloqueado${indexedDbError ? `: ${indexedDbError}` : "."}` : `Local storage is unavailable or blocked${indexedDbError ? `: ${indexedDbError}` : "."}`),
        },
        {
          label: language === "pt-BR" ? "Último backup" : "Last backup",
          status: lastBackup ? "success" : "info",
          detail: lastBackup
            ? (language === "pt-BR" ? `Último backup registrado: ${new Date(lastBackup).toLocaleString()}.` : `Last recorded backup: ${new Date(lastBackup).toLocaleString()}.`)
            : (language === "pt-BR" ? "Nenhum backup foi registrado neste navegador." : "No backup has been recorded in this browser."),
        },
        {
          label: language === "pt-BR" ? "Síntese de voz" : "Speech synthesis",
          status: hasSpeech ? "success" : "warning",
          detail: hasSpeech
            ? (language === "pt-BR" ? "Síntese de voz disponível." : "Speech synthesis is available.")
            : (language === "pt-BR" ? "Síntese de voz indisponível." : "Speech synthesis is unavailable."),
        },
        {
          label: language === "pt-BR" ? "Reconhecimento de voz" : "Speech recognition",
          status: hasRecognition ? "success" : "info",
          detail: hasRecognition
            ? (language === "pt-BR" ? "Captura de voz disponível no navegador." : "Voice capture is available in the browser.")
            : (language === "pt-BR" ? "O reconhecimento de voz pode não ser suportado; o intérprete também aceita texto." : "Speech recognition may not be supported; the interpreter also accepts text."),
        },
        {
          label: language === "pt-BR" ? "Gravador de vídeo" : "Video recorder",
          status: hasRecorder ? "success" : "info",
          detail: hasRecorder
            ? (language === "pt-BR" ? "MediaRecorder disponível." : "MediaRecorder is available.")
            : (language === "pt-BR" ? "Gravação WebM indisponível neste navegador." : "WebM recording is unavailable in this browser."),
        },
        {
          label: language === "pt-BR" ? "Microfone" : "Microphone",
          status: permission?.state === "denied" ? "error" : permission?.state === "granted" ? "success" : "info",
          detail: permission
            ? (language === "pt-BR" ? `Permissão atual: ${permission.state}.` : `Current permission: ${permission.state}.`)
            : (language === "pt-BR" ? "Permissão será consultada ou solicitada somente ao iniciar voz." : "Permission is queried or requested only when voice starts."),
        },
        {
          label: language === "pt-BR" ? "Armazenamento local" : "Local storage",
          status: localStorageAvailable ? "success" : "error",
          detail: storageDetail,
        },
        {
          label: language === "pt-BR" ? "Rede" : "Network",
          status: navigator.onLine ? "success" : "warning",
          detail: navigator.onLine
            ? (language === "pt-BR" ? "O navegador informa conexão ativa." : "The browser reports an active connection.")
            : (language === "pt-BR" ? "Modo offline detectado; chamadas que exigem rede podem falhar." : "Offline mode detected; network-dependent requests may fail."),
        },
      ];
      if (active) setChecks(next);
    };
    void run();
    return () => {
      active = false;
    };
  }, [language]);

  const statusIcon = (status: CheckStatus) => {
    if (status === "success") return <CheckCircle2 className="diagnostic-status-success" size={19} aria-label="Disponível" />;
    if (status === "error") return <XCircle className="diagnostic-status-error" size={19} aria-label="Indisponível" />;
    if (status === "warning") return <AlertTriangle className="diagnostic-status-warning" size={19} aria-label="Atenção" />;
    return <Info className="diagnostic-status-info" size={19} aria-label="Informação" />;
  };

  const modeLabel = savedModeLabel(language);
  const localModeText = language === "pt-BR"
        ? "Documentos, finanças e catálogo permanecem locais. Serviços remotos exigem opt-in em Configurações, desbloqueio e ação explícita."
    : "Local mode: the product catalog uses IndexedDB in this browser, independently of connected mode.";

  return (
    <main className="profile-page">
      <div className="profile-card">
        <Link href="/" className="back-link"><ArrowLeft size={16} /> Voltar ao Radar</Link>
        <div className="profile-heading">
          <div className="profile-icon"><Activity size={22} /></div>
          <div>
            <div className="eyebrow">IRIS 5.5 · DIAGNÓSTICO</div>
            <h1>{language === "pt-BR" ? "Diagnóstico local" : "Local diagnostics"}</h1>
            <p>{language === "pt-BR" ? "Verifique os recursos do navegador e o estado de instalação." : "Check browser capabilities and installation state."}</p>
          </div>
        </div>
        <div className="notification-settings">
          <strong>{language === "pt-BR" ? "Modo de operação" : "Operating mode"}: {modeLabel}</strong>
          <p>{IRIS_STATIC_MODE
            ? (language === "pt-BR" ? "App estático. Dados locais continuam no navegador; cada chamada remota exige opt-in em Configurações, desbloqueio e clique explícito." : "Static app. Local data remains in the browser; each remote call requires Settings opt-in, unlocking and an explicit click.")
            : localStorageModeDescription(language)}
          </p>
          <p className="diagnostic-local-mode">{localModeText}</p>
        </div>
        <div className="memory-settings">
          <strong>{language === "pt-BR" ? "Idioma da interface" : "Interface language"}</strong>
          <select value={language} onChange={(event) => setLanguage(event.target.value as typeof language)} style={{ width: "100%", minHeight: 42, marginTop: 8 }}>
            <option value="pt-BR">Português (Brasil)</option>
            <option value="en">English</option>
            <option value="es">Español</option>
            <option value="fr">Français</option>
            <option value="it">Italiano</option>
            <option value="de">Deutsch</option>
            <option value="zh-CN">中文</option>
            <option value="ja-JP">日本語</option>
            <option value="ar">العربية</option>
          </select>
        </div>
        <div className="memory-settings">
          <strong>{language === "pt-BR" ? "Capacidades detectadas" : "Detected capabilities"}</strong>
          {checks === null ? (
            <small>{language === "pt-BR" ? "Executando diagnóstico local…" : "Running local diagnostics…"}</small>
          ) : (
            checks.map((check) => (
              <div className="memory-row" key={check.label}>
                <span><b>{check.label}</b><br /><small>{check.detail}</small></span>
                {statusIcon(check.status)}
              </div>
            ))
          )}
        </div>
      </div>
    </main>
  );
}

function savedModeLabel(language: string) {
  let connected = false;
  try {
    connected = localStorage.getItem("iris.mode") === "connected" && localStorage.getItem("iris.remoteOptIn") === "1";
  } catch {
    connected = false;
  }
  if (language === "pt-BR") return connected ? "Serviços remotos ativados" : "Demonstração local";
  return connected ? "Remote services enabled" : "Local demo";
}

function localStorageModeDescription(language: string) {
  let connected = false;
  try {
    connected = localStorage.getItem("iris.mode") === "connected" && localStorage.getItem("iris.remoteOptIn") === "1";
  } catch {
    connected = false;
  }
  if (language === "pt-BR") {
    return connected
      ? "Aplicação dinâmica em modo conectado. O catálogo permanece local; ações de serviço são iniciadas pela interface e podem usar serviços externos."
      : "Aplicação dinâmica em modo de demonstração. O catálogo e as preferências são locais; não presuma que uma ação iniciada esteja bloqueada de usar serviços externos.";
  }
  return connected
    ? "Dynamic application in connected mode. The catalog remains local; service actions are initiated by the interface and may use external services."
    : "Dynamic application in demo mode. The catalog and preferences are local; do not assume an initiated action is blocked from using external services.";
}
