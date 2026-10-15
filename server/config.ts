import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

// Carga .env si existe (Node >= 20.12). En Hostinger las variables se definen en el panel.
const envFile = resolve(process.cwd(), ".env");
if (existsSync(envFile) && typeof process.loadEnvFile === "function" && process.env.NODE_ENV !== "test") {
  process.loadEnvFile(envFile);
}

const bool = z
  .string()
  .optional()
  .transform((v) => v === "1" || v === "true");

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().default(3000),
  APP_URL: z.string().url().default("http://localhost:5173"),
  TRUST_PROXY: bool,

  DB_HOST: z.string().default("127.0.0.1"),
  DB_PORT: z.coerce.number().int().default(3306),
  DB_USER: z.string().default("root"),
  DB_PASSWORD: z.string().default(""),
  DB_NAME: z.string().default("nexistore"),

  SESSION_DAYS: z.coerce.number().int().min(1).max(90).default(30),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(465),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().optional(),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  MP_ACCESS_TOKEN: z.string().optional(),
  MP_WEBHOOK_SECRET: z.string().optional(),

  WOMPI_PUBLIC_KEY: z.string().optional(),
  WOMPI_INTEGRITY_SECRET: z.string().optional(),
  WOMPI_EVENTS_SECRET: z.string().optional(),

  MANUAL_PAYMENTS_ENABLED: bool,
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Variables de entorno inválidas:", parsed.error.issues);
  process.exit(1);
}

export const config = {
  ...parsed.data,
  isProd: parsed.data.NODE_ENV === "production",
  appUrl: parsed.data.APP_URL.replace(/\/$/, ""),
};

export type AppConfig = typeof config;
