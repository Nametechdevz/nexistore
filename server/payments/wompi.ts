/**
 * Wompi (Bancolombia) — Web Checkout. Permite Nequi, Botón Bancolombia, PSE y tarjetas.
 * Docs: https://docs.wompi.co/docs/colombia/widget-checkout-web/ y /eventos/
 * - Firma de integridad: SHA256(referencia + montoEnCentavos + moneda + secretoIntegridad)
 * - Eventos: checksum = SHA256(valores de signature.properties + timestamp + secretoEventos)
 */
import type { Request } from "express";
import { createHash } from "node:crypto";
import { config } from "../config.js";
import { randomToken, safeEqual } from "../lib/security.js";
import { returnUrl, SignatureError, type CheckoutOrder, type PaymentAdapter, type VerifiedPayment } from "./types.js";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const apiBase = () =>
  config.WOMPI_PUBLIC_KEY?.startsWith("pub_prod_") ? "https://production.wompi.co/v1" : "https://sandbox.wompi.co/v1";

export function wompiIntegritySignature(reference: string, amountInCents: number, currency: string, secret: string) {
  return sha(`${reference}${amountInCents}${currency}${secret}`);
}

/** Lee una propiedad anidada tipo "transaction.amount_in_cents" dentro de event.data. */
function pick(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), obj);
}

export function verifyWompiEvent(event: unknown, secret: string): boolean {
  const e = event as { data?: unknown; signature?: { properties?: string[]; checksum?: string }; timestamp?: number };
  if (!e?.signature?.properties || !e.signature.checksum || e.timestamp === undefined) return false;
  const concat = e.signature.properties.map((p) => String(pick(e.data, p) ?? "")).join("") + String(e.timestamp) + secret;
  return safeEqual(sha(concat).toLowerCase(), e.signature.checksum.toLowerCase());
}

/** Referencia única por intento: CODIGO_xxxx (Wompi exige referencias únicas). */
const toReference = (code: string) => `${code}_${randomToken(3)}`;
export const referenceToOrderCode = (reference: string) => reference.split("_")[0] ?? "";

interface WompiTx {
  id: string;
  status: string;
  reference: string;
  amount_in_cents: number;
  currency: string;
}

function toVerified(tx: WompiTx): VerifiedPayment {
  return {
    provider: "wompi",
    externalId: tx.id,
    orderCode: referenceToOrderCode(tx.reference),
    status: tx.status === "APPROVED" ? "approved" : tx.status === "PENDING" ? "pending" : "rejected",
    amount: Math.round(Number(tx.amount_in_cents) / 100),
    currency: tx.currency,
    raw: { id: tx.id, status: tx.status, reference: tx.reference, amount_in_cents: tx.amount_in_cents },
  };
}

async function fetchTx(id: string): Promise<WompiTx | null> {
  const res = await fetch(`${apiBase()}/transactions/${encodeURIComponent(id)}`);
  if (!res.ok) return null;
  const body = (await res.json()) as { data?: WompiTx };
  return body.data ?? null;
}

export const wompi: PaymentAdapter = {
  id: "wompi",
  label: "Wompi · Nequi, Bancolombia y PSE",
  description: "Paga con Nequi, Botón Bancolombia, PSE o tarjeta a través de Wompi.",
  pendingReason: "Pendiente de configuración: faltan WOMPI_PUBLIC_KEY, WOMPI_INTEGRITY_SECRET y WOMPI_EVENTS_SECRET.",
  isConfigured: () => Boolean(config.WOMPI_PUBLIC_KEY && config.WOMPI_INTEGRITY_SECRET && config.WOMPI_EVENTS_SECRET),

  async createCheckout(order: CheckoutOrder) {
    const amountInCents = order.total * 100;
    const reference = toReference(order.code);
    const params = new URLSearchParams({
      "public-key": config.WOMPI_PUBLIC_KEY!,
      currency: "COP",
      "amount-in-cents": String(amountInCents),
      reference,
      "signature:integrity": wompiIntegritySignature(reference, amountInCents, "COP", config.WOMPI_INTEGRITY_SECRET!),
      "redirect-url": returnUrl(config.appUrl, order.code, "wompi"),
      "customer-data:email": order.buyerEmail,
      "customer-data:full-name": order.buyerName,
      "customer-data:phone-number": order.buyerPhone.replace(/\D/g, ""),
      "customer-data:legal-id": order.buyerDocument,
      "customer-data:legal-id-type": "CC",
    });
    return { type: "redirect", url: `https://checkout.wompi.co/p/?${params}` };
  },

  async handleWebhook(req: Request) {
    const event = req.body;
    if (!config.WOMPI_EVENTS_SECRET || !verifyWompiEvent(event, config.WOMPI_EVENTS_SECRET)) {
      throw new SignatureError("Checksum de Wompi inválido.");
    }
    if (event.event !== "transaction.updated") return null;
    const tx = event.data?.transaction as WompiTx | undefined;
    return tx ? toVerified(tx) : null;
  },

  async verify(orderCode: string, query: Record<string, string>) {
    const id = query.id;
    if (!id || !/^[\w-]{4,64}$/.test(id)) return null;
    const tx = await fetchTx(id);
    if (!tx || referenceToOrderCode(tx.reference) !== orderCode) return null;
    return toVerified(tx);
  },
};
