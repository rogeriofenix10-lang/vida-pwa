import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("VIDA PWA metadata", () => {
  it("declares an installable standalone app with mobile icons", () => {
    const manifest = JSON.parse(
      readFileSync(resolve(process.cwd(), "client/public/manifest.webmanifest"), "utf8"),
    ) as {
      display: string;
      start_url: string;
      icons: Array<{ sizes: string; type: string }>;
    };

    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sizes: "192x192", type: "image/png" }),
        expect.objectContaining({ sizes: "512x512", type: "image/png" }),
      ]),
    );
  });

  it("keeps API and diagnostic requests outside the cache strategy", () => {
    const serviceWorker = readFileSync(resolve(process.cwd(), "client/public/sw.js"), "utf8");

    expect(serviceWorker).toContain('url.pathname.startsWith("/api/")');
    expect(serviceWorker).toContain('url.pathname.startsWith("/__manus__/")');
    expect(serviceWorker).toContain("if (request.method !== \"GET\" || !isSameOrigin || isApiRequest) return;");
    expect(serviceWorker).toContain('request.mode === "navigate"');
    expect(serviceWorker).not.toContain('cache.put(request, response)');
  });

  it("keeps mobile text input readable and keyboard focus visible", () => {
    const css = readFileSync(resolve(process.cwd(), "client/src/index.css"), "utf8");

    expect(css).toContain(":focus-visible");
    expect(css).toContain(".command-input-wrap input { font-size: 16px; }");
    expect(css).toContain("button { min-height: 42px; }");
  });
});
