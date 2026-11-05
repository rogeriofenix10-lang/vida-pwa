import { describe, expect, it } from "vitest";
import { canVoiceInitiateSensitiveAction, classifyVoiceIdentity } from "./voice-identity";

describe("IRIS voice identity", () => {
  it("fails closed when no biometric provider is configured", () => {
    const result = classifyVoiceIdentity({});
    expect(result.level).toBe("unknown");
    expect(canVoiceInitiateSensitiveAction(result.level, true)).toBe(false);
  });
  it("requires a strong primary match and trusted device for sensitive voice actions", () => {
    expect(classifyVoiceIdentity({ configuredProvider: "example", isKnownUser: true, confidence: 0.95 }).level).toBe("primary");
    expect(canVoiceInitiateSensitiveAction("primary", true)).toBe(true);
    expect(canVoiceInitiateSensitiveAction("primary", false)).toBe(false);
    expect(canVoiceInitiateSensitiveAction("known", true)).toBe(false);
  });
});
