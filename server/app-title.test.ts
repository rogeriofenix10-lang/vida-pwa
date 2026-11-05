import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("app title configuration", () => {
  it("uses Iris as the official application title", () => {
    expect(process.env.VITE_APP_TITLE ?? "Iris").toBe("Iris");
  });

  it("publishes Iris in the effective document and install metadata", () => {
    const html = readFileSync(resolve(process.cwd(), "client/index.html"), "utf8");
    const manifest = readFileSync(resolve(process.cwd(), "client/public/manifest.webmanifest"), "utf8");
    expect(html).toContain("<title>Iris — Sua vida, organizada pela IA</title>");
    expect(html).toContain('apple-mobile-web-app-title" content="Iris"');
    expect(manifest).toContain('"name": "Iris — Sua vida, organizada pela IA"');
    expect(manifest).toContain('"short_name": "Iris"');
  });
});
