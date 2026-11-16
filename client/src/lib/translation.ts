export type BrowserTranslationAvailability =
  | "available"
  | "downloadable"
  | "downloading"
  | "unavailable";

export type TranslationLanguagePair = {
  sourceLanguage: string;
  targetLanguage: string;
};

export type BrowserTranslator = {
  translate(text: string): Promise<string>;
  destroy?: () => void | Promise<void>;
};

export type BrowserTranslatorApi = {
  availability?: (
    pair: TranslationLanguagePair,
  ) => Promise<BrowserTranslationAvailability | string>;
  create?: (pair: TranslationLanguagePair) => Promise<BrowserTranslator>;
};

export type TranslationInput = TranslationLanguagePair & {
  text: string;
  remoteEnabled: boolean;
  accessUnlocked: boolean;
  allowLocalDownload?: boolean;
};

export type TranslationOutcome =
  | {
      status: "translated";
      text: string;
      provider: "same-language" | "browser" | "remote";
    }
  | {
      status: "download-required";
      remoteReason?: "demo" | "locked" | "unavailable";
    }
  | {
      status: "downloading";
      remoteReason?: "demo" | "locked" | "unavailable";
    }
  | {
      status: "blocked";
      reason: "browser-unavailable";
      remoteReason?: "demo" | "locked" | "unavailable";
      detail?: string;
    }
  | { status: "stale" };

export type TranslationServices = {
  /** Pass null in tests to explicitly simulate a browser without Translator. */
  browserApi?: BrowserTranslatorApi | null;
  remoteTranslate?: (input: TranslationLanguagePair & { text: string }) => Promise<string>;
  /** Prevent results or remote sends after the user edits text or languages. */
  isCurrent?: () => boolean;
};

function browserTranslatorApi(): BrowserTranslatorApi | null {
  return (globalThis as typeof globalThis & { Translator?: BrowserTranslatorApi })
    .Translator ?? null;
}

function remoteReason(input: TranslationInput): "demo" | "locked" | undefined {
  if (!input.remoteEnabled) return "demo";
  if (!input.accessUnlocked) return "locked";
  return undefined;
}

function isCurrent(services: TranslationServices) {
  return services.isCurrent?.() !== false;
}

function normalizeAvailability(value: string | undefined): BrowserTranslationAvailability {
  return value === "available" || value === "downloadable" || value === "downloading"
    ? value
    : "unavailable";
}

export async function translateWithAvailableService(
  input: TranslationInput,
  services: TranslationServices = {},
): Promise<TranslationOutcome> {
  if (!input.text.trim()) {
    return { status: "blocked", reason: "browser-unavailable" };
  }
  if (input.sourceLanguage === input.targetLanguage) {
    return { status: "translated", text: input.text, provider: "same-language" };
  }
  if (!isCurrent(services)) return { status: "stale" };

  const api = services.browserApi === undefined ? browserTranslatorApi() : services.browserApi;
  let availability: BrowserTranslationAvailability = "unavailable";
  let browserError: string | undefined;
  if (api?.availability && api.create) {
    try {
      availability = normalizeAvailability(await api.availability({
        sourceLanguage: input.sourceLanguage,
        targetLanguage: input.targetLanguage,
      }));
    } catch (error) {
      browserError = error instanceof Error ? error.message : "Falha ao consultar o tradutor do navegador.";
    }
  }
  if (!isCurrent(services)) return { status: "stale" };

  const canTranslateLocally = availability === "available" ||
    (availability === "downloadable" && input.allowLocalDownload === true);
  if (canTranslateLocally && api?.create) {
    let translator: BrowserTranslator | undefined;
    try {
      if (!isCurrent(services)) return { status: "stale" };
      translator = await api.create({
        sourceLanguage: input.sourceLanguage,
        targetLanguage: input.targetLanguage,
      });
      const translated = await translator.translate(input.text.trim());
      if (!isCurrent(services)) return { status: "stale" };
      if (!translated.trim()) throw new Error("O tradutor do navegador retornou um texto vazio.");
      return { status: "translated", text: translated, provider: "browser" };
    } catch (error) {
      if (!isCurrent(services)) return { status: "stale" };
      browserError = error instanceof Error ? error.message : "Falha no tradutor do navegador.";
    } finally {
      try {
        await translator?.destroy?.();
      } catch {
        // A limpeza opcional não substitui o resultado da tradução.
      }
    }
  }

  const reason = remoteReason(input);
  const canUseRemote = !reason && Boolean(services.remoteTranslate);
  if (canUseRemote) {
    if (!isCurrent(services)) return { status: "stale" };
    const translated = await services.remoteTranslate!({
      text: input.text.trim(),
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
    });
    if (!isCurrent(services)) return { status: "stale" };
    if (!translated.trim()) throw new Error("O serviço remoto retornou uma tradução vazia.");
    return { status: "translated", text: translated, provider: "remote" };
  }

  const blockedRemoteReason = reason ?? (services.remoteTranslate ? undefined : "unavailable");
  if (availability === "downloadable" && input.allowLocalDownload !== true) {
    return { status: "download-required", remoteReason: blockedRemoteReason };
  }
  if (availability === "downloading") {
    return { status: "downloading", remoteReason: blockedRemoteReason };
  }
  return {
    status: "blocked",
    reason: "browser-unavailable",
    remoteReason: blockedRemoteReason,
    ...(browserError ? { detail: browserError } : {}),
  };
}
