import { describe, expect, it } from "vitest";
import { validateAttachments } from "./ai-adapters";

describe("validateAttachments", () => {
  it("rejeita imagens para Kimi sem visão configurada", () => {
    expect(() => validateAttachments("kimi", [{ type: "image_url", url: "data:image/png;base64,AA==" }])).toThrow("Kimi");
  });

  it("rejeita arquivo remoto para Gemini", () => {
    expect(() => validateAttachments("gemini", [{ type: "file_url", url: "/manus-storage/file.pdf", mimeType: "application/pdf" }])).toThrow("conteúdo inline");
  });

  it("aceita imagem inline para Gemini", () => {
    expect(() => validateAttachments("gemini", [{ type: "image_url", url: "data:image/png;base64,AA==", mimeType: "image/png" }])).not.toThrow();
  });

  it("rejeita imagem remota para Gemini", () => {
    expect(() => validateAttachments("gemini", [{ type: "image_url", url: "/manus-storage/image.png", mimeType: "image/png" }])).toThrow("conteúdo inline");
  });

  it("rejeita arquivos para Kimi", () => {
    expect(() => validateAttachments("kimi", [{ type: "file_url", url: "data:application/pdf;base64,AA==", mimeType: "application/pdf" }])).toThrow("não aceita arquivos");
  });

  it("aceita arquivo inline para Gemini", () => {
    expect(() => validateAttachments("gemini", [{ type: "file_url", url: "data:application/pdf;base64,AA==", mimeType: "application/pdf" }])).not.toThrow();
  });
});
