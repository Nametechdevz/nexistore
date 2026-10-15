/**
 * Carga datos de ejemplo. Solo se ejecuta si no hay categorías (no sobrescribe un catálogo real).
 * Uso: npm run db:seed
 */
import { closePool, queryOne } from "../db.js";
import { migrate } from "../migrate.js";
import { seedCatalog } from "../seed.js";
import { ensureVaultKey } from "../services/vault-key.js";

async function main() {
  await migrate();
  await ensureVaultKey();
  const existing = await queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM categories");
  if (Number(existing?.n) > 0) {
    console.log("Ya hay categorías en la base de datos: no se cargan datos de ejemplo.");
    return;
  }
  await seedCatalog();
  console.log("✔ Datos de ejemplo cargados.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
