import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execute, getPool, query } from "./db.js";

/** Separa un archivo .sql en sentencias (las migraciones no usan ';' dentro de literales). */
function splitStatements(sql: string): string[] {
  return sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function migrate(dir = resolve(process.cwd(), "db/migrations"), log = console.log): Promise<string[]> {
  await execute(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version VARCHAR(120) PRIMARY KEY,
       applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  );
  const done = new Set((await query<{ version: string }>("SELECT version FROM schema_migrations")).map((r) => r.version));
  const files = (await readdir(dir)).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(join(dir, file), "utf8");
    const conn = await getPool().getConnection();
    try {
      // DDL en MySQL hace commit implícito: se aplica sentencia a sentencia y se registra al final.
      for (const stmt of splitStatements(sql)) await conn.query(stmt);
      await conn.execute("INSERT INTO schema_migrations (version) VALUES (?)", [file]);
      applied.push(file);
      log(`✔ migración aplicada: ${file}`);
    } finally {
      conn.release();
    }
  }
  if (!applied.length) log("Base de datos al día.");
  return applied;
}
