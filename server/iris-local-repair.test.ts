import { afterEach, describe, expect, it, vi } from "vitest";
import { buildLocalBackup, downloadBlob, downloadJson, restoreLocalBackup, writeLocal } from "../client/src/lib/irisLocalStore";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
function mockStore(seed: Record<string, unknown> = {}) {
  const values = new Map(Object.entries(seed));
  let abortNext = false;
  const db = { close: vi.fn(), transaction: (_store: string, mode: string) => {
    const transaction: any = { error: new Error("quota"), objectStore: () => ({
      get: (key: string) => { const request: any = {}; queueMicrotask(() => { request.result = values.get(key); request.onsuccess?.(); }); return request; },
      put: (value: unknown, key: string) => { queueMicrotask(() => { if (abortNext) { abortNext = false; transaction.onabort?.(); } else { values.set(key, value); transaction.oncomplete?.(); } }); return {}; },
    }) }; return transaction;
  } };
  vi.stubGlobal("window", { indexedDB: {}, dispatchEvent: vi.fn() });
  vi.stubGlobal("indexedDB", { open: () => { const request: any = {}; queueMicrotask(() => { request.result = db; request.onsuccess(); }); return request; } });
  vi.stubGlobal("localStorage", { getItem: vi.fn(() => "demo"), setItem: vi.fn() });
  return { values, abort: () => { abortNext = true; } };
}

describe("local financial persistence and downloads", () => {
  it("keeps a download link attached for click and revokes only later", () => {
    vi.useFakeTimers();
    const link = { href: "", download: "", style: {}, click: vi.fn(), remove: vi.fn() };
    const appendChild = vi.fn();
    vi.stubGlobal("document", { createElement: () => link, body: { appendChild } });
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:test"), revokeObjectURL });
    downloadBlob("catalogo.csv", "nome,valor\nTeste,20", "text/csv");
    expect(appendChild).toHaveBeenCalledWith(link);
    expect(link.download).toBe("catalogo.csv");
    expect(link.click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60000);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test");
  });
  it("does not report generic catalog exports as a workspace backup", () => {
    vi.useFakeTimers();
    vi.stubGlobal("document", { createElement: () => ({ style: {}, click() {}, remove() {} }), body: { appendChild() {} } });
    vi.stubGlobal("URL", { createObjectURL: () => "blob:test", revokeObjectURL() {} });
    const setItem = vi.fn(); vi.stubGlobal("localStorage", { setItem });
    downloadJson("catalogo.json", { format: "iris-product-catalog" });
    expect(setItem).not.toHaveBeenCalled();
  });
  it("includes finances in backup and restores them without losing amounts", async () => {
    const entries = [{ id: "e1", type: "expense", description: "Hotel", amount: 350, status: "open", dueAt: "2026-11-15", createdAt: "2026-11-11", category: "Hotel" }];
    const store = mockStore({ irisFinances: entries });
    const backup = await buildLocalBackup();
    expect(backup.irisFinances).toEqual(entries);
    await restoreLocalBackup(new File([JSON.stringify(backup)], "backup.json", { type: "application/json" }));
    expect(store.values.get("irisFinances")).toEqual(entries);
  });
  it("preserves finances when restoring a valid version-1 backup without that field", async () => {
    const store = mockStore({ irisFinances: [{ id: "keep" }] });
    const legacyBackup = {
      format: "iris-local-backup", version: 1, backupType: "light", language: "pt-BR",
      approvals: [], mediaHistory: [], products: [], offlineWorkspace: [], businessContacts: [], irisDocuments: [],
    };
    await restoreLocalBackup(new File([JSON.stringify(legacyBackup)], "old.json", { type: "application/json" }));
    expect(store.values.get("irisFinances")).toEqual([{ id: "keep" }]);
  });
  it("rejects an aborted write rather than claiming it was saved", async () => {
    const store = mockStore(); store.abort();
    await expect(writeLocal("irisFinances", [{ id: "new" }])).rejects.toThrow("quota");
    expect(store.values.has("irisFinances")).toBe(false);
  });
});
