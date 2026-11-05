import { describe, expect, it, beforeEach } from "vitest";
import { getLocalLabStatus, resetLocalLab, runLocalLab } from "./local-lab";

beforeEach(() => {
  process.env.NODE_ENV = "test";
  delete process.env.IRIS_LOCAL_LAB;
  resetLocalLab();
});

describe("IRIS Local Lab", () => {
  it("runs Gmail read without external calls", async () => {
    const result = await runLocalLab({ provider: "google:gmail", action: "messages.list" });
    expect(result.simulated).toBe(true);
    expect((result.data as any).messages.length).toBeGreaterThan(0);
  });

  it("requires confirmation for simulated Gmail send", async () => {
    await expect(runLocalLab({
      provider: "google:gmail", action: "messages.send",
      input: { to: "teste@exemplo.com", subject: "Teste", body: "Mensagem" },
    })).rejects.toThrow("CONFIRMATION_REQUIRED");

    const result = await runLocalLab({
      provider: "google:gmail", action: "messages.send", confirmed: true,
      input: { to: "teste@exemplo.com", subject: "Teste", body: "Mensagem" },
    });
    expect(result.ok).toBe(true);
    expect(getLocalLabStatus().counts.sentMessages).toBe(1);
  });

  it("creates a simulated calendar event only after confirmation", async () => {
    await expect(runLocalLab({
      provider: "google:calendar", action: "events.create",
      input: { summary: "Teste", start: "2030-01-15T11:00:00-03:00", end: "2030-01-15T12:00:00-03:00" },
    })).rejects.toThrow("CONFIRMATION_REQUIRED");

    await runLocalLab({
      provider: "google:calendar", action: "events.create", confirmed: true,
      input: { summary: "Teste", start: "2030-01-15T11:00:00-03:00", end: "2030-01-15T12:00:00-03:00" },
    });
    const listed = await runLocalLab({ provider: "google:calendar", action: "events.list" });
    expect((listed.data as any).items.some((item: any) => item.summary === "Teste")).toBe(true);
  });

  it("supports Drive search and resets deterministically", async () => {
    await runLocalLab({ provider: "google:gmail", action: "messages.send", confirmed: true, input: { to: "a@b.com", subject: "x", body: "y" } });
    expect(getLocalLabStatus().runs).toBe(1);
    resetLocalLab();
    expect(getLocalLabStatus().runs).toBe(0);
    const result = await runLocalLab({ provider: "google:drive", action: "files.search", input: { query: "clientes" } });
    expect((result.data as any).files[0].name).toContain("Clientes");
  });
});
