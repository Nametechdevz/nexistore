import { config } from "../config.js";
import { getSetting, DEFAULT_STORE } from "../services/settings.js";
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

export const adapters: Record<PaymentProvider, PaymentAdapter> = {
  mercadopago: mercadoPago,
  wompi,
  manual,
};

export function paymentMethods(): PaymentMethodInfo[] {
  return Object.values(adapters).map((a) => ({
    id: a.id,
    label: a.label,
    description: a.description,
    configured: a.isConfigured(),
    pendingReason: a.isConfigured() ? undefined : a.pendingReason,
  }));
}

/** Integraciones que no existen todavía: se muestran como pendientes, nunca como disponibles. */
export const UNAVAILABLE_METHODS = [
  { id: "paypal", label: "PayPal", reason: "No integrado: PayPal no procesa pagos en COP; requiere conversión de moneda y credenciales." },
  { id: "binance", label: "Binance Pay", reason: "No integrado: requiere cuenta de comerciante y credenciales de Binance Pay." },
];
