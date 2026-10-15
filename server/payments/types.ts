import type { Request } from "express";
import type { PaymentProvider } from "../../shared/constants.js";

export interface CheckoutOrder {
  code: string;
  total: number;
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string;
  buyerDocument: string;
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
  amount: number; // COP enteros
  currency: string;
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
