import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { appRoot } from "./lib/paths.js";
import { z } from "zod";

// Carga .env si existe (Node >= 20.12). En Hostinger las variables se definen en el panel.
const envFile = resolve(appRoot(), ".env");
if (existsSync(envFile) && typeof process.loadEnvFile === "function" && process.env.NODE_ENV !== "test") {
  process.loadEnvFile(envFile);
}

const bool = z
  .string()
  .optional()
  .transform((v) => v === "1" || v === "true");

const schema = z.object({
  // Compilado (dist/) = producción por defecto: en el hosting no hace falta definirlo.
  NODE_ENV: z.enum(["development", "production", "test"]).default(/[\\/]dist[\\/]/.test(process.argv[1] ?? "") ? "production" : "development"),
  PORT: z.coerce.number().int().default(3000),
  /** Interfaz de escucha. En un VPS detrás de Nginx: 127.0.0.1 (solo accesible desde el propio servidor). */
  HOST: z.string().optional(),
  /** Opcional: la URL pública también se configura en el panel o se detecta sola. */
  APP_URL: z.string().url().optional(),
  /** Por defecto true en producción (Hostinger y la mayoría de hostings usan proxy). */
  TRUST_PROXY: z.enum(["true", "false", "1", "0"]).optional(),

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

  ZENOBANK_API_KEY: z.string().optional(),
  ZENOBANK_WEBHOOK_SECRET: z.string().optional(),
  /** Moneda en que se cotiza en Zenobank (USD por defecto; COP si tu cuenta la admite). */
  ZENOBANK_PRICE_CURRENCY: z.string().regex(/^[A-Za-z]{3,5}$/).optional(),
  ZENOBANK_API_URL: z.string().url().optional(),

  /** 32 bytes (64 hex o base64) para cifrar las credenciales del inventario. */
  INVENTORY_ENCRYPTION_KEY: z.string().optional(),

  MANUAL_PAYMENTS_ENABLED: bool,
});

// Las variables vacías (por ejemplo, filas sin valor en el panel del hosting) se ignoran,
// como si no existieran, para que apliquen los valores por defecto.
const env = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v.trim() !== ""));
const parsed = schema.safeParse(env);
if (!parsed.success) {
  console.error("Variables de entorno inválidas:", parsed.error.issues);
  process.exit(1);
}

export const config = {
  ...parsed.data,
  isProd: parsed.data.NODE_ENV === "production",
  trustProxy: parsed.data.TRUST_PROXY ? ["true", "1"].includes(parsed.data.TRUST_PROXY) : parsed.data.NODE_ENV === "production",
};

export type AppConfig = typeof config;
