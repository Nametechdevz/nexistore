import { randomBytes } from "node:crypto";
import { setVaultKey } from "../lib/vault.js";
import { getSetting, setSetting } from "./settings.js";

/**
 * Prepara la llave de cifrado del inventario. Si no hay INVENTORY_ENCRYPTION_KEY, se usa la
 * guardada en la base de datos o se genera una nueva la primera vez (no hay que configurar nada).
 */
export async function ensureVaultKey(): Promise<"env" | "db" | "generated"> {
  if (process.env.INVENTORY_ENCRYPTION_KEY?.trim()) return "env";
  const stored = await getSetting<{ key: string | null }>("vault", { key: null });
  if (stored.key) {
    setVaultKey(stored.key);
    return "db";
  }
  const key = randomBytes(32).toString("hex");
  await setSetting("vault", { key });
  setVaultKey(key);
  return "generated";
}
