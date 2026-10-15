import { createApp } from "./app.js";
import { config } from "./config.js";
import { execute } from "./db.js";
import { migrate } from "./migrate.js";
import { expireStaleOrders } from "./services/orders.js";

async function main() {
  // Aplica migraciones pendientes al arrancar (idempotente). Útil en Hostinger, donde no hay consola fácil.
  if (process.env.AUTO_MIGRATE !== "false") await migrate();

  const app = createApp();
  app.listen(config.PORT, () => {
    console.log(`NexiStore escuchando en http://localhost:${config.PORT} (${config.NODE_ENV})`);
  });

  // Mantenimiento cada hora: sesiones vencidas y pedidos sin pagar > 48 h.
  const maintenance = async () => {
    try {
      await execute("DELETE FROM sessions WHERE expires_at < UTC_TIMESTAMP()");
      await execute("DELETE FROM password_resets WHERE expires_at < (UTC_TIMESTAMP() - INTERVAL 1 DAY)");
      const n = await expireStaleOrders(48);
      if (n) console.log(`Mantenimiento: ${n} pedido(s) sin pago cancelados.`);
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
