import request from "supertest";
import { createApp } from "../server/app.js";
import { closePool, execute, query } from "../server/db.js";
import { hashPassword } from "../server/lib/security.js";
import { migrate } from "../server/migrate.js";
import { seedCatalog } from "../server/seed.js";

export const app = createApp();

export async function resetDb() {
  await execute("SET FOREIGN_KEY_CHECKS = 0");
  const tables = await query<{ t: string }>(
    "SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE()",
  );
  for (const { t } of tables) await execute(`DROP TABLE IF EXISTS \`${t}\``);
  await execute("SET FOREIGN_KEY_CHECKS = 1");
  await migrate(undefined, () => undefined);
  await seedCatalog();
}

export { closePool };

/** Cliente con cookies persistentes y token CSRF. */
export async function client() {
  const agent = request.agent(app);
  const me = await agent.get("/api/auth/me");
  const csrf = me.body.csrfToken as string;
  const wrap = (method: "post" | "put" | "patch" | "delete") => (url: string) =>
    agent[method](url).set("x-csrf-token", csrf);
  return { agent, csrf, get: (url: string) => agent.get(url), post: wrap("post"), put: wrap("put"), patch: wrap("patch"), del: wrap("delete") };
}

export async function registered(email = `u${Date.now()}${Math.floor(Math.random() * 1e6)}@test.co`, name = "Cliente Prueba") {
  const c = await client();
  const res = await c.post("/api/auth/register").send({ name, email, password: "Segura123", confirmPassword: "Segura123", acceptTerms: true });
  if (res.status !== 201) throw new Error(`registro falló: ${JSON.stringify(res.body)}`);
  // Tras iniciar sesión se rota el token CSRF.
  return relogin(c.agent, email);
}

async function relogin(agent: request.Agent, email: string) {
  const me = await agent.get("/api/auth/me");
  const csrf = me.body.csrfToken as string;
  const wrap = (method: "post" | "put" | "patch" | "delete") => (url: string) => agent[method](url).set("x-csrf-token", csrf);
  return { agent, csrf, email, user: me.body.user, get: (url: string) => agent.get(url), post: wrap("post"), put: wrap("put"), patch: wrap("patch"), del: wrap("delete") };
}

export async function adminClient() {
  const email = `admin${Date.now()}@test.co`;
  await execute("INSERT INTO users (email, name, password_hash, role) VALUES (?, 'Admin', ?, 'admin')", [email, await hashPassword("Admin12345")]);
  const c = await client();
  const res = await c.post("/api/auth/login").send({ email, password: "Admin12345" });
  if (res.status !== 200) throw new Error("login admin falló");
  return relogin(c.agent, email);
}

export const checkoutBody = (provider = "manual", extra: Record<string, unknown> = {}) => ({
  buyerName: "Cliente Prueba",
  buyerEmail: "cliente@test.co",
  buyerPhone: "3001234567",
  paymentProvider: provider,
  acceptTerms: true,
  ...extra,
});
