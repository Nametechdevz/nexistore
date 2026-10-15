import { describe, expect, it } from "vitest";
import { canTransition } from "../shared/constants.js";
import { computeTotals, discountPercent, formatCOP } from "../shared/pricing.js";
import { checkoutSchema, productInputSchema, registerSchema } from "../shared/schemas.js";
import { verifyMercadoPagoSignature } from "../server/payments/mercadopago.js";
import { referenceToOrderCode, verifyWompiEvent, wompiIntegritySignature } from "../server/payments/wompi.js";
import { hmacSha256, hashPassword, verifyPassword } from "../server/lib/security.js";
import { createHash } from "node:crypto";

describe("precios", () => {
  const lines = [
    { unitPrice: 29900, quantity: 1 },
    { unitPrice: 39900, quantity: 1 },
  ];
  it("calcula subtotal y total sin cupón", () => {
    expect(computeTotals(lines)).toEqual({ subtotal: 69800, discount: 0, total: 69800 });
  });
  it("aplica cupón porcentual", () => {
    expect(computeTotals(lines, { code: "X", kind: "percent", value: 10, minSubtotal: 0 })).toEqual({ subtotal: 69800, discount: 6980, total: 62820 });
  });
  it("aplica cupón fijo sin dejar total negativo", () => {
    expect(computeTotals([{ unitPrice: 3000, quantity: 1 }], { code: "X", kind: "fixed", value: 5000, minSubtotal: 0 }).total).toBe(0);
  });
  it("ignora el cupón si no se alcanza el mínimo", () => {
    expect(computeTotals(lines, { code: "X", kind: "fixed", value: 5000, minSubtotal: 100000 }).discount).toBe(0);
  });
  it("formatea COP y porcentaje de descuento", () => {
    expect(formatCOP(29900)).toBe("$29.900");
    expect(discountPercent(29900, 49900)).toBe(40);
    expect(discountPercent(100, null)).toBe(0);
  });
});

describe("estados de pedido", () => {
  it("permite solo transiciones válidas", () => {
    expect(canTransition("pending_payment", "paid")).toBe(true);
    expect(canTransition("pending_payment", "completed")).toBe(false);
    expect(canTransition("cancelled", "paid")).toBe(false);
    expect(canTransition("paid", "completed")).toBe(true);
  });
});

describe("validación compartida", () => {
  it("rechaza contraseñas débiles y que no coinciden", () => {
    const r = registerSchema.safeParse({ name: "Ana", email: "ana@x.co", password: "abc", confirmPassword: "abd", acceptTerms: true });
    expect(r.success).toBe(false);
  });
  it("normaliza el correo", () => {
    const r = registerSchema.parse({ name: "Ana", email: "  ANA@X.CO ", password: "Segura123", confirmPassword: "Segura123", acceptTerms: true });
    expect(r.email).toBe("ana@x.co");
  });
  it("exige términos y método de pago válido en checkout", () => {
    expect(checkoutSchema.safeParse({ buyerName: "Ana Pérez", buyerEmail: "a@x.co", buyerPhone: "3001234567", buyerDocument: "12345", paymentProvider: "paypal", acceptTerms: true }).success).toBe(false);
  });
  it("valida que el precio anterior sea mayor", () => {
    const base = { name: "Producto X", slug: "x", categoryId: 1, description: "Descripción larga", price: 1000, stock: 1, compareAtPrice: 500 };
    expect(productInputSchema.safeParse(base).success).toBe(false);
    expect(productInputSchema.safeParse({ ...base, compareAtPrice: 2000 }).success).toBe(true);
  });
});

describe("contraseñas", () => {
  it("hashea y verifica con scrypt", async () => {
    const h = await hashPassword("Segura123");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("Segura123", h)).toBe(true);
    expect(await verifyPassword("Otra1234", h)).toBe(false);
  });
});

describe("firmas de pasarelas", () => {
  it("Mercado Pago: valida x-signature según el manifiesto oficial", () => {
    const secret = "mp_secret";
    const ts = "1704908010";
    const v1 = hmacSha256(secret, `id:123456;request-id:req-1;ts:${ts};`);
    expect(verifyMercadoPagoSignature({ secret, signatureHeader: `ts=${ts},v1=${v1}`, requestId: "req-1", dataId: "123456" })).toBe(true);
    expect(verifyMercadoPagoSignature({ secret, signatureHeader: `ts=${ts},v1=${v1}`, requestId: "req-1", dataId: "999" })).toBe(false);
    expect(verifyMercadoPagoSignature({ secret, signatureHeader: undefined, requestId: "req-1", dataId: "1" })).toBe(false);
  });

  it("Wompi: firma de integridad y checksum de eventos", () => {
    const sig = wompiIntegritySignature("NS-1_ab", 2990000, "COP", "sec");
    expect(sig).toBe(createHash("sha256").update("NS-1_ab2990000COPsec").digest("hex"));
    const data = { transaction: { id: "tx1", status: "APPROVED", amount_in_cents: 2990000 } };
    const timestamp = 1530291411;
    const checksum = createHash("sha256").update(`tx1APPROVED2990000${timestamp}evsec`).digest("hex");
    const event = { data, signature: { properties: ["transaction.id", "transaction.status", "transaction.amount_in_cents"], checksum }, timestamp };
    expect(verifyWompiEvent(event, "evsec")).toBe(true);
    expect(verifyWompiEvent({ ...event, timestamp: timestamp + 1 }, "evsec")).toBe(false);
    expect(referenceToOrderCode("NS-20261015-ABC123_9f2a1c")).toBe("NS-20261015-ABC123");
  });
});
