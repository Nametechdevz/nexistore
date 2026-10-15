import { closePool } from "../db.js";
import { migrate } from "../migrate.js";

migrate()
  .then(() => closePool())
  .catch(async (err) => {
    console.error("Error en migración:", err);
    await closePool();
    process.exit(1);
  });
