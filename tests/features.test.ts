import { createHash, createHmac, randomBytes } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execute, queryOne } from "../server/db.js";
import { verifyZenoSignature, zenoOrderId, zenoToCode } from "../server/payments/zenobank.js";
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

describe("Zenobank (cripto)", () => {
  const secretBytes = randomBytes(24);
  const SECRET = `whsec_${secretBytes.toString("base64")}`;
  const sign = (id: string, ts: string, body: string) => `v1,${createHmac("sha256", secretBytes).update(`${id}.${ts}.${body}`).digest("base64")}`;

  it("verifica la firma igual que el SDK oficial", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const body = '{"type":"checkout.completed"}';
    const sig = sign("msg_1", ts, body);
    expect(verifyZenoSignature({ secret: SECRET, id: "msg_1", timestamp: ts, signature: sig, rawBody: body })).toBe(true);
    expect(verifyZenoSignature({ secret: SECRET, id: "msg_1", timestamp: ts, signature: `v1,otra ${sig}`, rawBody: body })).toBe(true);
    expect(verifyZenoSignature({ secret: SECRET, id: "msg_1", timestamp: ts, signature: sig, rawBody: body.replace("completed", "expired") })).toBe(false);
    expect(verifyZenoSignature({ secret: SECRET, id: "msg_2", timestamp: ts, signature: sig, rawBody: body })).toBe(false);
    const old = String(Math.floor(Date.now() / 1000) - 600);
    expect(verifyZenoSignature({ secret: SECRET, id: "msg_1", timestamp: old, signature: sign("msg_1", old, body), rawBody: body })).toBe(false);
    expect(zenoToCode(zenoOrderId("NS-20261015-ABC123"))).toBe("NS-20261015-ABC123");
  });

  it("queda pendiente de configuración sin llaves", async () => {
    const store = (await request(app).get("/api/catalog/store")).body;
    const z = store.paymentMethods.find((m: { id: string }) => m.id === "zenobank");
    expect(z.configured).toBe(false);
    expect(z.pendingReason).toMatch(/Configuración → Pagos/);
    const u = await registered();
    const p = await product("docuplay-anual");
    await u.put("/api/cart").send({ items: [{ productId: p.id, quantity: 1 }] });
    expect((await u.post("/api/checkout").send(checkoutBody("zenobank"))).status).toBe(400);
  });

  describe("con credenciales (API simulada)", () => {
    const checkouts = new Map<string, Record<string, string>>();
    let paidAmountOverride: string | null = null;

    let admin: Awaited<ReturnType<typeof adminClient>>;
    beforeAll(async () => {
      admin = await adminClient();
      // Las llaves se configuran desde el panel (no por variables de entorno).
      await admin.put("/api/admin/settings/integrations").send({ zenoApiKey: "sk_test_123", zenoWebhookSecret: SECRET, zenoCurrency: "USD" }).expect(200);
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const url = String(input);
        expect((init?.headers as Record<string, string>)["X-API-Key"]).toBe("sk_test_123");
        if (url.endsWith("/api/v1/checkouts") && init?.method === "POST") {
          const body = JSON.parse(String(init.body));
          const id = `ch_${checkouts.size + 1}`;
          checkouts.set(id, { id, ...body, status: "OPEN", checkoutUrl: `https://pay.zenobank.io/${id}` });
          return new Response(JSON.stringify(checkouts.get(id)), { status: 201 });
        }
        const m = url.match(/\/api\/v1\/checkouts\/(ch_\d+)$/);
        if (m && checkouts.has(m[1]!)) {
          const c = checkouts.get(m[1]!)!;
          return new Response(JSON.stringify({ ...c, priceAmount: paidAmountOverride ?? c.priceAmount }), { status: 200 });
        }
        return new Response(JSON.stringify({ message: "not found" }), { status: 404 });
      });
      const a = await adminClient();
      await a.put("/api/admin/settings/crypto").send({ copPerUnit: 4000 }).expect(200);
    });
    afterAll(async () => {
      vi.restoreAllMocks();
      await admin.put("/api/admin/settings/integrations").send({ zenoApiKey: "", zenoWebhookSecret: "" }).expect(200);
    });

    async function webhook(checkoutId: string, status: string) {
      const c = checkouts.get(checkoutId)!;
      c.status = status;
      const body = JSON.stringify({ type: "checkout.completed", data: c });
      const ts = String(Math.floor(Date.now() / 1000));
      const id = `msg_${checkoutId}_${status}`;
      return request(app)
        .post("/api/payments/webhooks/zenobank")
        .set("content-type", "application/json")
        .set("zeno-id", id)
        .set("zeno-timestamp", ts)
        .set("zeno-signature", sign(id, ts, body))
        .send(body);
    }

    it("cotiza en USD, redirige al checkout y confirma con el webhook firmado", async () => {
      const u = await registered();
      const p = await product("pdf-maestro");
      await u.put("/api/cart").send({ items: [{ productId: p.id, quantity: 1 }] });
      const res = await u.post("/api/checkout").send(checkoutBody("zenobank"));
      expect(res.status).toBe(201);
      expect(res.body.action.url).toMatch(/^https:\/\/pay\.zenobank\.io\/ch_/);
      const checkoutId = res.body.action.url.split("/").pop();
      const sent = checkouts.get(checkoutId)!;
      expect(sent.priceCurrency).toBe("USD");
      expect(sent.priceAmount).toBe((Math.ceil((p.price / 4000) * 100) / 100).toFixed(2));
      expect(sent.orderId.startsWith(res.body.code)).toBe(true);
      const order = (await u.get(`/api/orders/${res.body.code}`)).body.order;
      expect(order.paymentAmountForeign).toBe(String(Number(sent.priceAmount)));
      // Firma inválida → 401
      const bad = await request(app).post("/api/payments/webhooks/zenobank").set("zeno-id", "x").set("zeno-timestamp", "1").set("zeno-signature", "v1,abc").send({});
      expect(bad.status).toBe(401);
      expect((await webhook(checkoutId, "COMPLETED")).body.result).toBe("paid");
      expect((await u.get(`/api/orders/${res.body.code}`)).body.order.status).toBe("paid");
    });

    it("no confirma si el monto real no coincide y al volver consulta el estado", async () => {
      const u = await registered();
      const p = await product("ingles-total");
      await u.put("/api/cart").send({ items: [{ productId: p.id, quantity: 1 }] });
      const res = await u.post("/api/checkout").send(checkoutBody("zenobank"));
      const checkoutId = res.body.action.url.split("/").pop();
      paidAmountOverride = "0.01";
      expect((await webhook(checkoutId, "COMPLETED")).body.result).toBe("mismatch");
      paidAmountOverride = null;
      expect((await u.get(`/api/orders/${res.body.code}`)).body.order.status).toBe("pending_payment");
      // Consulta activa al volver (usa el id del checkout guardado en el pedido).
      const v = await u.post(`/api/orders/${res.body.code}/verify-payment`).send({ params: {} });
      expect(v.body.order.status).toBe("paid");
    });

    it("recarga de billetera con Zenobank", async () => {
      const u = await registered();
      const t = await u.post("/api/account/wallet/topups").send({ amount: 40000, provider: "zenobank" });
      expect(t.status).toBe(201);
      expect(t.body.foreign).toEqual({ currency: "USD", amount: "10.00" });
      const checkoutId = t.body.action.url.split("/").pop();
      expect((await webhook(checkoutId, "COMPLETED")).body.result).toBe("paid");
      expect((await u.get("/api/account/wallet")).body.balance).toBe(40000);
    });
  });
});

