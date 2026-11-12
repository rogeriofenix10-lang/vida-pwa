import { useState, type FormEvent } from "react";
import { LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getLocalLockState,
  hashPin,
  recoverLocalPinWithMaster,
  verifyLocalPin,
} from "@/lib/irisLocalLock";
import { verifyIrisMasterForRecovery } from "@/lib/irisWorker";

export { hashPin };

type LocalLockGateProps = {
  children: React.ReactNode;
};

export default function LocalLockGate({ children }: LocalLockGateProps) {
  const [lockState, setLockState] = useState(getLocalLockState);
  const [pin, setPin] = useState("");
  const [rememberThisBrowser, setRememberThisBrowser] = useState(true);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [masterPassword, setMasterPassword] = useState("");
  const [showMasterPassword, setShowMasterPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  if (!lockState.locked) return <>{children}</>;

  const unlockWithPin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || !pin) return;

    setPending(true);
    setError("");
    try {
      const result = await verifyLocalPin(pin, rememberThisBrowser);
      if (!result.verified) {
        setError("PIN incorreto. Confira os dígitos e tente novamente.");
        return;
      }
      if (!result.preferenceSaved || (!rememberThisBrowser && !result.sessionSaved)) {
        setError("O PIN foi aceito, mas o navegador não conseguiu registrar a preferência de liberação. Verifique as permissões de armazenamento; não apague os dados do site.");
        return;
      }

      setPin("");
      setLockState({ locked: false, storageUnavailable: false });
    } catch {
      setError(
        "Não foi possível verificar o PIN neste navegador. Tente novamente.",
      );
    } finally {
      setPending(false);
    }
  };

  const recoverWithMaster = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || !masterPassword) return;

    setPending(true);
    setError("");
    try {
      await recoverLocalPinWithMaster(
        masterPassword,
        verifyIrisMasterForRecovery,
      );
      setMasterPassword("");
      setRecoveryOpen(false);
      setLockState({ locked: false, storageUnavailable: false });
    } catch (recoveryError) {
      setError(
        recoveryError instanceof Error && recoveryError.message
          ? recoveryError.message
          : "Não foi possível validar a senha mestra agora. O PIN local foi mantido.",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="profile-page">
      <section
        className="profile-card"
        aria-labelledby="local-lock-title"
        style={{ maxWidth: 460, margin: "10vh auto" }}
      >
        <div className="profile-heading" style={{ marginTop: 0 }}>
          <div className="profile-icon">
            <LockKeyhole size={22} aria-hidden="true" />
          </div>
          <div>
            <div className="eyebrow">IRIS LOCAL</div>
            <h1 id="local-lock-title">Área protegida</h1>
            <p>Digite o PIN local para continuar neste navegador.</p>
          </div>
        </div>

        {lockState.storageUnavailable && (
          <p
            role="alert"
            style={{ marginTop: 18, color: "#a44854", fontSize: 13 }}
          >
            O armazenamento seguro deste navegador não está disponível. Não é
            possível verificar nem remover o PIN local agora.
          </p>
        )}

        <form
          onSubmit={(event) => void unlockWithPin(event)}
          style={{ display: "grid", gap: 10, marginTop: 22 }}
        >
          <label
            htmlFor="iris-local-pin"
            style={{ color: "#385572", fontSize: 13, fontWeight: 700 }}
          >
            PIN local
          </label>
          <input
            id="iris-local-pin"
            name="iris-local-pin"
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            value={pin}
            onChange={(event) => {
              setPin(event.target.value);
              setError("");
            }}
            aria-describedby="iris-pin-explanation iris-local-lock-error"
            disabled={pending}
            required
            style={{
              width: "100%",
              minHeight: 44,
              padding: "8px 12px",
              border: "1px solid #cfdeec",
              borderRadius: 10,
            }}
          />
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              color: "#52718f",
              fontSize: 13,
            }}
          >
            <input
              type="checkbox"
              checked={rememberThisBrowser}
              onChange={(event) => setRememberThisBrowser(event.target.checked)}
              disabled={pending}
            />
            Lembrar este navegador
          </label>
          <p
            id="iris-pin-explanation"
            style={{ color: "#71829a", fontSize: 12, lineHeight: 1.5 }}
          >
            O PIN local é diferente da senha mestra usada para validar os
            serviços remotos. O PIN protege somente este navegador.
          </p>
          <Button type="submit" disabled={pending || !pin}>
            {pending ? "Verificando…" : "Desbloquear"}
          </Button>
        </form>

        {error && (
          <p
            id="iris-local-lock-error"
            role="alert"
            aria-live="assertive"
            style={{ marginTop: 12, color: "#a44854", fontSize: 13 }}
          >
            {error}
          </p>
        )}

        <div
          style={{
            marginTop: 18,
            borderTop: "1px solid #e6edf4",
            paddingTop: 16,
          }}
        >
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setRecoveryOpen((value) => !value);
              setError("");
            }}
            aria-expanded={recoveryOpen}
            aria-controls="iris-pin-recovery"
            disabled={pending}
            style={{
              paddingInline: 0,
              textAlign: "left",
              whiteSpace: "normal",
            }}
          >
            Esqueci meu PIN — recuperar com senha mestra
          </Button>
          {recoveryOpen && (
            <form
              id="iris-pin-recovery"
              onSubmit={(event) => void recoverWithMaster(event)}
              style={{ display: "grid", gap: 10, marginTop: 12 }}
            >
              <p style={{ color: "#71829a", fontSize: 12, lineHeight: 1.55 }}>
                O PIN local não é a senha mestra. A recuperação só remove a
                proteção PIN depois que a senha mestra for validada pelo serviço
                remoto; falhas de rede ou credenciais não removem o PIN. Ao clicar
                em validar, você autoriza o envio somente da senha para autenticação,
                mesmo no modo local. Nenhum documento será enviado.
              </p>
              <label
                htmlFor="iris-master-recovery"
                style={{ color: "#385572", fontSize: 13, fontWeight: 700 }}
              >
                Senha mestra
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  id="iris-master-recovery"
                  name="iris-master-recovery"
                  type={showMasterPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={masterPassword}
                  onChange={(event) => {
                    setMasterPassword(event.target.value);
                    setError("");
                  }}
                  disabled={pending}
                  required
                  style={{
                    flex: 1,
                    minWidth: 0,
                    minHeight: 44,
                    padding: "8px 12px",
                    border: "1px solid #cfdeec",
                    borderRadius: 10,
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowMasterPassword((visible) => !visible)}
                  aria-pressed={showMasterPassword}
                  aria-label={
                    showMasterPassword
                      ? "Ocultar senha mestra"
                      : "Mostrar senha mestra"
                  }
                  disabled={pending}
                >
                  {showMasterPassword ? "Ocultar" : "Mostrar"}
                </Button>
              </div>
              <Button type="submit" disabled={pending || !masterPassword}>
                {pending
                  ? "Validando…"
                  : "Validar senha mestra e recuperar PIN"}
              </Button>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
