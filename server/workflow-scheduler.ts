import { and, eq, lte, or, isNull, sql } from "drizzle-orm";
import { workflowSchedules } from "../drizzle/schema";
import { getDb } from "./db";
import { recordAgentEvent } from "./agent-control";

function cronMatches(value: number, expr: string, min: number, max: number) {
  if (expr === "*") return true;
  return expr.split(",").some(part => {
    const [base, stepText] = part.split("/");
    const step = stepText ? Number(stepText) : 1;
    if (!Number.isInteger(step) || step < 1) return false;
    const range = base === "*" ? [min, max] : base.includes("-") ? base.split("-").map(Number) : [Number(base), Number(base)];
    if (range.length !== 2 || !Number.isInteger(range[0]) || !Number.isInteger(range[1])) return false;
    const [start, end] = range;
    if (start < min || end > max || start > end) return false;
    return value >= start && value <= end && (value - start) % step === 0;
  });
}

function zonedParts(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short",
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).filter(p => p.type !== "literal").map(p => [p.type, p.value]));
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = weekdayMap[parts.weekday] ?? -1;
  return { minute: Number(parts.minute), hour: Number(parts.hour) % 24, day: Number(parts.day), month: Number(parts.month), weekday };
}

export function nextScheduledRun(cron: string, from: Date, timezone: string) {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error("Cron inválido: use 5 campos");
  const [min, hour, dom, mon, dow] = parts;
  const start = new Date(Math.floor(from.getTime() / 60000) * 60000 + 60000);
  for (let i = 0; i < 366 * 24 * 60; i++) {
    const d = new Date(start.getTime() + i * 60000);
    const z = zonedParts(d, timezone);
    const domMatch = cronMatches(z.day, dom, 1, 31);
    const dowExpr = dow.split(",").map(x => x.trim() === "7" ? "0" : x).join(",");
    const dowMatch = cronMatches(z.weekday, dowExpr, 0, 6);
    const domWildcard = dom.trim() === "*";
    const dowWildcard = dow.trim() === "*";
    const dayMatch = domWildcard && dowWildcard ? true : domWildcard ? dowMatch : dowWildcard ? domMatch : domMatch || dowMatch;
    if (cronMatches(z.minute, min, 0, 59) && cronMatches(z.hour, hour, 0, 23) && cronMatches(z.month, mon, 1, 12) && dayMatch) return d;
  }
  throw new Error("Não foi possível calcular próxima execução");
}

export async function runDueWorkflows() {
  const db = await getDb(); if (!db) throw new Error("Banco de dados indisponível");
  const now = new Date();
  const due = await db.select().from(workflowSchedules).where(and(eq(workflowSchedules.enabled, true), lte(workflowSchedules.nextRunAt, now), or(isNull(workflowSchedules.lockedUntil), lte(workflowSchedules.lockedUntil, now)))).limit(50);
  const results=[] as Array<{scheduleId:number; ok:boolean; error?:string}>;
  for (const schedule of due) {
    const claim = await db.update(workflowSchedules).set({ lockedUntil: new Date(now.getTime() + 10 * 60_000) }).where(and(eq(workflowSchedules.id, schedule.id), eq(workflowSchedules.enabled, true), eq(workflowSchedules.nextRunAt, schedule.nextRunAt!), or(isNull(workflowSchedules.lockedUntil), lte(workflowSchedules.lockedUntil, now))));
    if (((claim as any).rowsAffected ?? 0) !== 1) continue;
    // Scheduled workflows are proposals only. They must never execute in the background.
    // Advance the schedule so a denied background run cannot create a retry storm.
    const nextRunAt = nextScheduledRun(schedule.cron, now, schedule.timezone);
    await db.update(workflowSchedules).set({ lastRunAt: now, nextRunAt, lockedUntil: null }).where(eq(workflowSchedules.id, schedule.id));
    const message = "Execução automática bloqueada: autorização explícita do usuário é obrigatória";
    await recordAgentEvent(db, schedule.userId, "workflow.scheduled.authorization_required", { scheduleId: schedule.id, workflowId: schedule.workflowId, message }, "warning");
    results.push({scheduleId:schedule.id,ok:false,error:message});
  }
  return results;
}