describe("configuración de integraciones desde el panel", () => {
  it("guarda llaves, nunca devuelve secretos completos y aplica los cambios al instante", async () => {
    const a = await adminClient();
    const u = await registered();
    expect((await u.get("/api/admin/settings/integrations")).status).toBe(403);
    expect((await a.put("/api/admin/settings/integrations").send({ wompiPublicKey: "llave-mala" })).status).toBe(422);
    expect((await a.put("/api/admin/settings/integrations").send({ siteUrl: "tienda.com" })).status).toBe(422);

    await a.put("/api/admin/settings/integrations").send({ mpAccessToken: "APP_USR-secreto-123456", siteUrl: "https://tienda.example.co/" }).expect(200);
    const view = (await a.get("/api/admin/settings/integrations")).body;
    expect(view.values.mpAccessToken).toBe("");
    expect(view.values.mpAccessTokenSet).toBe(true);
    expect(view.values.mpAccessTokenHint).toBe("••••3456");
    expect(view.publicUrl).toBe("https://tienda.example.co");
    expect(view.webhooks.wompi).toBe("https://tienda.example.co/api/payments/webhooks/wompi");
    expect(JSON.stringify(view)).not.toContain("secreto-123456");

    // Mercado Pago queda disponible sin reiniciar; omitir el campo conserva el secreto.
    let mp = (await request(app).get("/api/catalog/store")).body.paymentMethods.find((m: { id: string }) => m.id === "mercadopago");
    expect(mp.configured).toBe(true);
    await a.put("/api/admin/settings/integrations").send({ smtpHost: "smtp.hostinger.com" }).expect(200);
    expect((await a.get("/api/admin/settings/integrations")).body.values.mpAccessTokenSet).toBe(true);

    // Desactivar transferencias y borrar el token.
    await a.put("/api/admin/settings/integrations").send({ manualEnabled: false, mpAccessToken: "", siteUrl: "" }).expect(200);
    const methods = (await request(app).get("/api/catalog/store")).body.paymentMethods;
    expect(methods.find((m: { id: string }) => m.id === "manual").configured).toBe(false);
    mp = methods.find((m: { id: string }) => m.id === "mercadopago");
    expect(mp.configured).toBe(false);
    await a.put("/api/admin/settings/integrations").send({ manualEnabled: true }).expect(200);

    // Correo de prueba sin SMTP completo → error claro.
    const t = await a.post("/api/admin/settings/integrations/test-email");
    expect(t.status).toBe(400);
    expect(t.body.error).toMatch(/SMTP/);
  });
});

