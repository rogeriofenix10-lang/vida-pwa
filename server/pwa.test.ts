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

  it("uses PNG files whose actual dimensions match the manifest", () => {
    const manifest = JSON.parse(readFileSync(resolve(process.cwd(), "client/public/manifest.webmanifest"), "utf8"));
    for (const icon of manifest.icons) {
      const bytes = readFileSync(resolve(process.cwd(), "client/public", icon.src.replace(/^\//, "")));
      expect(bytes.subarray(1, 4).toString()).toBe("PNG");
      expect(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`).toBe(icon.sizes);
    }
  });

  it("keeps API and diagnostic requests outside the cache strategy", () => {
    const serviceWorker = readFileSync(resolve(process.cwd(), "client/public/sw.js"), "utf8");

    expect(serviceWorker).toContain("/icons/iris-192.png");
    expect(serviceWorker).toContain("/icons/iris-512.png");
    expect(serviceWorker).toContain('url.pathname.startsWith("/api/")');
    expect(serviceWorker).toContain('url.pathname.startsWith("/__manus__/")');
    expect(serviceWorker).toContain('url.pathname.startsWith("/manus-storage/")');
    expect(serviceWorker).toContain('request.headers.has("Authorization")');
    expect(serviceWorker).toContain('response.headers.get("Cache-Control")');
    expect(serviceWorker).toContain("if (request.method !== \"GET\" || !isSameOrigin || isApiRequest || isPrivateResource) return;");
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
