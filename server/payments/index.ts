import { config } from "../config.js";
import { DEFAULT_CRYPTO, DEFAULT_STORE, getSetting } from "../services/settings.js";
import { binance } from "./binance.js";
import { mercadoPago } from "./mercadopago.js";
import type { PaymentAdapter } from "./types.js";
import { wompi } from "./wompi.js";
import type { PaymentProvider } from "../../shared/constants.js";
import type { PaymentMethodInfo } from "../../shared/types.js";

/**
 * Transferencia con verificación manual: el pedido queda "Pendiente de pago" hasta que un
 * administrador confirme haber recibido el dinero. Nunca se marca como pagado automáticamente.
 */
const manual: PaymentAdapter = {
  id: "manual",
  label: "Transferencia (Nequi, Daviplata, Bancolombia)",
  description: "Transfiere y envía el comprobante. Confirmamos tu pago manualmente.",
  pendingReason: "Desactivado: define MANUAL_PAYMENTS_ENABLED=true para habilitarlo.",
  isConfigured: () => Boolean(config.MANUAL_PAYMENTS_ENABLED),
  async createCheckout() {
    const store = await getSetting("store", DEFAULT_STORE);
    return { type: "instructions", text: store.manualPaymentInstructions };
  },
};

/** Saldo interno: se descuenta en la misma transacción que crea el pedido. */
const wallet: PaymentAdapter = {
  id: "wallet",
  label: "Billetera NexiStore",
  description: "Paga al instante con el saldo de tu billetera.",
  pendingReason: "",
  isConfigured: () => true,
  async createCheckout() {
    return { type: "instructions", text: "Pagado con saldo de la billetera." };
  },
};

export const adapters: Record<PaymentProvider, PaymentAdapter> = {
  wompi,
  mercadopago: mercadoPago,
  binance,
  manual,
  wallet,
};

/** Tasa COP por USDT configurada por el administrador (null si falta). */
export async function cryptoRate(): Promise<number | null> {
  const c = await getSetting("crypto", DEFAULT_CRYPTO);
  return c.copPerUsdt && c.copPerUsdt > 0 ? c.copPerUsdt : null;
}

/** USDT a cobrar: redondeado hacia arriba a 2 decimales para no cobrar de menos. */
export const toUsdt = (cop: number, rate: number) => (Math.ceil((cop / rate) * 100) / 100).toFixed(2);

export async function isProviderReady(id: PaymentProvider): Promise<{ ok: boolean; reason?: string }> {
  const a = adapters[id];
  if (!a.isConfigured()) return { ok: false, reason: a.pendingReason };
  if (id === "binance" && !(await cryptoRate())) return { ok: false, reason: "Pendiente de configuración: define la tasa COP/USDT en Configuración." };
  return { ok: true };
}

export async function paymentMethods(): Promise<PaymentMethodInfo[]> {
  const rate = await cryptoRate();
  return Promise.all(
    Object.values(adapters).map(async (a) => {
      const ready = await isProviderReady(a.id);
      return {
        id: a.id,
        label: a.label,
        description: a.description,
        configured: ready.ok,
        pendingReason: ready.ok ? undefined : ready.reason,
        ...(a.id === "binance" ? { currency: "USDT", rate } : {}),
      };
    }),
  );
}

/** Integraciones que no existen todavía: se muestran como pendientes, nunca como disponibles. */
export const UNAVAILABLE_METHODS = [
  { id: "paypal", label: "PayPal", reason: "No integrado: PayPal no procesa pagos en COP; requiere conversión de moneda y credenciales." },
];
