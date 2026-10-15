/**
 * Crea o promueve un administrador.
 * Uso: npm run admin:create -- correo@dominio.com "Nombre" 'ContraseñaSegura1'
 * Sin contraseña, solo promueve una cuenta existente.
 */
import { closePool, execute, queryOne } from "../db.js";
import { hashPassword } from "../lib/security.js";
import { emailSchema, passwordSchema } from "../../shared/schemas.js";

async function main() {
  const [rawEmail, name = "Administrador", password] = process.argv.slice(2);
  const email = emailSchema.parse(rawEmail);
  const existing = await queryOne<{ id: number }>("SELECT id FROM users WHERE email = ?", [email]);
  if (existing) {
    await execute("UPDATE users SET role = 'admin', is_active = 1 WHERE id = ?", [existing.id]);
    if (password) await execute("UPDATE users SET password_hash = ? WHERE id = ?", [await hashPassword(passwordSchema.parse(password)), existing.id]);
    console.log(`✔ ${email} ahora es administrador.`);
  } else {
    if (!password) throw new Error("La cuenta no existe: indica también una contraseña.");
    await execute("INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, 'admin')", [email, name, await hashPassword(passwordSchema.parse(password))]);
    console.log(`✔ Administrador creado: ${email}`);
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
