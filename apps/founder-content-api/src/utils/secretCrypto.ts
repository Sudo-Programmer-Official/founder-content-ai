import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const IV_LENGTH_BYTES = 12;

function resolveSecret(name: string): string {
  const configured = process.env[name]?.trim();

  if (configured) {
    return configured;
  }

  if (process.env.NODE_ENV !== "production") {
    return `${name.toLowerCase()}-development-secret`;
  }

  throw new Error(`${name} is not configured.`);
}

function deriveKey(name: string): Buffer {
  return createHash("sha256").update(resolveSecret(name)).digest();
}

export function encryptSecret(plainText: string, secretName: string): string {
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secretName), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString("base64url"),
    encrypted.toString("base64url"),
    authTag.toString("base64url"),
  ].join(".");
}

export function decryptSecret(cipherText: string, secretName: string): string {
  const [ivPart, encryptedPart, authTagPart] = cipherText.split(".", 3);

  if (!ivPart || !encryptedPart || !authTagPart) {
    throw new Error("Encrypted secret has invalid format.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveKey(secretName),
    Buffer.from(ivPart, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(authTagPart, "base64url"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, "base64url")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}
