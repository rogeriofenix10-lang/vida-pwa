import { describe, expect, it, beforeEach } from "vitest";
import { executeWithRuntime, resetConnectorRuntimeState, ConnectorRuntimeError, createIdempotencyKey } from "./integration-runtime";

describe("IRIS integration runtime", () => {
  beforeEach(() => resetConnectorRuntimeState());
  it("retries temporary failures and succeeds", async () => {
    let n = 0;
    const r = await executeWithRuntime({ provider: "x", action: "read", baseBackoffMs: 1, jitterMs: 0, execute: async () => { n++; if (n < 3) throw new ConnectorRuntimeError("busy", { kind: "retryable", provider: "x", status: 503 }); return { ok: 1 }; } });
    expect(r.ok).toBe(true); expect(r.attempts).toBe(3);
  });
  it("replays idempotent result", async () => {
    let n = 0; const key = createIdempotencyKey({ provider: "gmail", action: "send", message: "a" });
    const a = await executeWithRuntime({ provider: "gmail", action: "send", idempotencyKey: key, execute: async () => (++n) });
    const b = await executeWithRuntime({ provider: "gmail", action: "send", idempotencyKey: key, execute: async () => (++n) });
    expect(a.data).toBe(1); expect(b.data).toBe(1); expect(b.replayed).toBe(true); expect(n).toBe(1);
  });
  it("opens circuit after threshold", async () => {
    const fail = async () => { throw new ConnectorRuntimeError("down", { kind: "retryable", provider: "meta", status: 503 }); };
    await executeWithRuntime({ provider: "meta", action: "write", maxAttempts: 1, circuitFailureThreshold: 2, execute: fail });
    await executeWithRuntime({ provider: "meta", action: "write", maxAttempts: 1, circuitFailureThreshold: 2, execute: fail });
    await expect(executeWithRuntime({ provider: "meta", action: "write", maxAttempts: 1, circuitFailureThreshold: 2, execute: fail })).rejects.toThrow("Circuit breaker aberto");
  });
});
