import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Raíz de la aplicación (carpeta con package.json), sin depender del directorio de trabajo.
 * Funciona igual en desarrollo (server/*.ts) y compilado (dist/node/server/*.js), y en hostings
 * que arrancan el proceso desde otra carpeta.
 */
let cached: string | null = null;
export function appRoot(): string {
  if (cached) return cached;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "package.json"))) return (cached = dir);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return (cached = process.cwd());
}
