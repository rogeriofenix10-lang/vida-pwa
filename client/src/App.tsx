import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import LocalLockGate from "./components/LocalLockGate";
import FirstRunGate from "./components/FirstRunGate";

const Home = lazy(() => import("@/pages/Home"));
const Profile = lazy(() => import("./pages/Profile"));
const IntegrationHealth = lazy(() => import("./pages/IntegrationHealth"));
const LocalLab = lazy(() => import("./pages/LocalLab"));
const Connections = lazy(() => import("./pages/Connections"));
const Interpreter = lazy(() => import("./pages/Interpreter"));
const SecurityCenter = lazy(() => import("./pages/SecurityCenter"));
const MediaStudio = lazy(() => import("./pages/MediaStudio"));
const Diagnostics = lazy(() => import("./pages/Diagnostics"));
const ProductCatalog = lazy(() => import("./pages/ProductCatalog"));
const Settings = lazy(() => import("./pages/Settings"));
const OfflineWorkspace = lazy(() => import("./pages/OfflineWorkspace"));
const BusinessHub = lazy(() => import("./pages/BusinessHub"));
const DocumentVault = lazy(() => import("./pages/DocumentVault"));
const FinanceHub = lazy(() => import("./pages/FinanceHub"));
const GoogleWorkspace = lazy(() => import("./pages/GoogleWorkspace"));
const NotFound = lazy(() => import("./pages/NotFound"));

function Router() {
  return (
    <Suspense
      fallback={
        <main className="profile-page">
          <div className="profile-card">Carregando módulo local…</div>
        </main>
      }
    >
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/perfil" component={Profile} />
        <Route path="/profile" component={Profile} />
        <Route path="/operacao" component={IntegrationHealth} />
        <Route path="/laboratorio" component={LocalLab} />
        <Route path="/conexoes" component={Connections} />
        <Route path="/interprete" component={Interpreter} />
        <Route path="/seguranca" component={SecurityCenter} />
        <Route path="/midia" component={MediaStudio} />
        <Route path="/diagnostico" component={Diagnostics} />
        <Route path="/catalogo" component={ProductCatalog} />
        <Route path="/configuracoes" component={Settings} />
        <Route path="/offline" component={OfflineWorkspace} />
        <Route path="/comercial" component={BusinessHub} />
        <Route path="/documentos" component={DocumentVault} />
        <Route path="/financas" component={FinanceHub} />
        <Route path="/google" component={GoogleWorkspace} />
        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark" switchable>
        <TooltipProvider>
          <Toaster />
          <FirstRunGate>
            <LocalLockGate>
              <Router />
            </LocalLockGate>
          </FirstRunGate>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
