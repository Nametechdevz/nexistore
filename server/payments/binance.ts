/**
 * Binance Pay (cripto) — API de comerciante.
 * Docs: https://developers.binance.com/docs/binance-pay/introduction
 * - Peticiones firmadas: HMAC-SHA512(timestamp + "\n" + nonce + "\n" + body + "\n", secretKey) en hex mayúsculas.
 * - Webhooks: firma RSA-SHA256 (base64) verificada con el certificado público que entrega Binance.
 * - Binance Pay no cobra en COP: el pedido se cotiza en USDT con la tasa configurada por el admin
 *   y la confirmación exige el monto exacto en USDT guardado en el pedido.
 */
import type { Request } from "express";
import { createHmac, createVerify, randomBytes } from "node:crypto";
import { config } from "../config.js";
import { returnUrl, SignatureError, type CheckoutOrder, type PaymentAdapter, type VerifiedPayment } from "./types.js";

const API = "https://bpay.binanceapi.com";

export function binanceSign(timestamp: string, nonce: string, body: string, secret: string) {
  return createHmac("sha512", secret).update(`${timestamp}\n${nonce}\n${body}\n`).digest("hex").toUpperCase();
}

/** "NS-20261015-ABC123" ⇄ "NS20261015ABC123" (Binance solo admite alfanuméricos). */
export const toTradeNo = (code: string) => code.replace(/-/g, "");
export const fromTradeNo = (no: string) => (/^[A-Z]{2}\d{8}[A-Z0-9]+$/.test(no) ? `${no.slice(0, 2)}-${no.slice(2, 10)}-${no.slice(10)}` : "");

async function bpay<T>(path: string, payload: unknown): Promise<T> {
  const body = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const nonce = randomBytes(16).toString("hex");
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "BinancePay-Timestamp": timestamp,
      "BinancePay-Nonce": nonce,
      "BinancePay-Certificate-SN": config.BINANCE_PAY_API_KEY!,
      "BinancePay-Signature": binanceSign(timestamp, nonce, body, config.BINANCE_PAY_SECRET_KEY!),
    },
    body,
  });
  const json = (await res.json().catch(() => ({}))) as { status?: string; code?: string; data?: T; errorMessage?: string };
  if (!res.ok || json.status !== "SUCCESS") throw new Error(`Binance Pay: ${json.code ?? res.status} ${json.errorMessage ?? ""}`.trim());
  return json.data as T;
}

let certCache: { at: number; certs: Map<string, string> } | null = null;
async function publicKeyFor(serial: string): Promise<string | null> {
  if (!certCache || Date.now() - certCache.at > 60 * 60 * 1000 || !certCache.certs.has(serial)) {
    const list = await bpay<{ certSerial: string; certPublic: string }[]>("/binancepay/openapi/certificates", {});
    certCache = { at: Date.now(), certs: new Map(list.map((c) => [c.certSerial, c.certPublic])) };
  }
  return certCache.certs.get(serial) ?? null;
}

export function verifyBinanceSignature(publicKeyPem: string, timestamp: string, nonce: string, rawBody: string, signatureB64: string) {
  const v = createVerify("RSA-SHA256");
  v.update(`${timestamp}\n${nonce}\n${rawBody}\n`);
  return v.verify(publicKeyPem, signatureB64, "base64");
}

interface BinanceOrder {
  merchantTradeNo: string;
  status: string; // INITIAL | PENDING | PAID | CANCELED | ERROR | REFUNDING | REFUNDED | EXPIRED
  orderAmount: string;
  currency: string;
  transactionId?: string;
  prepayId?: string;
}

function toVerified(o: BinanceOrder): VerifiedPayment {
  return {
    provider: "binance",
    externalId: o.transactionId ?? o.prepayId ?? o.merchantTradeNo,
    orderCode: fromTradeNo(o.merchantTradeNo),
    status: o.status === "PAID" ? "approved" : ["CANCELED", "ERROR", "EXPIRED"].includes(o.status) ? "rejected" : "pending",
    amount: 0,
    currency: o.currency,
    foreignAmount: String(Number(o.orderAmount)),
    raw: o,
  };
}

async function queryOrder(code: string): Promise<VerifiedPayment | null> {
  const data = await bpay<BinanceOrder>("/binancepay/openapi/v2/order/query", { merchantTradeNo: toTradeNo(code) });
  return data ? toVerified({ ...data, merchantTradeNo: data.merchantTradeNo ?? toTradeNo(code) }) : null;
}

export const binance: PaymentAdapter = {
  id: "binance",
  label: "Binance Pay · Criptomonedas",
  description: "Paga con USDT u otras criptomonedas desde tu cuenta de Binance.",
  pendingReason: "Pendiente de configuración: faltan BINANCE_PAY_API_KEY y BINANCE_PAY_SECRET_KEY, y la tasa COP/USDT en Configuración.",
  isConfigured: () => Boolean(config.BINANCE_PAY_API_KEY && config.BINANCE_PAY_SECRET_KEY),

  async createCheckout(order: CheckoutOrder) {
    if (!order.foreign || order.foreign.currency !== "USDT") throw new Error("Falta la cotización en USDT.");
    const back = returnUrl(config.appUrl, order.code, "binance");
    const data = await bpay<{ checkoutUrl: string; prepayId: string }>("/binancepay/openapi/v3/order", {
      env: { terminalType: "WEB" },
      merchantTradeNo: toTradeNo(order.code),
      orderAmount: Number(order.foreign.amount),
      currency: "USDT",
      description: (order.description ?? `NexiStore ${order.code}`).slice(0, 256),
      goodsDetails: [{ goodsType: "02", goodsCategory: "Z000", referenceGoodsId: order.code, goodsName: (order.description ?? `Pedido ${order.code}`).slice(0, 256) }],
      returnUrl: back,
      cancelUrl: back,
      webhookUrl: `${config.appUrl}/api/payments/webhooks/binance`,
      orderExpireTime: Date.now() + 60 * 60 * 1000,
    });
    return { type: "redirect", url: data.checkoutUrl };
  },

  async handleWebhook(req: Request) {
    const ts = req.get("BinancePay-Timestamp");
    const nonce = req.get("BinancePay-Nonce");
    const sig = req.get("BinancePay-Signature");
    const serial = req.get("BinancePay-Certificate-SN");
    const raw = (req as Request & { rawBody?: Buffer }).rawBody?.toString("utf8");
    if (!ts || !nonce || !sig || !serial || !raw) throw new SignatureError("Faltan cabeceras de firma de Binance Pay.");
    const pem = await publicKeyFor(serial);
    if (!pem || !verifyBinanceSignature(pem, ts, nonce, raw, sig)) throw new SignatureError("Firma de Binance Pay inválida.");
    const body = req.body as { bizType?: string; bizStatus?: string; data?: string };
    if (body.bizType !== "PAY") return null;
    const data = JSON.parse(body.data ?? "{}") as { merchantTradeNo?: string };
    const code = fromTradeNo(String(data.merchantTradeNo ?? ""));
    if (!code) return null;
    // Defensa adicional: el estado y el monto se confirman consultando la API de Binance Pay.
    return queryOrder(code);
  },

  async verify(orderCode: string) {
    return queryOrder(orderCode);
  },
};
