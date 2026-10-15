import { integ } from "../services/integrations.js";
import { DEFAULT_CRYPTO, DEFAULT_STORE, getSetting } from "../services/settings.js";
import { ZENO_CURRENCY, zenobank } from "./zenobank.js";
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
  pendingReason: "Desactivado: actívalo en Admin → Configuración → Pagos.",
  isConfigured: () => integ().manualEnabled,
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
  zenobank,
  manual,
  wallet,
};

/** Tasa COP por unidad de la moneda de cotización cripto (null si falta o si se cotiza en COP). */
export async function cryptoRate(): Promise<number | null> {
  const c = await getSetting("crypto", DEFAULT_CRYPTO);
  return c.copPerUnit && c.copPerUnit > 0 ? c.copPerUnit : null;
}

/** Monto a cobrar en moneda extranjera: redondeado hacia arriba a 2 decimales para no cobrar de menos. */
export const toForeign = (cop: number, rate: number) => (Math.ceil((cop / rate) * 100) / 100).toFixed(2);

/** Cotización que se guarda en el pedido o recarga (null si no aplica). */
export async function foreignQuoteFor(provider: PaymentProvider): Promise<((totalCop: number) => { currency: string; amount: string }) | undefined> {
  if (provider !== "zenobank" || ZENO_CURRENCY() === "COP") return undefined;
  const rate = await cryptoRate();
  if (!rate) return undefined;
  return (total) => ({ currency: ZENO_CURRENCY(), amount: toForeign(total, rate) });
}

export async function isProviderReady(id: PaymentProvider): Promise<{ ok: boolean; reason?: string }> {
  const a = adapters[id];
  if (!a.isConfigured()) return { ok: false, reason: a.pendingReason };
  if (id === "zenobank" && ZENO_CURRENCY() !== "COP" && !(await cryptoRate())) {
    return { ok: false, reason: `Pendiente de configuración: define la tasa COP/${ZENO_CURRENCY()} en Configuración.` };
  }
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
        ...(a.id === "zenobank" ? { currency: ZENO_CURRENCY(), rate: ZENO_CURRENCY() === "COP" ? null : rate } : {}),
      };
    }),
  );
}

/** Integraciones que no existen todavía: se muestran como pendientes, nunca como disponibles. */
export const UNAVAILABLE_METHODS = [
  { id: "paypal", label: "PayPal", reason: "No integrado: PayPal no procesa pagos en COP; requiere conversión de moneda y credenciales." },
];
