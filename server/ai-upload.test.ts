import { beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const { storagePut, registerStorageFile } = vi.hoisted(() => ({ storagePut: vi.fn(), registerStorageFile: vi.fn() }));
vi.mock("./storage", () => ({ storagePut }));
vi.mock("./db", async () => {
  const actual = await vi.importActual<typeof import("./db")>("./db");
  return { ...actual, registerStorageFile: registerStorageFile };
});

function context(): TrpcContext {
  return {
    user: {
      id: 7,
      openId: "upload-user",
      name: "Rogerio",
      email: "rogerio@example.com",
      loginMethod: "manus",
      aiProvider: "manus",
      externalAiConsent: false,
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("ai.upload", () => {
  beforeEach(() => { storagePut.mockReset(); registerStorageFile.mockReset(); });

  it("envia o conteúdo ao storage e retorna apenas referência", async () => {
    storagePut.mockResolvedValue({ key: "7-chat/file.pdf", url: "/manus-storage/7-chat/file.pdf" });
    const result = await appRouter.createCaller(context()).ai.upload({ fileName: "file.pdf", mimeType: "application/pdf", data: Buffer.from("%PDF-1.7\n").toString("base64") });
    expect(storagePut).toHaveBeenCalledOnce();
    expect(result).toEqual({ key: "7-chat/file.pdf", url: "/manus-storage/7-chat/file.pdf", mimeType: "application/pdf" });
  });

  it("rejeita conteúdo acima de 8 MB", async () => {
    const data = Buffer.alloc(8 * 1024 * 1024 + 1).toString("base64");
    await expect(appRouter.createCaller(context()).ai.upload({ fileName: "large.txt", mimeType: "text/plain", data })).rejects.toThrow("8 MB");
    expect(storagePut).not.toHaveBeenCalled();
  });
});
