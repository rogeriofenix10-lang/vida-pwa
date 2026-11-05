import { Link } from "wouter";
import { ChevronDown, FolderOpen, LayoutDashboard } from "lucide-react";
import "./iris-quick-launch.css";

const links = [
  ["/documentos", "Arquivo Inteligente", "Documentos, exames e gastos"],
  ["/catalogo", "Catálogo", "Produtos e importação CSV"],
  ["/comercial", "Comercial", "Clientes e fornecedores"],
  ["/offline", "Espaço offline", "Tarefas e notas locais"],
  ["/midia", "Estúdio de mídia", "Imagem, áudio e vídeo"],
  ["/seguranca", "Segurança", "Aprovações e backup"],
  ["/diagnostico", "Diagnóstico", "PWA, voz e navegador"],
  ["/configuracoes", "Configurações", "Idioma, modo e privacidade"],
] as const;

export default function IrisQuickLaunch() {
  return (
    <nav className="iris-quick-launch" aria-label="Módulos da Iris">
      <Link className="iris-quick-primary" href="/documentos"><FolderOpen size={17} /> Arquivo Inteligente</Link>
      <Link className="iris-quick-home" href="/"><LayoutDashboard size={16} /> Visão geral</Link>
      <details className="iris-quick-menu">
        <summary><ChevronDown size={16} /> Módulos</summary>
        <div className="iris-quick-panel">
          {links.map(([href, title, description]) => <Link key={href} href={href}><strong>{title}</strong><small>{description}</small></Link>)}
        </div>
      </details>
    </nav>
  );
}
