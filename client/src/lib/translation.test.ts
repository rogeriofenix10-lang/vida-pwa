import { describe, expect, it, vi } from "vitest";
import {
  translateWithAvailableService,
  type BrowserTranslatorApi,
  type TranslationInput,
} from "./translation";

const baseInput = (overrides: Partial<TranslationInput> = {}): TranslationInput => ({
  text: "  Olá, mundo!  ",
  sourceLanguage: "pt",
  targetLanguage: "en",
  remoteEnabled: false,
  accessUnlocked: false,
  ...overrides,
});

function browserApi(
  availability: string,
  translate: (text: string) => Promise<string> = async () => "Hello, world!",
): BrowserTranslatorApi {
  return {
    availability: vi.fn(async () => availability),
    create: vi.fn(async () => ({ translate })),
  };
}

describe("local-first translation guards", () => {
  it("returns same-language text locally without consulting or sending to a service", async () => {
    const api = browserApi("available");
    const remoteTranslate = vi.fn();
    const outcome = await translateWithAvailableService(
      baseInput({ sourceLanguage: "pt", targetLanguage: "pt" }),
      { browserApi: api, remoteTranslate },
    );

    expect(outcome).toEqual({
      status: "translated",
      text: "  Olá, mundo!  ",
      provider: "same-language",
    });
    expect(api.availability).not.toHaveBeenCalled();
    expect(api.create).not.toHaveBeenCalled();
    expect(remoteTranslate).not.toHaveBeenCalled();
  });

  it("uses the real browser translator when its model is already available", async () => {
    const api = browserApi("available", async (text) => `real:${text}`);
    const remoteTranslate = vi.fn();
    const outcome = await translateWithAvailableService(baseInput(), {
      browserApi: api,
      remoteTranslate,
    });

    expect(outcome).toEqual({ status: "translated", text: "real:Olá, mundo!", provider: "browser" });
    expect(api.availability).toHaveBeenCalledWith({ sourceLanguage: "pt", targetLanguage: "en" });
    expect(api.create).toHaveBeenCalledOnce();
    expect(remoteTranslate).not.toHaveBeenCalled();
  });

  it("never creates a downloadable model before the separate user consent", async () => {
    const api = browserApi("downloadable");
    const remoteTranslate = vi.fn();
    const outcome = await translateWithAvailableService(baseInput(), {
      browserApi: api,
      remoteTranslate,
    });

    expect(outcome).toEqual({ status: "download-required", remoteReason: "demo" });
    expect(api.create).not.toHaveBeenCalled();
    expect(remoteTranslate).not.toHaveBeenCalled();
  });

  it("creates and uses a downloadable model only after explicit authorization", async () => {
    const api = browserApi("downloadable", async () => "Bonjour le monde !");
    const outcome = await translateWithAvailableService(baseInput({ allowLocalDownload: true }), {
      browserApi: api,
    });

    expect(outcome).toEqual({
      status: "translated",
      text: "Bonjour le monde !",
      provider: "browser",
    });
    expect(api.create).toHaveBeenCalledOnce();
  });

  it("uses the remote fallback only after explicit connected-mode and unlocked-session guards pass", async () => {
    const api = browserApi("unavailable");
    const remoteTranslate = vi.fn(async () => "Hello, world!");
    const outcome = await translateWithAvailableService(baseInput({
      remoteEnabled: true,
      accessUnlocked: true,
    }), { browserApi: api, remoteTranslate });

    expect(outcome).toEqual({ status: "translated", text: "Hello, world!", provider: "remote" });
    expect(remoteTranslate).toHaveBeenCalledOnce();
    expect(remoteTranslate).toHaveBeenCalledWith({
      text: "Olá, mundo!",
      sourceLanguage: "pt",
      targetLanguage: "en",
    });
  });

  it.each([
    { remoteEnabled: false, accessUnlocked: true, remoteReason: "demo" },
    { remoteEnabled: true, accessUnlocked: false, remoteReason: "locked" },
  ] as const)("does not call remote services for blocked access states (%s)", async ({ remoteEnabled, accessUnlocked, remoteReason }) => {
    const remoteTranslate = vi.fn();
    const outcome = await translateWithAvailableService(baseInput({ remoteEnabled, accessUnlocked }), {
      browserApi: null,
      remoteTranslate,
    });

    expect(outcome).toEqual({ status: "blocked", reason: "browser-unavailable", remoteReason });
    expect(remoteTranslate).not.toHaveBeenCalled();
  });

  it("preserves a clear downloading status without starting another model download", async () => {
    const api = browserApi("downloading");
    const outcome = await translateWithAvailableService(baseInput(), { browserApi: api });

    expect(outcome).toEqual({ status: "downloading", remoteReason: "demo" });
    expect(api.create).not.toHaveBeenCalled();
  });

  it("does not create, send or surface a stale result after the input changes", async () => {
    let current = true;
    let finishAvailability!: (value: string) => void;
    const api: BrowserTranslatorApi = {
      availability: vi.fn(() => new Promise((resolve) => { finishAvailability = resolve; })),
      create: vi.fn(async () => ({ translate: async () => "unused" })),
    };
    const remoteTranslate = vi.fn(async () => "unused");
    const pending = translateWithAvailableService(baseInput({
      remoteEnabled: true,
      accessUnlocked: true,
    }), { browserApi: api, remoteTranslate, isCurrent: () => current });

    current = false;
    finishAvailability("available");
    expect(await pending).toEqual({ status: "stale" });
    expect(api.create).not.toHaveBeenCalled();
    expect(remoteTranslate).not.toHaveBeenCalled();
  });

  it("rejects empty outputs instead of fabricating or accepting a blank translation", async () => {
    const api = browserApi("available", async () => "   ");
    const outcome = await translateWithAvailableService(baseInput(), { browserApi: api });

    expect(outcome).toMatchObject({
      status: "blocked",
      reason: "browser-unavailable",
      detail: "O tradutor do navegador retornou um texto vazio.",
      remoteReason: "demo",
    });
  });
});
