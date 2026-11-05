import { and, eq } from "drizzle-orm";
import { workflowRuns, workflowSteps, workflows } from "../drizzle/schema";
import { getAgentTool } from "./agent-tools";
import { getDb } from "./db";
import { assertAgentMayRun, getControlSettings, recordAgentEvent } from "./agent-control";

export type WorkflowStepDefinition = { toolName: string; input: Record<string, unknown>; requiresAuthorization?: boolean };
export type WorkflowDefinition = { version: 1; steps: WorkflowStepDefinition[]; maxSteps?: number };

/** Central execution gate: only a user-authorized foreground run may execute tools. */
export function assertExplicitAuthorization(options: { authorized?: boolean; autonomous?: boolean }) {
  if (options.autonomous) throw new Error("Autonomia de execução está bloqueada: esta ação exige autorização explícita do usuário");
  if (!options.authorized) throw new Error("Este workflow exige autorização explícita antes da execução");
}

function resolveRefs(value: unknown, outputs: unknown[]): unknown {
  if (typeof value === "string") {
    const match = value.match(/^\$step\.(\d+)\.result(?:\.(.+))?$/);
    if (!match) return value;
    const index = Number(match[1]) - 1;
    const result = outputs[index];
    if (!match[2]) return result;
    return match[2].split(".").reduce((acc: any, key) => acc?.[key], result as any);
  }
  if (Array.isArray(value)) return value.map(v => resolveRefs(v, outputs));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveRefs(v, outputs)]));
  return value;
}

export function validateWorkflowDefinition(definition: unknown): WorkflowDefinition {
  if (!definition || typeof definition !== "object") throw new Error("Definição de workflow inválida");
  const raw = definition as any;
  if (raw.version !== 1 || !Array.isArray(raw.steps) || raw.steps.length < 1 || raw.steps.length > 20) throw new Error("Workflow deve ter entre 1 e 20 etapas");
  const steps = raw.steps.map((step: any, stepIndex: number) => {
    if (!step || typeof step.toolName !== "string" || !step.input || typeof step.input !== "object") throw new Error("Etapa de workflow inválida");
    const tool = getAgentTool(step.toolName);
    if (!tool) throw new Error(`Ferramenta não permitida no workflow: ${step.toolName}`);
    const refs = Array.from(JSON.stringify(step.input).matchAll(/\$step\.(\d+)\.result(?:\.([^"\s}\]]+))?/g), m => Number(m[1]));
    if (refs.some(ref => !Number.isInteger(ref) || ref < 1 || ref > stepIndex)) throw new Error(`Referência inválida em ${step.toolName}: só é permitido usar resultados de etapas anteriores`);
    // References are intentionally deferred until execution, because their runtime
    // type is the output of a previous tool (and may be a number/object).
    const parsed = tool.inputSchema.safeParse(step.input);
    if (!parsed.success && refs.length === 0) throw new Error(`Entrada inválida para ${step.toolName}`);
    return { toolName: step.toolName, input: step.input, requiresAuthorization: step.requiresAuthorization !== false };
  });
  return { version: 1, steps, maxSteps: Math.min(Number(raw.maxSteps) || steps.length, 20) };
}

export async function runWorkflow(userId: number, workflowId: number, input: unknown = {}, options: { authorized?: boolean; autonomous?: boolean } = {}) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível");
  const rows = await db.select().from(workflows).where(and(eq(workflows.id, workflowId), eq(workflows.userId, userId), eq(workflows.status, "active"))).limit(1);
  const workflow = rows[0];
  if (!workflow) throw new Error("Workflow não encontrado ou pausado");
  const definition = validateWorkflowDefinition(JSON.parse(workflow.definition));
  await assertAgentMayRun(db, userId, definition.steps.some(step => getAgentTool(step.toolName)?.risk === "high"));
  const control = await getControlSettings(db, userId);
  const startedAt = Date.now();
  // IRIS safety invariant: no workflow may execute as an autonomous/background action.
  // Execution is allowed only when the caller explicitly authorizes this run.
  assertExplicitAuthorization(options);
  const runInsert = await db.insert(workflowRuns).values({ workflowId, userId, status: "running", input: JSON.stringify(input) });
  const runId = Number(runInsert[0].insertId);
  const outputs: unknown[] = [];
  try {
    for (let i = 0; i < definition.steps.length; i++) {
      if (Date.now() - startedAt > control.maxWorkflowRuntimeSeconds * 1000) throw new Error("Tempo máximo do workflow excedido");
      const step = definition.steps[i];
      const tool = getAgentTool(step.toolName)!;
      const resolvedInput = resolveRefs(step.input, outputs);
      const parsed = tool.inputSchema.parse(resolvedInput);
      const idempotencyKey = `workflow:${workflowId}:run:${runId}:step:${i + 1}`;
      const existing = await db.select().from(workflowSteps).where(eq(workflowSteps.idempotencyKey, idempotencyKey)).limit(1);
      if (existing[0]?.status === "succeeded") { outputs.push(existing[0].output ? JSON.parse(existing[0].output) : null); continue; }
      const inserted = await db.insert(workflowSteps).values({ runId, userId, stepIndex: i + 1, toolName: tool.name, status: "running", idempotencyKey, input: JSON.stringify(parsed) });
      const stepId = Number(inserted[0].insertId);
      const result = await tool.execute({ db, userId }, parsed);
      outputs.push(result.result);
      await db.update(workflowSteps).set({ status: "succeeded", output: JSON.stringify(result.result), finishedAt: new Date() }).where(eq(workflowSteps.id, stepId));
    }
    const output = { runId, results: outputs };
    await db.update(workflowRuns).set({ status: "succeeded", output: JSON.stringify(output), finishedAt: new Date() }).where(and(eq(workflowRuns.id, runId), eq(workflowRuns.userId, userId)));
    await recordAgentEvent(db, userId, "workflow.succeeded", { workflowId, runId });
    return { success: true as const, ...output };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha no workflow";
    await db.update(workflowRuns).set({ status: "failed", errorCode: "workflow-step-failed", output: JSON.stringify({ message, completedSteps: outputs.length }), finishedAt: new Date() }).where(and(eq(workflowRuns.id, runId), eq(workflowRuns.userId, userId)));
    await recordAgentEvent(db, userId, "workflow.failed", { workflowId, runId, message }, "error");
    throw error;
  }
}
