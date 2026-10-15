import { execute, queryOne } from "../db.js";
import type { CampaignSettings, StoreSettings } from "../../shared/schemas.js";

export const DEFAULT_CAMPAIGN: CampaignSettings = {
  enabled: true,
  titleLead: "Esta Navidad, más que servicios,",
  titleAccent: "regala momentos.",
  subtitle: "Streaming, software, juegos e IA con entrega inmediata y garantía de funcionamiento.",
  ctaLabel: "Ver promociones",
  ctaHref: "/promociones",
  sealTop: "HASTA",
  sealValue: "50%",
  sealBottom: "DE DESCUENTO",
  promoTitle: "Ofertas de Navidad en todas las categorías",
  promoText: "Descuentos de temporada por tiempo limitado. Usa el cupón NAVIDAD10 y ahorra un 10% adicional.",
  snow: true,
};

export const DEFAULT_STORE: StoreSettings = {
  storeName: "NexiStore",
  supportEmail: "soporte@nexistore.example",
  supportWhatsapp: "",
  manualPaymentInstructions:
    "Realiza la transferencia por el valor exacto del pedido y envía el comprobante a soporte indicando el código del pedido. Tu pedido se confirmará cuando verifiquemos el pago.",
};

export async function getSetting<T>(name: string, fallback: T): Promise<T> {
  const row = await queryOne<{ value: unknown }>("SELECT value FROM settings WHERE name = ?", [name]);
  if (!row) return fallback;
  const value = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
  return { ...fallback, ...(value as object) } as T;
}

export async function setSetting(name: string, value: unknown): Promise<void> {
  await execute("INSERT INTO settings (name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [name, JSON.stringify(value)]);
}

export interface CryptoSettings {
  /** Pesos colombianos por 1 unidad de la moneda de cotización de Zenobank (USD). null = cripto deshabilitado. */
  copPerUnit: number | null;
}
export const DEFAULT_CRYPTO: CryptoSettings = { copPerUnit: null };
