import { createApp } from "./app.js";
import { config } from "./config.js";
import { execute } from "./db.js";
import { migrate } from "./migrate.js";
import { cleanupMedia } from "./services/media.js";
import { runAlerts } from "./services/notifications.js";
import { expireStaleOrders } from "./services/orders.js";
import { queryOne } from "./db.js";
import { hashPassword } from "./lib/security.js";
import { seedCatalog } from "./seed.js";
import { loadIntegrations } from "./services/integrations.js";
import { ensureVaultKey } from "./services/vault-key.js";
import { emailSchema, passwordSchema } from "../shared/schemas.js";

/**
 * Arranque sin terminal (útil en Hostinger):
 * - ADMIN_EMAIL + ADMIN_PASSWORD: crea el primer administrador si todavía no existe ninguno.
 * - SEED_DEMO=true: carga el catálogo de ejemplo si la base de datos está vacía.
 */
async function bootstrap() {
  const email = process.env.ADMIN_EMAIL?.trim();
  const password = process.env.ADMIN_PASSWORD;
  if (email && password) {
    const anyAdmin = await queryOne("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
    if (!anyAdmin) {
      const e = emailSchema.safeParse(email);
      const p = passwordSchema.safeParse(password);
      if (!e.success || !p.success) {
        console.error("ADMIN_EMAIL o ADMIN_PASSWORD no son válidos (la contraseña necesita 8+ caracteres con letras y números).");
      } else {
        const existing = await queryOne<{ id: number }>("SELECT id FROM users WHERE email = ?", [e.data]);
        if (existing) await execute("UPDATE users SET role = 'admin', is_active = 1, password_hash = ? WHERE id = ?", [await hashPassword(p.data), existing.id]);
        else await execute("INSERT INTO users (email, name, password_hash, role) VALUES (?, 'Administrador', ?, 'admin')", [e.data, await hashPassword(p.data)]);
        console.log(`✔ Administrador inicial listo: ${e.data}. Ya puedes quitar ADMIN_PASSWORD de las variables de entorno.`);
      }
    }
  }
  if (process.env.SEED_DEMO === "true") {
    const n = await queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM categories");
    if (Number(n?.n) === 0) {
      await seedCatalog();
      console.log("✔ Catálogo de ejemplo cargado (SEED_DEMO=true).");
    }
  }
}

async function main() {
  // Aplica migraciones pendientes al arrancar (idempotente). Útil en Hostinger, donde no hay consola fácil.
  if (process.env.AUTO_MIGRATE !== "false") await migrate();
  const vault = await ensureVaultKey();
  if (vault === "generated") console.log("✔ Llave de cifrado del inventario generada y guardada.");
  await loadIntegrations();
  await bootstrap();

  const app = createApp();
  app.listen(config.PORT, () => {
    console.log(`NexiStore escuchando en http://localhost:${config.PORT} (${config.NODE_ENV})`);
  });

  // Mantenimiento cada hora: sesiones vencidas, pedidos sin pagar > 48 h, alertas de inventario e imágenes sin usar.
  const maintenance = async () => {
    try {
      await execute("DELETE FROM sessions WHERE expires_at < UTC_TIMESTAMP()");
      await execute("DELETE FROM password_resets WHERE expires_at < (UTC_TIMESTAMP() - INTERVAL 1 DAY)");
      const n = await expireStaleOrders(48);
      if (n) console.log(`Mantenimiento: ${n} pedido(s) sin pago cancelados.`);
      // Alertas: cuentas por vencer, servicios de clientes por terminar, vencidas y poco inventario.
      const a = await runAlerts();
      if (a.expired || a.customerNotices) console.log(`Alertas: ${a.expired} cuenta(s) vencida(s), ${a.customerNotices} aviso(s) a clientes.`);
      // Imágenes subidas que ya no usa ningún producto ni fondo.
      await cleanupMedia();
    } catch (err) {
      console.error("Error en mantenimiento:", err);
    }
  };
  setInterval(maintenance, 60 * 60 * 1000).unref();
  void maintenance();
}

main().catch((err) => {
  console.error("No se pudo iniciar NexiStore:", err);
  process.exit(1);
});
