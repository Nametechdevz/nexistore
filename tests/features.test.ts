import { createHash, generateKeyPairSync, createSign } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execute, queryOne } from "../server/db.js";
import { binanceSign, fromTradeNo, toTradeNo, verifyBinanceSignature } from "../server/payments/binance.js";
import { runAlerts } from "../server/services/notifications.js";
import { adminClient, app, checkoutBody, closePool, registered, resetDb } from "./helpers.js";

beforeAll(async () => {
  await resetDb();
});
afterAll(async () => {
  await closePool();
});

type Client = Awaited<ReturnType<typeof registered>>;

async function product(slug: string) {
  return (await request(app).get(`/api/catalog/products/${slug}`)).body.product as { id: number; price: number; stock: number; deliveryMode: string };
}

async function fundWallet(u: Client, amount: number) {
  const a = await adminClient();
  const t = await u.post("/api/account/wallet/topups").send({ amount, provider: "manual" });
  expect(t.status).toBe(201);
  await a.post(`/api/admin/wallet/topups/${t.body.code}/confirm`).expect(200);
  return a;
}

async function buyWithWallet(u: Client, slug: string, qty = 1) {
  const p = await product(slug);
  await u.put("/api/cart").send({ items: [{ productId: p.id, quantity: qty }] });
  return u.post("/api/checkout").send(checkoutBody("wallet"));
}

describe("billetera", () => {
  it("recarga por transferencia: queda pendiente hasta que el admin la confirma", async () => {
    const u = await registered();
    const t = await u.post("/api/account/wallet/topups").send({ amount: 50000, provider: "manual" });
    expect(t.body.action.type).toBe("instructions");
    expect((await u.get("/api/account/wallet")).body.balance).toBe(0);
    const a = await adminClient();
    await a.post(`/api/admin/wallet/topups/${t.body.code}/confirm`).expect(200);
    expect((await a.post(`/api/admin/wallet/topups/${t.body.code}/confirm`)).status).toBe(409);
    const w = (await u.get("/api/account/wallet")).body;
    expect(w.balance).toBe(50000);
    expect(w.transactions[0]).toMatchObject({ kind: "topup", amount: 50000, balanceAfter: 50000 });
    const n = (await u.get("/api/account/notifications")).body;
    expect(n.items.some((x: { kind: string }) => x.kind === "wallet")).toBe(true);
  });

  it("valida montos y métodos de recarga", async () => {
    const u = await registered();
    expect((await u.post("/api/account/wallet/topups").send({ amount: 500, provider: "manual" })).status).toBe(422);
    expect((await u.post("/api/account/wallet/topups").send({ amount: 50000, provider: "wallet" })).status).toBe(422);
    const mp = await u.post("/api/account/wallet/topups").send({ amount: 50000, provider: "mercadopago" });
    expect(mp.status).toBe(422);
    expect(mp.body.fields.provider).toMatch(/pendiente de configuración/i);
  });

  it("recarga con Wompi se acredita solo con el evento firmado y el monto exacto", async () => {
    const u = await registered();
    const t = await u.post("/api/account/wallet/topups").send({ amount: 30000, provider: "wompi" });
    expect(t.body.action.url).toContain("checkout.wompi.co");
    const ts = Math.floor(Date.now() / 1000);
    const tx = { id: `tx-${t.body.code}`, status: "APPROVED", reference: `${t.body.code}_ab`, amount_in_cents: 3_000_000, currency: "COP" };
    const checksum = createHash("sha256").update(`${tx.id}${tx.status}${tx.amount_in_cents}${ts}test_events_secret`).digest("hex");
    const ev = { event: "transaction.updated", data: { transaction: tx }, signature: { properties: ["transaction.id", "transaction.status", "transaction.amount_in_cents"], checksum }, timestamp: ts };
    expect((await request(app).post("/api/payments/webhooks/wompi").send(ev)).body.result).toBe("paid");
    expect((await u.get("/api/account/wallet")).body.balance).toBe(30000);
  });

  it("paga un pedido con saldo y rechaza si no alcanza", async () => {
    const u = await registered();
    const poor = await buyWithWallet(u, "docuplay-anual");
    expect(poor.status).toBe(409);
    expect(poor.body.error).toMatch(/Saldo insuficiente/);
    await fundWallet(u, 100000);
    const p = await product("docuplay-anual");
    const res = await buyWithWallet(u, "docuplay-anual");
    expect(res.status).toBe(201);
    const order = (await u.get(`/api/orders/${res.body.code}`)).body.order;
    expect(order.status).toBe("paid"); // entrega manual: queda pagado esperando entrega
    expect((await u.get("/api/account/wallet")).body.balance).toBe(100000 - p.price);
  });

  it("ajuste manual del admin queda en el historial y no deja saldo negativo", async () => {
    const u = await registered();
    const a = await adminClient();
    await a.post(`/api/admin/customers/${u.user.id}/wallet`).send({ amount: 20000, note: "Compensación" }).expect(200);
    expect((await a.post(`/api/admin/customers/${u.user.id}/wallet`).send({ amount: -50000, note: "Error" })).status).toBe(409);
    const led = (await a.get(`/api/admin/customers/${u.user.id}/wallet`)).body;
    expect(led.balance).toBe(20000);
    expect(led.transactions[0]).toMatchObject({ kind: "adjustment", amount: 20000, note: "Compensación" });
  });
});