describe("recargas manuales desde el panel", () => {
  it("el admin acredita saldo con método y comprobante; no repite comprobantes", async () => {
    const u = await registered();
    const a = await adminClient();
    const found = (await a.get(`/api/admin/wallet/customers?q=${encodeURIComponent(u.email)}`)).body.items;
    expect(found[0].id).toBe(u.user.id);
    const r = await a.post("/api/admin/wallet/topups/manual").send({ userId: u.user.id, amount: 75000, method: "nequi", reference: "M123456", note: "Pago por WhatsApp" });
    expect(r.status).toBe(201);
    expect(r.body.balance).toBe(75000);
    const dup = await a.post("/api/admin/wallet/topups/manual").send({ userId: u.user.id, amount: 75000, method: "nequi", reference: "M123456" });
    expect(dup.status).toBe(409);
    expect((await a.post("/api/admin/wallet/topups/manual").send({ userId: 999999, amount: 5000, method: "efectivo" })).status).toBe(422);
    expect((await a.post("/api/admin/wallet/topups/manual").send({ userId: u.user.id, amount: 0, method: "efectivo" })).status).toBe(422);
    expect((await u.post("/api/admin/wallet/topups/manual").send({ userId: u.user.id, amount: 5000, method: "efectivo" })).status).toBe(403);
    const w = (await u.get("/api/account/wallet")).body;
    expect(w.balance).toBe(75000);
    expect(w.transactions[0]).toMatchObject({ kind: "topup", amount: 75000 });
    expect(w.transactions[0].note).toMatch(/Recarga manual \(Nequi · M123456\)/);
    expect(w.topups[0]).toMatchObject({ status: "paid", provider: "manual" });
    const list = (await a.get("/api/admin/wallet/topups?status=paid")).body.items;
    expect(list.some((t: { code: string }) => t.code === r.body.code)).toBe(true);
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

describe("imágenes de producto", () => {
  // PNG de 1×1 válido.
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

  it("el admin sube varias imágenes, se guardan en el producto y se sirven con caché", async () => {
    const a = await adminClient();
    const up1 = await a.post("/api/admin/media").set("content-type", "image/png").send(PNG);
    const up2 = await a.post("/api/admin/media").set("content-type", "image/png").send(PNG);
    expect(up1.status).toBe(201);
    expect(up1.body.url).toMatch(/^\/media\/\d+-[a-f0-9]{16}\.png$/);

    const img = await request(app).get(up1.body.url).buffer(true);
    expect(img.status).toBe(200);
    expect(img.headers["content-type"]).toBe("image/png");
    expect(img.headers["cache-control"]).toContain("immutable");
    expect(Buffer.compare(img.body as Buffer, PNG)).toBe(0);
    // Token incorrecto o ruta inventada → 404.
    expect((await request(app).get(up1.body.url.replace(/-[a-f0-9]{16}/, "-0000000000000000"))).status).toBe(404);

    const cats = (await a.get("/api/admin/categories")).body.items;
    const body = { name: "Producto con fotos", slug: "producto-con-fotos", categoryId: cats[0].id, description: "Producto con galería de imágenes", price: 15000, stock: 3, images: [up2.body.url, up1.body.url] };
    const created = await a.post("/api/admin/products").send(body);
    expect(created.status).toBe(201);
    const pub = (await request(app).get("/api/catalog/products/producto-con-fotos")).body.product;
    expect(pub.images).toEqual([up2.body.url, up1.body.url]);
    expect(pub.imageUrl).toBe(up2.body.url);

    // URLs no permitidas en la galería.
    const bad = await a.put(`/api/admin/products/${created.body.id}`).send({ ...body, images: ["javascript:alert(1)"] });
    expect(bad.status).toBe(422);
  });

  it("rechaza archivos que no son imágenes y usuarios que no son admin", async () => {
    const a = await adminClient();
    const svg = await a.post("/api/admin/media").set("content-type", "image/svg+xml").send(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));
    expect(svg.status).toBe(400);
    const html = await a.post("/api/admin/media").set("content-type", "image/png").send(Buffer.from("<html><body>hola</body></html>"));
    expect(html.status).toBe(400);
    const u = await registered();
    expect((await u.post("/api/admin/media").set("content-type", "image/png").send(PNG)).status).toBe(403);
  });

  it("borra solo las imágenes huérfanas antiguas", async () => {
    const { cleanupMedia } = await import("../server/services/media.js");
    const a = await adminClient();
    const orphan = (await a.post("/api/admin/media").set("content-type", "image/png").send(PNG)).body.url as string;
    const used = (await request(app).get("/api/catalog/products/producto-con-fotos")).body.product.images as string[];
    await execute("UPDATE media SET created_at = UTC_TIMESTAMP() - INTERVAL 2 DAY");
    await cleanupMedia();
    expect((await request(app).get(orphan)).status).toBe(404);
    for (const url of used) expect((await request(app).get(url)).status).toBe(200);
  });
});

describe("checkout sin documento", () => {
  it("permite comprar sin documento de identidad", async () => {
    const u = await registered();
    const p = await product("fit-app-pro");
    await u.put("/api/cart").send({ items: [{ productId: p.id, quantity: 1 }] });
    const r = await u.post("/api/checkout").send(checkoutBody("manual"));
    expect(r.status).toBe(201);
    expect(r.body.code).toMatch(/^NS-/);
  });
});

describe("fondos de la campaña", () => {
  it("guarda fondos propios y rechaza URLs no válidas", async () => {
    const a = await adminClient();
    const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
    const up = (await a.post("/api/admin/media").set("content-type", "image/png").send(PNG)).body.url as string;
    const current = (await a.get("/api/admin/settings")).body.campaign;
    await a.put("/api/admin/settings/campaign").send({ ...current, heroImage: up, heroProducts: false }).expect(200);
    const pub = (await request(app).get("/api/catalog/store")).body;
    expect(pub.campaign.heroImage).toBe(up);
    expect(pub.campaign.heroProducts).toBe(false);
    expect((await a.put("/api/admin/settings/campaign").send({ ...current, heroImage: "javascript:alert(1)" })).status).toBe(422);
    await a.put("/api/admin/settings/campaign").send({ ...current, heroImage: "" }).expect(200);
  });
});
