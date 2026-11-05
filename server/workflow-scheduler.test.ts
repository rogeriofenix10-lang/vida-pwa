import { describe, expect, it } from "vitest";
import { nextScheduledRun } from "./workflow-scheduler";

describe("workflow scheduler", () => {
  it("respeita o fuso horário configurado", () => {
    const from = new Date("2026-09-06T20:00:00.000Z");
    const next = nextScheduledRun("0 9 * * *", from, "America/Sao_Paulo");
    expect(next.toISOString()).toBe("2026-09-07T12:00:00.000Z");
  });

  it("aceita intervalos e passos de cron", () => {
    const from = new Date("2026-09-06T11:00:00.000Z");
    const next = nextScheduledRun("*/15 * * * *", from, "UTC");
    expect(next.toISOString()).toBe("2026-09-06T11:15:00.000Z");
  });
});

