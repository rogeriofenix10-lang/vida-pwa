import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { sdk } from "./sdk";
import { getDb } from "../db";
import { users } from "../../drizzle/schema";
import { sendPendingReminder } from "../push";
import { registerIntegrationOAuthRoutes } from "./oauth-integrations-route";
import { runDueWorkflows } from "../workflow-scheduler";
import { getLocalLabStatus, resetLocalLab, runLocalLab } from "../local-lab";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(self), geolocation=()");
    if (process.env.NODE_ENV === "production") res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    next();
  });
  // Configure body parser with a limit just above the Base64 representation of an 8 MB file.
  app.use(express.json({ limit: "11.5mb" }));
  app.use(express.urlencoded({ limit: "11.5mb", extended: true }));
  app.get("/healthz", (_req, res) => res.status(200).json({ ok: true, service: "iris", version: "5.5.1" }));
  app.get("/readyz", async (_req, res) => {
    try {
      const db = await getDb();
      if (!db) return res.status(503).json({ ok: false, reason: "database-unavailable" });
      await db.execute("SELECT 1");
      return res.status(200).json({ ok: true, service: "iris", version: "5.5.1", database: "ok" });
    } catch {
      return res.status(503).json({ ok: false, reason: "database-unavailable" });
    }
  });
  if (process.env.NODE_ENV !== "production" && process.env.IRIS_LOCAL_LAB !== "false") {
    app.get("/api/local-lab/status", (_req, res) => res.json(getLocalLabStatus()));
    app.post("/api/local-lab/reset", (_req, res) => {
      resetLocalLab();
      return res.json({ ok: true, reset: true });
    });
    app.post("/api/local-lab/run", async (req, res) => {
      try {
        const result = await runLocalLab(req.body);
        return res.json(result);
      } catch (error) {
        return res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "local-lab-error" });
      }
    });
  }
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  registerIntegrationOAuthRoutes(app);
  app.post("/api/scheduled/pending-reminders", async (req, res) => {
    const startedAt = new Date().toISOString();
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user.isCron || !user.taskUid) return res.status(403).json({ error: "cron-only" });
      const db = await getDb();
      if (!db) return res.status(503).json({ error: "database-unavailable", taskUid: user.taskUid });
      const recipients = await db.select({ id: users.id }).from(users);
      const sent = await Promise.all(recipients.map((recipient) => sendPendingReminder(recipient.id, "Lembrete do Iris")));
      return res.json({ ok: true, taskUid: user.taskUid, recipients: recipients.length, sent: sent.reduce((total, count) => total + count, 0), startedAt });
    } catch (error) {
      console.error("[Scheduler] pending reminders failed", error);
      return res.status(500).json({ error: "scheduler-failed", timestamp: startedAt });
    }
  });
  app.post("/api/scheduled/workflows", async (req,res)=>{ try { const user=await sdk.authenticateRequest(req); if(!user.isCron||!user.taskUid)return res.status(403).json({error:"cron-only"}); const results=await runDueWorkflows(); return res.json({ok:true,taskUid:user.taskUid,results}); } catch(error){ console.error("[Scheduler] workflows failed",error); return res.status(500).json({error:"workflow-scheduler-failed"}); } });
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = process.env.NODE_ENV === "production" ? preferredPort : await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
