import type { Request } from "express";
import type { PaymentProvider } from "../../shared/constants.js";

export interface CheckoutOrder {
  code: string;
  total: number;
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string;
  buyerDocument: string;
  /** Cotización en moneda extranjera ya guardada en el pedido/recarga (cripto). */
  foreign?: { currency: string; amount: string } | null;
  description?: string;
}

export type CheckoutAction =
  | { type: "redirect"; url: string }
  | { type: "instructions"; text: string };

/** Resultado de un pago ya verificado con el proveedor (firma o consulta directa a su API). */
export interface VerifiedPayment {
  provider: PaymentProvider;
  externalId: string;
  orderCode: string;
  status: "approved" | "pending" | "rejected";
  amount: number; // COP enteros (si currency = COP)
  currency: string;
  /** Monto en moneda extranjera tal como lo reporta el proveedor (ej. USDT). */
  foreignAmount?: string;
  raw: unknown;
}

export interface PaymentAdapter {
  id: PaymentProvider;
  label: string;
  description: string;
  isConfigured(): boolean;
  pendingReason: string;
  createCheckout(order: CheckoutOrder): Promise<CheckoutAction>;
  /** Devuelve null si el evento no aplica; lanza si la firma es inválida. */
  handleWebhook?(req: Request): Promise<VerifiedPayment | null>;
  /** Consulta activa del estado (al volver del checkout). */
  verify?(orderCode: string, query: Record<string, string>): Promise<VerifiedPayment | null>;
}

export class SignatureError extends Error {}

/** URL a la que vuelve el cliente desde la pasarela (pedido o recarga de billetera). */
export function returnUrl(appUrl: string, code: string, provider: string) {
  return code.startsWith("WT-") ? `${appUrl}/cuenta/billetera?recarga=${code}&provider=${provider}` : `${appUrl}/pedido/${code}/confirmacion?provider=${provider}`;
}
