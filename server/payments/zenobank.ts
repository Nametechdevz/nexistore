/**
 * Zenobank — pasarela de pagos con criptomonedas (USDT, USDC, BTC…).
 * Referencia: SDK oficial (github.com/zenobank/php-sdk) y docs.zenobank.io
 * - API: https://api.zenobank.io, autenticación con la cabecera X-API-Key (sk_…).
 * - POST /api/v1/checkouts { orderId, priceAmount, priceCurrency, successRedirectUrl } → { id, checkoutUrl, status, … }
 * - GET  /api/v1/checkouts/:id
 * - Estados: OPEN | COMPLETED | PARTIALLY_PAID | EXPIRED | CANCELLED
 * - Webhooks firmados (esquema Standard Webhooks): cabeceras zeno-id / zeno-timestamp / zeno-signature
 *   (o svix-*), firma "v1,<base64(HMAC-SHA256(id.timestamp.body, base64(secreto sin "whsec_")))>",
 *   tolerancia de 5 minutos.
 */
import type { Request } from "express";
import { createHmac, randomBytes } from "node:crypto";
import { config } from "../config.js";
import { safeEqual } from "../lib/security.js";
import { returnUrl, SignatureError, type CheckoutOrder, type PaymentAdapter, type VerifiedPayment } from "./types.js";

const API = () => (config.ZENOBANK_API_URL ?? "https://api.zenobank.io").replace(/\/$/, "");
export const ZENO_CURRENCY = () => (config.ZENOBANK_PRICE_CURRENCY ?? "USD").toUpperCase();

/** Verificación de firma idéntica a la del SDK oficial. Devuelve false si algo no cuadra. */
export function verifyZenoSignature(opts: {
  secret: string;
  id: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
  rawBody: string;
  nowSeconds?: number;
}): boolean {
  const { id, timestamp, signature, rawBody } = opts;
  if (!id || !timestamp || !signature) return false;
  const ts = Number.parseInt(timestamp, 10);
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > 300) return false;
  const b64 = opts.secret.startsWith("whsec_") ? opts.secret.slice(6) : opts.secret;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return false;
  const key = Buffer.from(b64, "base64");
  const expected = `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest("base64")}`;
  return signature.split(" ").some((part) => safeEqual(part.trim(), expected));
}

const header = (req: Request, key: string) => req.get(`zeno-${key}`) ?? req.get(`svix-${key}`);

interface ZenoCheckout {
  id: string;
  orderId: string;
  priceAmount: string;
  priceCurrency: string;
  paidAmount?: string;
  status: "OPEN" | "COMPLETED" | "PARTIALLY_PAID" | "EXPIRED" | "CANCELLED";
  checkoutUrl: string;
}

async function zeno<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API()}${path}`, {
    ...init,
    headers: {
      "X-API-Key": config.ZENOBANK_API_KEY!,
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* respuesta no JSON */
  }
  if (!res.ok) throw new Error(`Zenobank ${res.status}: ${(json as { message?: string } | null)?.message ?? text.slice(0, 200)}`);
  if (!json || typeof json !== "object") throw new Error("Zenobank: respuesta JSON inválida.");
  return json as T;
}

/** Referencia única por intento (permite reintentar el pago): CODIGO_xxxxxx */
export const zenoOrderId = (code: string) => `${code}_${randomBytes(3).toString("hex")}`;
export const zenoToCode = (orderId: string) => orderId.split("_")[0] ?? "";

export function zenoToVerified(c: ZenoCheckout): VerifiedPayment {
  const cur = (c.priceCurrency ?? "").toUpperCase();
  return {
    provider: "zenobank",
    externalId: c.id,
    orderCode: zenoToCode(c.orderId),
    status: c.status === "COMPLETED" ? "approved" : c.status === "EXPIRED" || c.status === "CANCELLED" ? "rejected" : "pending",
    amount: cur === "COP" ? Math.round(Number(c.priceAmount)) : 0,
    currency: cur,
    foreignAmount: cur === "COP" ? undefined : String(Number(c.priceAmount)),
    raw: { id: c.id, orderId: c.orderId, status: c.status, priceAmount: c.priceAmount, priceCurrency: c.priceCurrency, paidAmount: c.paidAmount },
  };
}

export const zenobank: PaymentAdapter = {
  id: "zenobank",
  label: "Zenobank · Criptomonedas",
  description: "Paga con USDT, USDC, BTC y otras criptomonedas.",
  pendingReason: "Pendiente de configuración: faltan ZENOBANK_API_KEY y ZENOBANK_WEBHOOK_SECRET.",
  isConfigured: () => Boolean(config.ZENOBANK_API_KEY && config.ZENOBANK_WEBHOOK_SECRET),

  async createCheckout(order: CheckoutOrder) {
    const currency = ZENO_CURRENCY();
    const amount = currency === "COP" ? String(order.total) : order.foreign?.amount;
    if (!amount) throw new Error(`Falta la cotización en ${currency}.`);
    const c = await zeno<ZenoCheckout>("/api/v1/checkouts", {
      method: "POST",
      body: JSON.stringify({
        orderId: zenoOrderId(order.code),
        priceAmount: amount,
        priceCurrency: currency,
        successRedirectUrl: returnUrl(config.appUrl, order.code, "zenobank"),
      }),
    });
    return { type: "redirect", url: c.checkoutUrl, externalRef: c.id };
  },

  async handleWebhook(req: Request) {
    const raw = (req as Request & { rawBody?: Buffer }).rawBody?.toString("utf8") ?? "";
    const ok = verifyZenoSignature({
      secret: config.ZENOBANK_WEBHOOK_SECRET!,
      id: header(req, "id"),
      timestamp: header(req, "timestamp"),
      signature: header(req, "signature"),
      rawBody: raw,
    });
    if (!ok) throw new SignatureError("Firma de Zenobank inválida.");
    const event = req.body as { type?: string; data?: ZenoCheckout };
    if (!event.data?.id) return null;
    // Defensa adicional: el estado y el monto se confirman consultando la API de Zenobank.
    const fresh = await zeno<ZenoCheckout>(`/api/v1/checkouts/${encodeURIComponent(event.data.id)}`);
    return zenoToVerified(fresh);
  },

  async verify(code: string, query: Record<string, string>, externalRef?: string | null) {
    const id = externalRef ?? query.checkoutId ?? query.id;
    if (!id || !/^[\w-]{3,80}$/.test(id)) return null;
    const c = await zeno<ZenoCheckout>(`/api/v1/checkouts/${encodeURIComponent(id)}`);
    const v = zenoToVerified(c);
    return v.orderCode === code ? v : null;
  },
};
