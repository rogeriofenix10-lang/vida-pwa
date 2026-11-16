import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ remote: false, unlocked: false }));
const mocks = vi.hoisted(() => ({
  restore: vi.fn(),
  unlock: vi.fn(),
  remembered: vi.fn(async () => false),
}));
vi.mock("@/lib/irisWorker", () => ({
  isIrisRemoteModeEnabled: () => state.remote,
  isIrisAccessUnlocked: () => state.unlocked,
  isIrisDeviceRemembered: mocks.remembered,
  restoreIrisAccess: mocks.restore,
  unlockIrisAccess: mocks.unlock,
}));
vi.mock("wouter", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode; className?: string; style?: React.CSSProperties }) =>
    <a href={href} {...props}>{children}</a>,
}));

import RemoteServiceAccess from "./RemoteServiceAccess";

describe("RemoteServiceAccess", () => {
  beforeEach(() => {
    state.remote = false;
    state.unlocked = false;
    mocks.restore.mockClear();
    mocks.unlock.mockClear();
    mocks.remembered.mockClear();
  });

  it("offers the existing Settings opt-in without enabling mode or submitting credentials", () => {
    const html = renderToStaticMarkup(<RemoteServiceAccess compact />);

    expect(html).toContain("Demonstração local");
    expect(html).toContain("/configuracoes");
    expect(html).toContain("nenhum texto foi enviado");
    expect(html).not.toContain('type="password"');
    expect(mocks.restore).not.toHaveBeenCalled();
    expect(mocks.unlock).not.toHaveBeenCalled();
  });

  it("uses a masked master-password input and an explicit remember-device choice only after opt-in", () => {
    state.remote = true;
    const html = renderToStaticMarkup(<RemoteServiceAccess />);

    expect(html).toContain('type="password"');
    expect(html).toContain("Lembrar este dispositivo");
    expect(html).toContain("Desbloquear serviços");
    expect(html).toContain("não é o PIN local");
    expect(html).not.toContain("google.com");
    expect(mocks.restore).not.toHaveBeenCalled();
    expect(mocks.unlock).not.toHaveBeenCalled();
  });
});
