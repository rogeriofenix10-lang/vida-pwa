export type VoiceIdentityLevel = "primary" | "known" | "unknown";

export type VoiceIdentityResult = {
  level: VoiceIdentityLevel;
  confidence: number;
  provider: string | null;
  reason: string;
};

/**
 * Voice identity is deliberately provider-backed. The IRIS client may detect the wake word,
 * but it must never claim a biometric identity on its own. Until a certified voice-biometric
 * provider is configured, sensitive actions remain protected by the normal authenticated
 * session and confirmation policy.
 */
export function classifyVoiceIdentity(input: {
  configuredProvider?: string | null;
  confidence?: number;
  isKnownUser?: boolean;
}): VoiceIdentityResult {
  if (!input.configuredProvider) {
    return { level: "unknown", confidence: 0, provider: null, reason: "voice-biometric-provider-not-configured" };
  }
  const confidence = Math.max(0, Math.min(1, input.confidence ?? 0));
  if (input.isKnownUser && confidence >= 0.90) {
    return { level: "primary", confidence, provider: input.configuredProvider, reason: "primary-voice-match" };
  }
  if (input.isKnownUser && confidence >= 0.70) {
    return { level: "known", confidence, provider: input.configuredProvider, reason: "known-voice-match" };
  }
  return { level: "unknown", confidence, provider: input.configuredProvider, reason: "voice-match-not-sufficient" };
}

export function canVoiceInitiateSensitiveAction(level: VoiceIdentityLevel, trustedDevice: boolean): boolean {
  return level === "primary" && trustedDevice;
}