describe("inventario y entrega automática", () => {
  it("carga masiva cifrada, sincroniza el stock y valida el producto", async () => {
    const a = await adminClient();
    const p = await product("lumen-ai-pro");
    const before = p.stock;
    const r = await a.post("/api/admin/inventory/bulk").send({
      productId: p.id,
      lines: "nuevo1@lumen.test:Clave1 | Lumen 1 | 2030-01-31\nnuevo2@lumen.test:Clave2",
      expiresAt: null,
    });
    expect(r.body.created).toBe(2);
    expect((await product("lumen-ai-pro")).stock).toBe(before + 2);
    const row = await queryOne<{ content: string; label: string }>("SELECT content, label FROM inventory_items WHERE label = 'Lumen 1'");
    expect(row!.content.startsWith("enc:v1:")).toBe(true); // cifrado en reposo
    expect(row!.content).not.toContain("Clave1");
    const manual = await product("pdf-maestro");
    expect((await a.post("/api/admin/inventory/bulk").send({ productId: manual.id, lines: "x:y", expiresAt: null })).status).toBe(409);
    expect((await a.post("/api/admin/inventory/bulk").send({ productId: p.id, lines: "a:b | x | 31-12-2030", expiresAt: null })).status).toBe(400);
    expect((await a.patch(`/api/admin/products/${p.id}/stock`).send({ delta: 5 })).status).toBe(409);
  });

  it("reserva al crear el pedido, entrega al pagar y libera al cancelar", async () => {
    const u = await registered();
    const p = await product("cineplus-premium-anual");
    await u.put("/api/cart").send({ items: [{ productId: p.id, quantity: 1 }] });
    const { code } = (await u.post("/api/checkout").send(checkoutBody("manual"))).body;
    expect((await product("cineplus-premium-anual")).stock).toBe(p.stock - 1);
    await u.post(`/api/orders/${code}/cancel`).expect(200);
    expect((await product("cineplus-premium-anual")).stock).toBe(p.stock);

    await u.put("/api/cart").send({ items: [{ productId: p.id, quantity: 1 }] });
    const second = (await u.post("/api/checkout").send(checkoutBody("manual"))).body.code;
    const a = await adminClient();
    await a.post(`/api/admin/orders/${second}/status`).send({ status: "paid" }).expect(200);
    const order = (await u.get(`/api/orders/${second}`)).body.order;
    expect(order.status).toBe("completed");
    expect(order.items[0].deliveries).toHaveLength(1);
    expect(order.items[0].deliveries[0].content).toMatch(/Usuario: demo\d@cineplus\.test/);
    expect(order.items[0].deliveries[0].serviceEndsAt).toBeTruthy();
    expect(order.events.map((e: { status: string }) => e.status)).toEqual(["pending_payment", "paid", "completed"]);
  });

  it("pago con billetera de un producto automático: completado al instante", async () => {
    const u = await registered();
    await fundWallet(u, 200000);
    const res = await buyWithWallet(u, "sonora-premium-anual");
    expect(res.body.status).toBe("completed");
    const order = (await u.get(`/api/orders/${res.body.code}`)).body.order;
    expect(order.items[0].deliveries[0].content).toMatch(/sonora\.test/);
  });

  it("no vende más cuentas que las disponibles", async () => {
    const u = await registered();
    const a = await adminClient();
    const p = await product("lumen-ai-pro");
    await execute("UPDATE products SET max_per_order = 10 WHERE id = ?", [p.id]);
    await u.put("/api/cart").send({ items: [{ productId: p.id, quantity: Math.min(10, p.stock + 1) }] });
    const r = await u.post("/api/checkout").send(checkoutBody("manual"));
    expect(r.status).toBe(409);
    void a;
  });
});

