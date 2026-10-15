/**
 * Cifrado en reposo de credenciales (AES-256-GCM).
 * La llave vive solo en la variable de entorno INVENTORY_ENCRYPTION_KEY (32 bytes en base64 o hex).
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { HttpError } from "./http.js";

const PREFIX = "enc:v1:";
let cachedKey: Buffer | null | undefined;

function loadKey(): Buffer | null {
  if (cachedKey !== undefined) return cachedKey;
  const raw = process.env.INVENTORY_ENCRYPTION_KEY?.trim();
  if (!raw) return (cachedKey = null);
  const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("INVENTORY_ENCRYPTION_KEY debe tener 32 bytes (64 hex o 44 base64).");
  return (cachedKey = buf);
}

export const vaultConfigured = () => loadKey() !== null;

export function requireVault() {
  if (!vaultConfigured()) {
    throw new HttpError(503, "Inventario pendiente de configuración: define INVENTORY_ENCRYPTION_KEY en el servidor para guardar credenciales cifradas.");
  }
}

export function seal(plain: string): string {
  const key = loadKey();
  if (!key) throw new HttpError(503, "Falta INVENTORY_ENCRYPTION_KEY para cifrar credenciales.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

/** Descifra; los textos antiguos sin prefijo se devuelven tal cual. */
export function open(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (!value.startsWith(PREFIX)) return value;
  const key = loadKey();
  if (!key) return "[contenido cifrado: falta INVENTORY_ENCRYPTION_KEY]";
  const buf = Buffer.from(value.slice(PREFIX.length), "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}

/** Cifra si hay llave; si no, guarda en claro (contenido manual heredado). */
export const sealIfPossible = (plain: string | null) => (plain && vaultConfigured() ? seal(plain) : plain);
