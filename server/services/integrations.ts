/**
 * Integraciones configurables desde el panel (SMTP, pasarelas de pago, Google, URL pública).
 * Se guardan en la tabla settings y se mantienen en memoria. Las variables de entorno siguen
 * funcionando como valores por defecto (útil en desarrollo), pero lo guardado en el panel manda.
 */
import { config } from "../config.js";
import { getSetting, setSetting } from "./settings.js";

export interface Integrations {
  siteUrl: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword: string;
  smtpFrom: string;
  wompiPublicKey: string;
  wompiIntegritySecret: string;
  wompiEventsSecret: string;
  mpAccessToken: string;
  mpWebhookSecret: string;
  zenoApiKey: string;
  zenoWebhookSecret: string;
  zenoCurrency: string;
  manualEnabled: boolean;
  googleClientId: string;
  googleClientSecret: string;
}

/** Campos secretos: nunca se devuelven completos al navegador. */
export const SECRET_FIELDS = [
  "smtpPassword",
  "wompiIntegritySecret",
  "wompiEventsSecret",
  "mpAccessToken",
  "mpWebhookSecret",
  "zenoApiKey",
  "zenoWebhookSecret",
  "googleClientSecret",
] as const satisfies readonly (keyof Integrations)[];

function fromEnv(): Integrations {
  return {
    siteUrl: process.env.APP_URL?.trim().replace(/\/$/, "") ?? "",
    smtpHost: config.SMTP_HOST ?? "",
    smtpPort: config.SMTP_PORT ?? 465,
    smtpUser: config.SMTP_USER ?? "",
    smtpPassword: config.SMTP_PASSWORD ?? "",
    smtpFrom: config.SMTP_FROM ?? "",
    wompiPublicKey: config.WOMPI_PUBLIC_KEY ?? "",
    wompiIntegritySecret: config.WOMPI_INTEGRITY_SECRET ?? "",
    wompiEventsSecret: config.WOMPI_EVENTS_SECRET ?? "",
    mpAccessToken: config.MP_ACCESS_TOKEN ?? "",
    mpWebhookSecret: config.MP_WEBHOOK_SECRET ?? "",
    zenoApiKey: config.ZENOBANK_API_KEY ?? "",
    zenoWebhookSecret: config.ZENOBANK_WEBHOOK_SECRET ?? "",
    zenoCurrency: (config.ZENOBANK_PRICE_CURRENCY ?? "USD").toUpperCase(),
    manualEnabled: Boolean(config.MANUAL_PAYMENTS_ENABLED),
    googleClientId: config.GOOGLE_CLIENT_ID ?? "",
    googleClientSecret: config.GOOGLE_CLIENT_SECRET ?? "",
  };
}

let cache: Integrations = fromEnv();
/** Configuración vigente (síncrona, desde memoria). */
export const integ = (): Integrations => cache;

/** Lo guardado en el panel: solo los campos que el admin definió. */
type Stored = Partial<Integrations>;

export async function loadIntegrations(): Promise<Integrations> {
  const stored = await getSetting<Stored>("integrations", {});
  const env = fromEnv();
  const merged = { ...env };
  for (const [k, v] of Object.entries(stored) as [keyof Integrations, unknown][]) {
    if (v === undefined || v === null) continue;
    (merged as Record<string, unknown>)[k] = v;
  }
  cache = merged;
  return cache;
}

/**
 * Guarda cambios. Para campos secretos: undefined = conservar el valor actual, "" = borrar.
 */
export async function saveIntegrations(patch: Partial<Integrations>): Promise<Integrations> {
  const stored = await getSetting<Stored>("integrations", {});
  const next: Stored = { ...stored };
  for (const [k, v] of Object.entries(patch) as [keyof Integrations, unknown][]) {
    if (v === undefined) continue;
    (next as Record<string, unknown>)[k] = typeof v === "string" ? v.trim() : v;
  }
  await setSetting("integrations", next);
  return loadIntegrations();
}

/* ---------------- URL pública ---------------- */

let detectedOrigin: string | null = null;
/** Se recuerda el origen de las visitas para no exigir configurar la URL al instalar. */
export function rememberOrigin(origin: string) {
  if (!detectedOrigin || detectedOrigin.startsWith("http://") && origin.startsWith("https://")) detectedOrigin = origin;
}

/** URL pública de la tienda: la del panel, o la detectada en las visitas. */
export function publicUrl(): string {
  return (cache.siteUrl || detectedOrigin || `http://localhost:${config.PORT}`).replace(/\/$/, "");
}
export const detectedUrl = () => detectedOrigin;

/* ---------------- Vista para el panel ---------------- */

const mask = (v: string) => (v ? `••••${v.slice(-4)}` : "");

export function publicView() {
  const c = cache;
  const view: Record<string, unknown> = { ...c };
  for (const k of SECRET_FIELDS) {
    view[k] = "";
    view[`${k}Set`] = Boolean(c[k]);
    view[`${k}Hint`] = mask(c[k]);
  }
  return view;
}
