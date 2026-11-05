import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ChevronUp, Menu } from "lucide-react";
import { LANGUAGE_LABELS, useIrisLanguage } from "@/lib/irisI18n";
import type { SupportedLanguage } from "@shared/irisLanguageAndUpload";
import "./pwa-status-bar.css";

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
const modules = [["/documentos", "Arquivo"], ["/catalogo", "Catálogo"], ["/comercial", "Comercial"], ["/offline", "Offline"], ["/midia", "Mídia"], ["/seguranca", "Segurança"], ["/diagnostico", "Diagnóstico"], ["/configuracoes", "Configurações"]] as const;

export default function PwaStatusBar() {
  const { language, setLanguage, copy } = useIrisLanguage();
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);
  const [mode, setMode] = useState<"demo" | "connected">(() => localStorage.getItem("iris.mode") === "connected" ? "connected" : "demo");
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => { const onInstall=(event:Event)=>{event.preventDefault();setInstallEvent(event as InstallPromptEvent)}; const onInstalled=()=>{setInstalled(true);setInstallEvent(null)}; const standalone=window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & {standalone?:boolean}).standalone===true; setInstalled(standalone); const on=()=>setOnline(true), off=()=>setOnline(false); window.addEventListener("beforeinstallprompt",onInstall);window.addEventListener("appinstalled",onInstalled);window.addEventListener("online",on);window.addEventListener("offline",off);return()=>{window.removeEventListener("beforeinstallprompt",onInstall);window.removeEventListener("appinstalled",onInstalled);window.removeEventListener("online",on);window.removeEventListener("offline",off)}},[]);
  const install=async()=>{if(!installEvent)return;await installEvent.prompt();const result=await installEvent.userChoice;if(result.outcome==="accepted")setInstallEvent(null)};
  const changeMode=(value:"demo"|"connected")=>{setMode(value);localStorage.setItem("iris.mode",value)};
  return <div className="iris-pwa-status" role="status" aria-label="Status da Iris"><span className="iris-pwa-pill">Iris 5.5 · {installed?copy.installed:copy.pwa}</span><span className={online?"iris-pwa-safe":"iris-pwa-pill"}>{online?"Online":"Offline local"}</span><details className="iris-pwa-menu"><summary><Menu size={14}/> Menu <ChevronUp size={13}/></summary><div className="iris-pwa-menu-panel"><label>Idioma<select className="iris-pwa-select" value={language} onChange={event=>setLanguage(event.target.value as SupportedLanguage)}>{Object.entries(LANGUAGE_LABELS).map(([code,label])=><option key={code} value={code}>{label}</option>)}</select></label><label>Modo<select className="iris-pwa-select" value={mode} onChange={event=>changeMode(event.target.value as "demo"|"connected")}><option value="demo">{copy.demo}</option><option value="connected">{copy.connected}</option></select></label><button className="iris-pwa-voice" type="button" onClick={()=>setVoiceOn(value=>!value)} aria-pressed={voiceOn}>{copy.microphone}: {voiceOn?copy.on:copy.off}</button><span className="iris-pwa-safe">{copy.blocked}</span><div className="iris-pwa-module-grid">{modules.map(([href,label])=><Link key={href} href={href}>{label}</Link>)}</div>{installEvent&&!installed&&<button className="iris-pwa-install" type="button" onClick={install}>{copy.install}</button>}</div></details></div>;
}
