import { ArrowLeft, Settings2 } from "lucide-react";
import { Link } from "wouter";
import { useIrisLanguage } from "@/lib/irisI18n";
import type { SupportedLanguage } from "@shared/irisLanguageAndUpload";
import { hashPin } from "@/components/LocalLockGate";
import { Button } from "@/components/ui/button";

export default function Settings() {
  const { language, setLanguage } = useIrisLanguage();
  const mode = localStorage.getItem("iris.mode") === "connected" ? "connected" : "demo";
  const setMode = (value: string) => localStorage.setItem("iris.mode", value);
  const setPin = async () => { const pin = window.prompt("Defina um PIN local de 4 ou mais dígitos:"); if (pin && pin.length >= 4) { localStorage.setItem("iris.pinHash", await hashPin(pin)); sessionStorage.setItem("iris.unlocked", "1"); window.alert("PIN local ativado neste navegador."); } };
  const removePin = () => { localStorage.removeItem("iris.pinHash"); sessionStorage.removeItem("iris.unlocked"); window.alert("PIN local removido."); };
  return <main className="profile-page"><div className="profile-card">
    <Link href="/" className="back-link"><ArrowLeft size={16}/> Voltar ao Radar</Link>
    <div className="profile-heading"><div className="profile-icon"><Settings2 size={22}/></div><div><div className="eyebrow">IRIS 5.5 · CONFIGURAÇÕES</div><h1>Configurações</h1><p>Preferências locais e controles de segurança. Nada é enviado automaticamente.</p></div></div>
    <div className="memory-settings"><strong>Idioma</strong><select value={language} onChange={(e) => setLanguage(e.target.value as SupportedLanguage)} style={{width:"100%",minHeight:42,marginTop:8}}><option value="pt-BR">Português (Brasil)</option><option value="en">English</option><option value="es">Español</option><option value="fr">Français</option><option value="it">Italiano</option><option value="de">Deutsch</option><option value="zh-CN">中文</option><option value="ja-JP">日本語</option><option value="ar">العربية</option></select></div>
    <div className="memory-settings"><strong>Modo de operação</strong><select defaultValue={mode} onChange={(e) => setMode(e.target.value)} style={{width:"100%",minHeight:42,marginTop:8}}><option value="demo">Demonstração — dados fictícios e ações bloqueadas</option><option value="connected">Conectado — integrações continuam exigindo aprovação</option></select></div>
    <div className="notification-settings"><strong>Privacidade e custo</strong><p>Armazenamento: local. Upload: manual. Integrações: opcionais. Billing: não habilitado pelo pacote. Ações externas: bloqueadas sem aprovação explícita.</p></div>
    <div className="memory-settings"><strong>Proteção local opcional</strong><p>Um PIN protege o acesso neste navegador. Ele não substitui autenticação de servidor nem criptografa automaticamente arquivos exportados.</p><div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:8}}><Button variant="outline" onClick={()=>void setPin()}>Definir PIN</Button><Button variant="ghost" onClick={removePin}>Remover PIN</Button></div></div>
    <div className="memory-settings"><strong>Acessos rápidos</strong><div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:10}}><Link href="/diagnostico" className="back-link">Diagnóstico</Link><Link href="/seguranca" className="back-link">Segurança</Link><Link href="/catalogo" className="back-link">Catálogo</Link><Link href="/offline" className="back-link">Espaço offline</Link></div></div>
  </div></main>;
}
