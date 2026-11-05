import type { Express, Request, Response } from "express";
import { ingestIntegrationEvent } from "./integration-events";

export function registerWhatsAppWebhook(app: Express) {
  app.get("/api/webhooks/whatsapp", (req: Request, res: Response) => {
    const mode = String(req.query["hub.mode"] ?? "");
    const token = String(req.query["hub.verify_token"] ?? "");
    const challenge = String(req.query["hub.challenge"] ?? "");

    const expectedToken = String(
      process.env.WHATSAPP_VERIFY_TOKEN ?? ""
    );

    if (
      mode === "subscribe" &&
      token &&
      expectedToken &&
      token === expectedToken
    ) {
      return res.status(200).send(challenge);
    }

    return res.status(403).send("Forbidden");
  });

  app.post("/api/webhooks/whatsapp", async (req: Request, res: Response) => {
    try {
      const rawBody = (req as any).rawBody;

      if (!rawBody) {
        return res.status(400).json({
          ok: false,
          error: "raw-body-unavailable",
        });
      }

      const signature = String(
        req.header("X-Hub-Signature-256") ?? ""
      );

      const secret = String(
        process.env.WHATSAPP_APP_SECRET ?? ""
      );

      if (!secret) {
        return res.status(500).json({
          ok: false,
          error: "whatsapp-app-secret-not-configured",
        });
      }

      const payload = rawBody.toString("utf8");

      const result = await ingestIntegrationEvent({
        provider: "meta:whatsapp",
        type: "messages",
        rawBody: payload,
        eventId:
          String(req.header("X-WhatsApp-Event-ID") ?? "") ||
          undefined,
        signature,
        secret,
        timestamp: Date.now(),
      });

      return res.status(200).json(result);
    } catch (error) {
      console.error("[WhatsApp Webhook]", error);

      const message =
        error instanceof Error ? error.message : "webhook-error";

      if (message === "WEBHOOK_SIGNATURE_INVALID") {
        return res.status(401).json({
          ok: false,
          error: "invalid-signature",
        });
      }

      return res.status(500).json({
        ok: false,
        error: "webhook-processing-failed",
      });
    }
  });
}
