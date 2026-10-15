/**
 * Mercado Pago — Checkout Pro (Colombia, COP).
 * Docs: https://www.mercadopago.com.co/developers/es/docs/checkout-pro
 * El estado del pago SIEMPRE se obtiene consultando la API de Mercado Pago con el access token;
 * el webhook solo indica qué pago consultar y se valida con x-signature cuando hay secreto.
 */
import type { Request } from "express";
import { integ, publicUrl } from "../services/integrations.js";
import { hmacSha256, safeEqual } from "../lib/security.js";
import { returnUrl, SignatureError, type CheckoutOrder, type PaymentAdapter, type VerifiedPayment } from "./types.js";

const API = "https://api.mercadopago.com";

/** Valida la cabecera x-signature ("ts=...,v1=...") según la documentación de webhooks. */
export function verifyMercadoPagoSignature(opts: {
  secret: string;
  signatureHeader: string | undefined;
  requestId: string | undefined;
  dataId: string | undefined;
}): boolean {
  const { secret, signatureHeader, requestId, dataId } = opts;
  if (!signatureHeader) return false;
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((p) => {
      const [k, ...v] = p.trim().split("=");
      return [k, v.join("=")];
    }),
  );
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;
  let manifest = "";
  if (dataId) manifest += `id:${/^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${ts};`;
  return safeEqual(hmacSha256(secret, manifest), v1);
}

async function mpFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${integ().mpAccessToken}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`Mercado Pago respondió ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

interface MpPayment {
  id: number;
  status: string;
  external_reference: string | null;
  transaction_amount: number;
  currency_id: string;
}

function toVerified(p: MpPayment): VerifiedPayment {
  return {
    provider: "mercadopago",
    externalId: String(p.id),
    orderCode: p.external_reference ?? "",
    status: p.status === "approved" ? "approved" : ["rejected", "cancelled", "refunded", "charged_back"].includes(p.status) ? "rejected" : "pending",
    amount: Math.round(Number(p.transaction_amount)),
    currency: p.currency_id,
    raw: { id: p.id, status: p.status, amount: p.transaction_amount, currency: p.currency_id },
  };
}

export const mercadoPago: PaymentAdapter = {
  id: "mercadopago",
  label: "Mercado Pago",
  description: "Tarjeta, PSE y efectivo a través de Mercado Pago.",
  pendingReason: "Pendiente de configuración: agrega el access token en Admin → Configuración → Pagos.",
  isConfigured: () => Boolean(integ().mpAccessToken),

  async createCheckout(order: CheckoutOrder) {
    const back = returnUrl(publicUrl(), order.code, "mercadopago");
    const pref = await mpFetch<{ init_point: string }>("/checkout/preferences", {
      method: "POST",
      headers: { "x-idempotency-key": `pref-${order.code}-${Date.now()}` },
      body: JSON.stringify({
        items: [{ id: order.code, title: order.description ?? `Pedido ${order.code} — NexiStore`, quantity: 1, unit_price: order.total, currency_id: "COP" }],
        payer: { name: order.buyerName, email: order.buyerEmail },
        external_reference: order.code,
        back_urls: { success: back, pending: back, failure: back },
        auto_return: "approved",
        notification_url: `${publicUrl()}/api/payments/webhooks/mercadopago`,
        statement_descriptor: "NEXISTORE",
      }),
    });
    return { type: "redirect", url: pref.init_point };
  },

  async handleWebhook(req: Request) {
    const type = (req.query.type ?? req.body?.type) as string | undefined;
    const dataId = String(req.query["data.id"] ?? req.body?.data?.id ?? "");
    if (type !== "payment" || !dataId) return null;
    if (integ().mpWebhookSecret) {
      const ok = verifyMercadoPagoSignature({
        secret: integ().mpWebhookSecret,
        signatureHeader: req.get("x-signature"),
        requestId: req.get("x-request-id"),
        dataId,
      });
      if (!ok) throw new SignatureError("Firma de Mercado Pago inválida.");
    }
    if (!/^\d+$/.test(dataId)) return null;
    const payment = await mpFetch<MpPayment>(`/v1/payments/${dataId}`);
    return toVerified(payment);
  },

  async verify(orderCode: string) {
    const params = new URLSearchParams({ external_reference: orderCode, sort: "date_created", criteria: "desc" });
    const res = await mpFetch<{ results: MpPayment[] }>(`/v1/payments/search?${params}`);
    const approved = res.results.find((p) => p.status === "approved");
    const latest = approved ?? res.results[0];
    return latest ? toVerified(latest) : null;
  },
};
