/**
 * Cifrado en reposo de credenciales (AES-256-GCM).
 * La llave viene de la variable INVENTORY_ENCRYPTION_KEY si existe; si no, se genera sola al primer
 * arranque y se guarda en la base de datos (ver services/vault-key.ts), para que la instalación no
 * pida nada más que la base de datos y el administrador.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { HttpError } from "./http.js";

const PREFIX = "enc:v1:";
let cachedKey: Buffer | null | undefined;

export function parseKey(raw: string): Buffer {
  const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("La llave de cifrado debe tener 32 bytes (64 hex o 44 base64).");
  return buf;
}

/** Fija la llave cargada desde la base de datos (solo si no hay variable de entorno). */
export function setVaultKey(raw: string) {
  cachedKey = parseKey(raw.trim());
}

function loadKey(): Buffer | null {
  const env = process.env.INVENTORY_ENCRYPTION_KEY?.trim();
  if (env) return parseKey(env);
  return cachedKey ?? null;
}

export const vaultConfigured = () => loadKey() !== null;

export function requireVault() {
  if (!vaultConfigured()) {
    throw new HttpError(503, "La llave de cifrado del inventario aún no está lista. Reinicia la aplicación.");
  }
}

export function seal(plain: string): string {
  const key = loadKey();
  if (!key) throw new HttpError(503, "La llave de cifrado del inventario aún no está lista. Reinicia la aplicación.");
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
  if (!key) return "[contenido cifrado: falta la llave de cifrado]";
  const buf = Buffer.from(value.slice(PREFIX.length), "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}

/** Cifra si hay llave; si no, guarda en claro (contenido manual heredado). */
export const sealIfPossible = (plain: string | null) => (plain && vaultConfigured() ? seal(plain) : plain);
