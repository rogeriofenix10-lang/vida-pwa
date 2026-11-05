import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { ENV } from "./_core/env";

function key() {
  const configured = ENV.encryptionKey.trim();
  if (configured) {
    if (!/^[0-9a-fA-F]{64}$/.test(configured)) throw new Error("IRIS_ENCRYPTION_KEY deve conter 64 caracteres hexadecimais");
    return Buffer.from(configured, "hex");
  }
  // Backward-compatible fallback for existing 1.0.1 data. Configure
  // IRIS_ENCRYPTION_KEY in production and rotate stored secrets thereafter.
  const legacy = process.env.JWT_SECRET;
  if (!legacy) throw new Error("IRIS_ENCRYPTION_KEY ausente");
  console.warn("[Security] IRIS_ENCRYPTION_KEY não configurada; usando chave legada derivada de JWT_SECRET");
  return createHash("sha256").update(legacy).digest();
}

export function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptSecret(payload: string) {
  const [ivEncoded, tagEncoded, encryptedEncoded] = payload.split(".");
  if (!ivEncoded || !tagEncoded || !encryptedEncoded) throw new Error("Segredo cifrado inválido");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivEncoded, "base64url"));
  decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedEncoded, "base64url")), decipher.final()]).toString("utf8");
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
