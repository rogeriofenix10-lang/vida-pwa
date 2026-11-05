import { beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import { invokeLLM } from "./_core/llm";
import type { TrpcContext } from "./_core/context";

vi.mock("./_core/llm", () => ({ invokeLLM: vi.fn() }));
const { fakeDb } = vi.hoisted(() => {
  const select = vi.fn(() => {
    const chain: any = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(async () => []),
    };
    return chain;
  });
  const insert = vi.fn(() => ({ values: vi.fn(async () => [{ insertId: 1 }]) }));
  return { fakeDb: { select, insert, update: vi.fn(), delete: vi.fn() } as any };
});
vi.mock("./db", async () => {
  const actual = await vi.importActual<typeof import("./db")>("./db");
  return { ...actual, getDb: vi.fn(async () => fakeDb), getStorageFileOwner: vi.fn(async () => null), registerStorageFile: vi.fn(), revokeSession: vi.fn() };
});


function createContext(): TrpcContext {
  return {
    user: {
      id: 42,
      openId: "user-42",
      name: "Rogerio",
      email: "rogerio@example.com",
      loginMethod: "manus",
      aiProvider: "manus",
      externalAiConsent: true,
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("ai.suggest", () => {
  beforeEach(() => vi.clearAllMocks());

  it("converte linguagem natural em sugestão para o Radar da Vida", async () => {
    vi.mocked(invokeLLM).mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({
        reply: "Organizei sua conta para confirmação.",
        intent: "create_radar_item",
        objective: "Registrar a conta de internet com vencimento no dia 10",
        entities: [],
        missingInformation: [],
        confidence: 0.95,
        riskLevel: "low",
        requiresAuthorization: true,
        hasSuggestion: true,
        label: "Conta de internet",
        detail: "vence dia 10",
        date: "dia 10",
        priority: "importante",
        action: "Confirmar dados",
        query: "",
        channel: "other",
        recipient: "",
        message: "",
        calendarStartAt: "",
        calendarEndAt: "",
      }) } }],
    } as never);

    const result = await appRouter.createCaller(createContext()).ai.suggest({ message: "Minha conta de internet vence dia 10", model: "chatgpt" });

    expect(vi.mocked(invokeLLM)).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-5-mini" }));
    expect(result.provider).toBe("chatgpt");
    expect(result.reply).toContain("Organizei");
    expect(result.suggestion).toMatchObject({ label: "Conta de internet", priority: "importante" });
  });
});
