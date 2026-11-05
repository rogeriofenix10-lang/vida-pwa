export const SUPPORTED_LANGUAGES = ["pt-BR", "en", "es", "fr", "it", "de", "zh-CN", "ja-JP", "ar"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export interface LanguagePreference {
  language: SupportedLanguage;
  voiceEnabled: boolean;
  textFallback: true;
}

export function createLanguagePreference(language: SupportedLanguage, voiceEnabled = false): LanguagePreference {
  return { language, voiceEnabled, textFallback: true };
}

export interface UploadAsset {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  source: "user-upload";
  preservedOriginal: true;
  externalTransmission: "blocked";
}

export function registerUpload(input: { id: string; filename: string; mimeType: string; sizeBytes: number }): UploadAsset {
  if (!input.id || !input.filename || input.sizeBytes < 0) throw new Error("upload inválido");
  return { ...input, source: "user-upload", preservedOriginal: true, externalTransmission: "blocked" };
}