describe("soporte y cuentas caídas", () => {
  async function completedAutoOrder() {
    const u = await registered();
    await fundWallet(u, 200000);
    const res = await buyWithWallet(u, "cineplus-premium-anual");
    const order = (await u.get(`/api/orders/${res.body.code}`)).body.order;
    return { u, order, item: order.items[0], delivery: order.items[0].deliveries[0] };
  }

  it("el cliente reporta la falla y el admin la reemplaza: pedido e inventario se actualizan", async () => {
    const { u, order, item, delivery } = await completedAutoOrder();
    const before = (await product("cineplus-premium-anual")).stock;
    const rep = await u.post(`/api/orders/${order.code}/items/${item.id}/report`).send({ inventoryItemId: delivery.id, reason: "caida", message: "No deja entrar" });
    expect(rep.status).toBe(201);
    expect((await u.post(`/api/orders/${order.code}/items/${item.id}/report`).send({ inventoryItemId: delivery.id, reason: "caida" })).status).toBe(409);

    const a = await adminClient();
    const detail = (await a.get(`/api/admin/tickets/${rep.body.ticketId}`)).body;
    expect(detail.ticket.kind).toBe("account_issue");
    expect(detail.ticket.item.availableReplacements).toBeGreaterThan(0);
    const adminNotifs = (await a.get("/api/admin/notifications")).body.items;
    expect(adminNotifs.some((n: { kind: string }) => n.kind === "account_issue")).toBe(true);

    await a.post(`/api/admin/tickets/${rep.body.ticketId}/resolve`).send({ action: "replace" }).expect(200);
    expect((await a.post(`/api/admin/tickets/${rep.body.ticketId}/resolve`).send({ action: "replace" })).status).toBe(409);

    const after = (await u.get(`/api/orders/${order.code}`)).body.order;
    const active = after.items[0].deliveries.filter((d: { status: string }) => d.status === "sold");
    const fallen = after.items[0].deliveries.filter((d: { status: string }) => d.status === "fallen");
    expect(active).toHaveLength(1);
    expect(active[0].id).not.toBe(delivery.id);
    expect(active[0].serviceEndsAt).toBe(delivery.serviceEndsAt); // conserva el fin del servicio
    expect(fallen[0].content).toBeNull();
    expect(after.events.some((e: { status: string }) => e.status === "account_replaced")).toBe(true);
    expect((await product("cineplus-premium-anual")).stock).toBe(before - 1);
    const t = (await u.get(`/api/account/tickets/${rep.body.ticketId}`)).body.ticket;
    expect(t.messages.at(-1).authorRole).toBe("admin");
    expect(t.resolution).toBe("replaced");
  });

  it("reembolso a la billetera por falla", async () => {
    const { u, order, item, delivery } = await completedAutoOrder();
    const balance = (await u.get("/api/account/wallet")).body.balance;
    const rep = await u.post(`/api/orders/${order.code}/items/${item.id}/report`).send({ inventoryItemId: delivery.id, reason: "clave" });
    const a = await adminClient();
    expect((await a.post(`/api/admin/tickets/${rep.body.ticketId}/resolve`).send({ action: "refund", amount: item.unitPrice + 1 })).status).toBe(400);
    await a.post(`/api/admin/tickets/${rep.body.ticketId}/resolve`).send({ action: "refund", amount: 10000 }).expect(200);
    expect((await u.get("/api/account/wallet")).body.balance).toBe(balance + 10000);
    const after = (await u.get(`/api/orders/${order.code}`)).body.order;
    expect(after.items[0].deliveries[0].status).toBe("fallen");
  });

  it("el admin marca una cuenta caída desde inventario y se reemplaza automáticamente", async () => {
    const { u, order, delivery } = await completedAutoOrder();
    const a = await adminClient();
    const r = await a.post(`/api/admin/inventory/${delivery.id}/fall`).send({ replace: true, note: "Proveedor cerró la cuenta" });
    expect(r.body.result).toBe("replaced");
    const after = (await u.get(`/api/orders/${order.code}`)).body.order;
    expect(after.items[0].deliveries.find((d: { status: string }) => d.status === "sold").id).toBe(r.body.newItemId);
    expect((await u.get("/api/account/notifications")).body.items.some((n: { kind: string }) => n.kind === "account_replaced")).toBe(true);
  });

  it("conversación de soporte entre cliente y admin, privada por cliente", async () => {
    const u = await registered();
    const other = await registered();
    const t = await u.post("/api/account/tickets").send({ subject: "Ayuda con mi compra", message: "No encuentro mi pedido en la lista." });
    expect(t.status).toBe(201);
    expect((await other.get(`/api/account/tickets/${t.body.id}`)).status).toBe(404);
    expect((await other.post(`/api/account/tickets/${t.body.id}/messages`).send({ body: "hola" })).status).toBe(404);
    const a = await adminClient();
    await a.post(`/api/admin/tickets/${t.body.id}/messages`).send({ body: "Ya lo revisamos, aparece en Mis pedidos.", status: "answered" }).expect(201);
    const mine = (await u.get(`/api/account/tickets/${t.body.id}`)).body.ticket;
    expect(mine.status).toBe("answered");
    expect(mine.messages.map((m: { authorRole: string }) => m.authorRole)).toEqual(["customer", "admin"]);
    await u.post(`/api/account/tickets/${t.body.id}/messages`).send({ body: "¡Gracias!" }).expect(201);
    expect((await u.get(`/api/account/tickets/${t.body.id}`)).body.ticket.status).toBe("open");
    const notif = (await u.get("/api/account/notifications")).body;
    expect(notif.items.some((n: { kind: string }) => n.kind === "ticket_reply")).toBe(true);
    await u.post("/api/account/notifications/read").send({ ids: "all" }).expect(200);
    expect((await u.get("/api/account/notifications")).body.unread).toBe(0);
  });
});

