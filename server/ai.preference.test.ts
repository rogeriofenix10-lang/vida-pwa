import { describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import { getDb } from "./db";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", () => ({ getDb: vi.fn() }));

function createContext(user: TrpcContext["user"]): TrpcContext {
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("ai.preference", () => {
  it("returns the public catalog with unavailable providers marked", async () => {
    const result = await appRouter.createCaller(createContext(null)).ai.options();
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "manus", available: true }),
      expect.objectContaining({ id: "chatgpt", available: true }),
      expect.objectContaining({ id: "gemini", available: true }),
      expect.objectContaining({ id: "kimi", available: false }),
    ]));
  });

  it("requires authentication to read the saved preference", async () => {
    await expect(appRouter.createCaller(createContext(null)).ai.preference()).rejects.toThrow();
  });

  it("saves the selected provider for the authenticated user", async () => {
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    vi.mocked(getDb).mockResolvedValue({ update } as never);

    const user = {
      id: 42,
      openId: "user-42",
      name: "Rogerio",
      email: "rogerio@example.com",
      loginMethod: "manus",
      aiProvider: "manus",
      externalAiConsent: true,
      role: "user" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    };

    const result = await appRouter.createCaller(createContext(user)).ai.setPreference({ provider: "gemini" });

    expect(result).toEqual({ provider: "gemini" });
    expect(update).toHaveBeenCalledOnce();
    expect(set).toHaveBeenCalledWith({ aiProvider: "gemini" });
    expect(where).toHaveBeenCalledOnce();
  });
});
