import { lazy, Suspense, useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import LocalLockGate from "./components/LocalLockGate";
import FirstRunGate from "./components/FirstRunGate";
import {
  isIrisRemoteModeEnabled,
  lockIrisAccess,
  restoreIrisAccess,
} from "@/lib/irisWorker";

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
        <Route path="/financas/" component={FinanceHub} />
        <Route path="/financeiro" component={FinanceHub} />
        <Route path="/financeiro/" component={FinanceHub} />
        <Route path="/google" component={GoogleWorkspace} />
        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  useEffect(() => {
    const reconcileRemoteMode = () => {
      if (isIrisRemoteModeEnabled()) {
        void restoreIrisAccess();
      } else {
        void lockIrisAccess();
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === "iris.mode" || event.key === "iris.remoteOptIn") {
        reconcileRemoteMode();
      }
    };
    const onResume = () => {
      if (isIrisRemoteModeEnabled()) void restoreIrisAccess();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") onResume();
    };

    reconcileRemoteMode();
    window.addEventListener("iris-mode-changed", reconcileRemoteMode);
    window.addEventListener("storage", onStorage);
    window.addEventListener("online", onResume);
    window.addEventListener("focus", onResume);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("iris-mode-changed", reconcileRemoteMode);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("online", onResume);
      window.removeEventListener("focus", onResume);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

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