describe("alertas", () => {
  it("avisa cuentas por vencer, servicios por terminar, marca vencidas y poco inventario", async () => {
    const a = await adminClient();
    const u = await registered();
    await fundWallet(u, 200000);
    const res = await buyWithWallet(u, "sonora-premium-anual");
    const order = (await u.get(`/api/orders/${res.body.code}`)).body.order;
    const itemId = order.items[0].deliveries[0].id;
    await execute("UPDATE inventory_items SET service_ends_at = UTC_TIMESTAMP() + INTERVAL 3 DAY WHERE id = ?", [itemId]);
    // Una cuenta disponible ya vencida en el proveedor.
    const lumen = await product("lumen-ai-pro");
    await execute("UPDATE inventory_items SET expires_at = UTC_TIMESTAMP() - INTERVAL 1 DAY WHERE product_id = ? AND status = 'available' ORDER BY id LIMIT 1", [lumen.id]);
    // Umbral alto para forzar alerta de poco inventario.
    await execute("UPDATE products SET low_stock_threshold = 100 WHERE id = ?", [lumen.id]);

    const r = await runAlerts();
    expect(r.expired).toBeGreaterThanOrEqual(1);
    expect(r.customerNotices).toBeGreaterThanOrEqual(1);
    expect((await product("lumen-ai-pro")).stock).toBe(lumen.stock - 1);
    const mine = (await u.get("/api/account/notifications")).body.items;
    expect(mine.some((n: { kind: string; title: string }) => n.kind === "service_expiring" && /vence en 7 días/.test(n.title))).toBe(true);
    const adm = (await a.get("/api/admin/notifications")).body.items;
    expect(adm.some((n: { kind: string }) => n.kind === "low_stock")).toBe(true);
    expect(adm.some((n: { kind: string }) => n.kind === "account_expiring")).toBe(true);
    // Sin duplicados al repetir.
    const again = await runAlerts();
    expect(again.customerNotices).toBe(0);
  });
});

describe("Binance Pay (cripto)", () => {
  it("firma HMAC-SHA512 y verificación RSA del webhook", () => {
    expect(binanceSign("1", "abc", "{}", "secret")).toMatch(/^[0-9A-F]{128}$/);
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const body = '{"bizType":"PAY"}';
    const s = createSign("RSA-SHA256");
    s.update(`123\nnonce\n${body}\n`);
    const sig = s.sign(privateKey, "base64");
    const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
    expect(verifyBinanceSignature(pem, "123", "nonce", body, sig)).toBe(true);
    expect(verifyBinanceSignature(pem, "123", "nonce", body.replace("PAY", "PAX"), sig)).toBe(false);
    expect(fromTradeNo(toTradeNo("NS-20261015-ABC123"))).toBe("NS-20261015-ABC123");
    expect(fromTradeNo(toTradeNo("WT-20261015-9F2A1C"))).toBe("WT-20261015-9F2A1C");
  });

  it("queda pendiente de configuración sin llaves ni tasa", async () => {
    const store = (await request(app).get("/api/catalog/store")).body;
    const b = store.paymentMethods.find((m: { id: string }) => m.id === "binance");
    expect(b.configured).toBe(false);
    expect(b.currency).toBe("USDT");
    const u = await registered();
    const p = await product("docuplay-anual");
    await u.put("/api/cart").send({ items: [{ productId: p.id, quantity: 1 }] });
    expect((await u.post("/api/checkout").send(checkoutBody("binance"))).status).toBe(400);
  });

  it("reembolso de pedido completo a la billetera", async () => {
    const u = await registered();
    const a = await adminClient();
    const p = await product("pdf-maestro");
    await u.put("/api/cart").send({ items: [{ productId: p.id, quantity: 1 }] });
    const { code } = (await u.post("/api/checkout").send(checkoutBody("manual"))).body;
    await a.post(`/api/admin/orders/${code}/status`).send({ status: "paid" }).expect(200);
    await a.post(`/api/admin/orders/${code}/status`).send({ status: "refunded", refundToWallet: true }).expect(200);
    expect((await u.get("/api/account/wallet")).body.balance).toBe(p.price);
  });
});
