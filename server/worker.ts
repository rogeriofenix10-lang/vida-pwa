import "dotenv/config";
import { getDb } from "./db";
import { processNextIntegrationJob } from "./integration-queue";
import { createPubSubRuntime } from "./pubsub-runtime";

const pollMs = Math.max(250, Number(process.env.IRIS_WORKER_POLL_MS ?? 1000));
let stopping = false;

async function run() {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_URL é obrigatório para o worker");
  const pubsub = await createPubSubRuntime();
  if (pubsub && process.env.IRIS_JOB_SUBSCRIPTION) {
    await pubsub.subscribe(process.env.IRIS_JOB_SUBSCRIPTION, async () => { await processNextIntegrationJob(db); });
    console.log("[Worker] Pub/Sub subscription ativa");
  }
  while (!stopping) {
    try { const result = await processNextIntegrationJob(db); if (!result.processed) await new Promise(r => setTimeout(r, pollMs)); }
    catch (error) { console.error("[Worker] loop failed", error); await new Promise(r => setTimeout(r, pollMs)); }
  }
}
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });
run().catch(error => { console.error("[Worker] fatal", error); process.exitCode = 1; });
