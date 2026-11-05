import type { Express } from "express";
import { ENV } from "./env";
import { sdk } from "./sdk";
import { getStorageFileOwner } from "../db";

// These assets are intentionally public because browsers request them before
// a user session exists (favicon, PWA manifest and push notification icon).
const PUBLIC_ASSETS = new Set([
  "iris-icon-192_66278cac.png",
  "iris-icon-512_a7e3fc66.png",
]);

export function registerStorageProxy(app: Express) {
  app.get("/manus-storage/*", async (req, res) => {
    const key = String((req.params as Record<string, string>)[0] ?? "").replace(/^\/+/, "");
    if (!key || key.includes("..") || key.includes("\\")) {
      res.status(400).send("Invalid storage key");
      return;
    }

    const isPublicAsset = PUBLIC_ASSETS.has(key);
    let authenticatedUserId: number | null = null;
    if (!isPublicAsset) {
      try {
        const user = await sdk.authenticateRequest(req);
        if (user.isCron || user.id < 1) {
          res.status(403).send("Forbidden");
          return;
        }
        authenticatedUserId = user.id;
      } catch {
        res.status(401).send("Authentication required");
        return;
      }

      const owner = await getStorageFileOwner(key);
      if (!owner || owner.userId !== authenticatedUserId) {
        res.status(403).send("Forbidden");
        return;
      }
    }

    if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
      res.status(500).send("Storage proxy not configured");
      return;
    }

    try {
      const forgeUrl = new URL("v1/storage/presign/get", ENV.forgeApiUrl.replace(/\/+$/, "") + "/");
      forgeUrl.searchParams.set("path", key);
      const forgeResp = await fetch(forgeUrl, { headers: { Authorization: `Bearer ${ENV.forgeApiKey}` } });
      if (!forgeResp.ok) {
        console.error(`[StorageProxy] forge error: ${forgeResp.status}`);
        res.status(502).send("Storage backend error");
        return;
      }
      const { url } = (await forgeResp.json()) as { url: string };
      if (!url) {
        res.status(502).send("Empty signed URL from backend");
        return;
      }
      res.set("Cache-Control", "private, no-store");
      res.redirect(307, url);
    } catch (err) {
      console.error("[StorageProxy] failed:", err);
      res.status(502).send("Storage proxy error");
    }
  });
}
