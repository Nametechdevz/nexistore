import { createHash } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { queryOne } from "../server/db.js";
import { testOutbox } from "../server/services/mailer.js";
import { adminClient, app, checkoutBody, client, closePool, registered, resetDb } from "./helpers.js";

beforeAll(async () => {
  await resetDb();
});
afterAll(async () => {
  await closePool();
});

async function product(slug: string) {
  return (await request(app).get(`/api/catalog/products/${slug}`)).body.product as { id: number; price: number; stock: number };
}

describe("catálogo", () => {
  it("lista categorías y productos activos", async () => {
    const cats = await request(app).get("/api/catalog/categories");
    expect(cats.status).toBe(200);
    expect(cats.body.items.length).toBe(9);
    const prods = await request(app).get("/api/catalog/products?pageSize=48");
    expect(prods.body.total).toBeGreaterThan(15);
  });

  it("busca, filtra por categoría, precio y ofertas", async () => {
    const q = await request(app).get("/api/catalog/products?q=sonora");
    expect(q.body.items.every((p: { name: string }) => /sonora/i.test(p.name))).toBe(true);
    const c = await request(app).get("/api/catalog/products?category=musica");
    expect(c.body.items.every((p: { categorySlug: string }) => p.categorySlug === "musica")).toBe(true);
    const price = await request(app).get("/api/catalog/products?minPrice=50000&maxPrice=60000");
    expect(price.body.items.every((p: { price: number }) => p.price >= 50000 && p.price <= 60000)).toBe(true);
    const sale = await request(app).get("/api/catalog/products?onSale=1");
    expect(sale.body.items.every((p: { compareAtPrice: number | null; price: number }) => (p.compareAtPrice ?? 0) > p.price)).toBe(true);
    const sorted = await request(app).get("/api/catalog/products?sort=price_asc&pageSize=48");
    const prices = sorted.body.items.map((p: { price: number }) => p.price);
    expect(prices).toEqual([...prices].sort((a: number, b: number) => a - b));
  });

  it("trata la búsqueda como texto (sin inyección SQL ni comodines)", async () => {
    const r = await request(app).get(`/api/catalog/products?q=${encodeURIComponent("' OR 1=1 -- %")}`);
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(0);
  });

  it("devuelve 404 para un producto inexistente y valida parámetros", async () => {
    expect((await request(app).get("/api/catalog/products/no-existe")).status).toBe(404);
    expect((await request(app).get("/api/catalog/products?sort=DROP")).status).toBe(422);
  });

  it("expone la campaña y métodos de pago con su estado de configuración", async () => {
    const r = await request(app).get("/api/catalog/store");
    expect(r.body.campaign.enabled).toBe(true);
    const mp = r.body.paymentMethods.find((m: { id: string }) => m.id === "mercadopago");
    expect(mp.configured).toBe(false);
    expect(mp.pendingReason).toMatch(/pendiente de configuración/i);
  });
});

describe("autenticación y seguridad", () => {
  it("rechaza mutaciones sin token CSRF", async () => {
    const r = await request(app).post("/api/auth/login").send({ email: "a@b.co", password: "x" });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("csrf");
  });

  it("valida el registro en el servidor y evita correos duplicados", async () => {
    const c = await client();
    const bad = await c.post("/api/auth/register").send({ name: "A", email: "malo", password: "123", confirmPassword: "1", acceptTerms: false });
    expect(bad.status).toBe(422);
    expect(Object.keys(bad.body.fields)).toEqual(expect.arrayContaining(["name", "email", "password", "acceptTerms"]));
    const u = await registered("dup@test.co");
    expect(u.user.email).toBe("dup@test.co");
    const c2 = await client();
    const again = await c2.post("/api/auth/register").send({ name: "Otro", email: "DUP@test.co", password: "Segura123", confirmPassword: "Segura123", acceptTerms: true });
    expect(again.status).toBe(409);
  });

  it("inicia y cierra sesión; credenciales incorrectas → 401", async () => {
    await registered("login@test.co");
    const c = await client();
    expect((await c.post("/api/auth/login").send({ email: "login@test.co", password: "Mala1234" })).status).toBe(401);
    expect((await c.post("/api/auth/login").send({ email: "nadie@test.co", password: "Mala1234" })).status).toBe(401);
    const ok = await c.post("/api/auth/login").send({ email: "login@test.co", password: "Segura123" });
    expect(ok.status).toBe(200);
    const me = await c.agent.get("/api/auth/me");
    expect(me.body.user.email).toBe("login@test.co");
    // El token CSRF rota al iniciar sesión: el anterior ya no sirve.
    expect((await c.post("/api/auth/logout")).status).toBe(403);
    await c.agent.post("/api/auth/logout").set("x-csrf-token", me.body.csrfToken).expect(200);
    expect((await c.agent.get("/api/auth/me")).body.user).toBeNull();
  });

  it("recupera la contraseña con un enlace de un solo uso", async () => {
    await registered("reset@test.co");
    const c = await client();
    await c.post("/api/auth/forgot").send({ email: "reset@test.co" }).expect(200);
    await c.post("/api/auth/forgot").send({ email: "noexiste@test.co" }).expect(200);
    const mail = testOutbox.find((m) => m.to === "reset@test.co");
    const token = mail!.text.match(/restablecer\/([a-f0-9]{64})/)![1];
    await c.post("/api/auth/reset").send({ token, password: "Nueva1234", confirmPassword: "Nueva1234" }).expect(200);
    expect((await c.post("/api/auth/reset").send({ token, password: "Otra12345", confirmPassword: "Otra12345" })).status).toBe(400);
    await c.post("/api/auth/login").send({ email: "reset@test.co", password: "Nueva1234" }).expect(200);
  });

  it("protege rutas de cuenta y de administración por rol", async () => {
    expect((await request(app).get("/api/orders")).status).toBe(401);
    const u = await registered();
    expect((await u.get("/api/admin/dashboard")).status).toBe(403);
    const a = await adminClient();
    expect((await a.get("/api/admin/dashboard")).status).toBe(200);
  });
});

describe("carrito y pedidos", () => {
  it("persiste el carrito, fusiona y cotiza con precios del servidor", async () => {
    const u = await registered();
    const p = await product("cineplus-premium-anual");
    const s = await product("suite-ofimatica-pro");
    await u.put("/api/cart").send({ items: [{ productId: p.id, quantity: 1 }] }).expect(200);
    const merged = await u.put("/api/cart").send({ mode: "merge", items: [{ productId: p.id, quantity: 1 }, { productId: s.id, quantity: 1 }] });
    expect(merged.body.items).toEqual(expect.arrayContaining([{ productId: p.id, quantity: 2 }, { productId: s.id, quantity: 1 }]));
    const quote = await u.post("/api/cart/quote").send({ items: [{ productId: p.id, quantity: 1 }, { productId: s.id, quantity: 1 }], couponCode: "NAVIDAD10" });
    expect(quote.body.subtotal).toBe(p.price + s.price);
    expect(quote.body.discount).toBe(Math.round((p.price + s.price) * 0.1));
    const low = await u.post("/api/cart/quote").send({ items: [{ productId: p.id, quantity: 1 }], couponCode: "NAVIDAD10" });
    expect(low.body.discount).toBe(0);
    expect(low.body.couponError).toMatch(/compra mínima/);
  });

  it("crea un pedido, reserva inventario, vacía el carrito y aplica cupón", async () => {
    const u = await registered();
    const p = await product("cineplus-premium-anual");
    const s = await product("suite-ofimatica-pro");
    await u.put("/api/cart").send({ items: [{ productId: p.id, quantity: 1 }, { productId: s.id, quantity: 1 }] });
    const res = await u.post("/api/checkout").send(checkoutBody("manual", { couponCode: "NAVIDAD10" }));
    expect(res.status).toBe(201);
    expect(res.body.action.type).toBe("instructions");
    const order = (await u.get(`/api/orders/${res.body.code}`)).body.order;
    expect(order.status).toBe("pending_payment");
    expect(order.total).toBe(order.subtotal - order.discount);
    expect(order.discount).toBe(Math.round((p.price + s.price) * 0.1));
    expect((await product("cineplus-premium-anual")).stock).toBe(p.stock - 1);
    expect((await u.get("/api/cart")).body.items).toEqual([]);
  });

  it("rechaza métodos sin configurar y carritos vacíos", async () => {
    const u = await registered();
    expect((await u.post("/api/checkout").send(checkoutBody("manual"))).status).toBe(400);
    const p = await product("docuplay-anual");
    await u.put("/api/cart").send({ items: [{ productId: p.id, quantity: 1 }] });
    const mp = await u.post("/api/checkout").send(checkoutBody("mercadopago"));
    expect(mp.status).toBe(400);
    expect(mp.body.error).toMatch(/pendiente de configuración/i);
  });

  it("impide comprar más que el inventario disponible", async () => {
    const u = await registered();
    const p = await product("pdf-maestro");
    await queryOne("UPDATE products SET stock = 1 WHERE id = ?", [p.id]);
    await u.put("/api/cart").send({ items: [{ productId: p.id, quantity: 2 }] });
    const r = await u.post("/api/checkout").send(checkoutBody("manual"));
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/inventario/);
  });

  it("cancela un pedido pendiente y devuelve el inventario; otros clientes no lo ven", async () => {
    const u = await registered();
    const p = await product("escudo-total-antivirus");
    await u.put("/api/cart").send({ items: [{ productId: p.id, quantity: 2 }] });
    const { code } = (await u.post("/api/checkout").send(checkoutBody("manual"))).body;
    expect((await product("escudo-total-antivirus")).stock).toBe(p.stock - 2);
    const other = await registered();
    expect((await other.get(`/api/orders/${code}`)).status).toBe(404);
    expect((await other.post(`/api/orders/${code}/cancel`)).status).toBe(404);
    const c = await u.post(`/api/orders/${code}/cancel`);
    expect(c.body.order.status).toBe("cancelled");
    expect((await product("escudo-total-antivirus")).stock).toBe(p.stock);
    const list = await u.get("/api/orders?filter=cancelados");
    expect(list.body.items[0].code).toBe(code);
  });
});

describe("administración", () => {
  it("CRUD de productos con validación y control de inventario", async () => {
    const a = await adminClient();
    const cats = (await a.get("/api/admin/categories")).body.items;
    const bad = await a.post("/api/admin/products").send({ name: "", slug: "Malo Slug", categoryId: 0, price: 10, stock: -1, description: "x" });
    expect(bad.status).toBe(422);
    expect(Object.keys(bad.body.fields)).toEqual(expect.arrayContaining(["name", "slug", "categoryId", "price", "stock", "description"]));
    const body = { name: "Producto <b>Nuevo</b>", slug: "producto-nuevo", categoryId: cats[0].id, description: "Descripción del producto nuevo", price: 15000, compareAtPrice: 20000, stock: 3 };
    const created = await a.post("/api/admin/products").send(body);
    expect(created.status).toBe(201);
    expect((await a.post("/api/admin/products").send(body)).status).toBe(409);
    await a.put(`/api/admin/products/${created.body.id}`).send({ ...body, price: 12000 }).expect(200);
    expect((await a.patch(`/api/admin/products/${created.body.id}/stock`).send({ delta: 5 })).body.stock).toBe(8);
    const pub = await request(app).get("/api/catalog/products/producto-nuevo");
    expect(pub.body.product.price).toBe(12000);
    // El texto se guarda tal cual; el frontend lo escapa al renderizar (React).
    expect(pub.body.product.name).toBe("Producto <b>Nuevo</b>");
    await a.patch(`/api/admin/products/${created.body.id}/active`).send({ isActive: false }).expect(200);
    expect((await request(app).get("/api/catalog/products/producto-nuevo")).status).toBe(404);
    await a.del(`/api/admin/products/${created.body.id}`).expect(200);
  });

  it("no elimina categorías con productos", async () => {
    const a = await adminClient();
    const cats = (await a.get("/api/admin/categories")).body.items;
    expect((await a.del(`/api/admin/categories/${cats[0].id}`)).status).toBe(409);
    const nc = await a.post("/api/admin/categories").send({ name: "Temporal", slug: "temporal", color: "#123456" });
    expect(nc.status).toBe(201);
    await a.del(`/api/admin/categories/${nc.body.id}`).expect(200);
  });

  it("gestiona el ciclo de vida del pedido y la entrega", async () => {
    const u = await registered();
    const a = await adminClient();
    const p = await product("lumen-ai-pro");
    await u.put("/api/cart").send({ items: [{ productId: p.id, quantity: 1 }] });
    const { code } = (await u.post("/api/checkout").send(checkoutBody("manual"))).body;
    expect((await a.post(`/api/admin/orders/${code}/status`).send({ status: "completed" })).status).toBe(409);
    await a.post(`/api/admin/orders/${code}/status`).send({ status: "paid", note: "Transferencia verificada" }).expect(200);
    const detail = (await a.get(`/api/admin/orders/${code}`)).body.order;
    // Sin entrega no se puede completar.
    expect((await a.post(`/api/admin/orders/${code}/delivery`).send({ items: [{ itemId: detail.items[0].id, content: "" }], complete: true })).status).toBe(400);
    await a.post(`/api/admin/orders/${code}/delivery`).send({ items: [{ itemId: detail.items[0].id, content: "CODIGO-123" }] }).expect(200);
    // Antes de completar, el cliente aún no ve la entrega.
    expect((await u.get(`/api/orders/${code}`)).body.order.items[0].deliveryContent).toBeNull();
    await a.post(`/api/admin/orders/${code}/delivery`).send({ items: [{ itemId: detail.items[0].id, content: "CODIGO-123" }], complete: true }).expect(200);
    const mine = (await u.get(`/api/orders/${code}`)).body.order;
    expect(mine.status).toBe("completed");
    expect(mine.items[0].deliveryContent).toBe("CODIGO-123");
    expect(mine.events.map((e: { status: string }) => e.status)).toEqual(["pending_payment", "paid", "completed"]);
    // Ahora el cliente puede calificar.
    await u.post(`/api/products/${p.id}/reviews`).send({ rating: 5, comment: "Excelente" }).expect(201);
    expect((await product("lumen-ai-pro") as unknown as { ratingCount: number }).ratingCount).toBe(1);
  });

  it("no permite al administrador marcar como pagado un pedido de pasarela", async () => {
    const u = await registered();
    const a = await adminClient();
    const p = await product("pincel-ia-creditos");
    await u.put("/api/cart").send({ items: [{ productId: p.id, quantity: 1 }] });
    const res = await u.post("/api/checkout").send(checkoutBody("wompi"));
    expect(res.body.action.url).toMatch(/^https:\/\/checkout\.wompi\.co\/p\/\?/);
    expect((await a.post(`/api/admin/orders/${res.body.code}/status`).send({ status: "paid" })).status).toBe(403);
  });

  it("exporta CSV neutralizando fórmulas", async () => {
    const u = await registered(undefined, "=HYPERLINK(\"x\")");
    const p = await product("ingles-total");
    await u.put("/api/cart").send({ items: [{ productId: p.id, quantity: 1 }] });
    await u.post("/api/checkout").send(checkoutBody("manual", { buyerName: "=CMD()" }));
    const a = await adminClient();
    const today = new Date().toISOString().slice(0, 10);
    const csv = await a.get(`/api/admin/reports/orders.csv?from=${today}&to=${today}`);
    expect(csv.status).toBe(200);
    expect(csv.text).toContain("\"'=CMD()\"");
  });
});

describe("webhooks de pago", () => {
  function wompiEvent(tx: { id: string; status: string; reference: string; amount_in_cents: number }) {
    const timestamp = Math.floor(Date.now() / 1000);
    const props = ["transaction.id", "transaction.status", "transaction.amount_in_cents"];
    const checksum = createHash("sha256").update(`${tx.id}${tx.status}${tx.amount_in_cents}${timestamp}test_events_secret`).digest("hex");
    return { event: "transaction.updated", data: { transaction: { ...tx, currency: "COP" } }, signature: { properties: props, checksum }, timestamp };
  }

  async function wompiOrder() {
    const u = await registered();
    const p = await product("cortes-video-pro");
    await u.put("/api/cart").send({ items: [{ productId: p.id, quantity: 1 }] });
    const { code } = (await u.post("/api/checkout").send(checkoutBody("wompi"))).body;
    const order = (await u.get(`/api/orders/${code}`)).body.order;
    return { u, code, total: order.total as number };
  }

  it("rechaza eventos con checksum inválido", async () => {
    const { code, total } = await wompiOrder();
    const ev = wompiEvent({ id: "tx-bad", status: "APPROVED", reference: `${code}_aa`, amount_in_cents: total * 100 });
    ev.signature.checksum = "0".repeat(64);
    expect((await request(app).post("/api/payments/webhooks/wompi").send(ev)).status).toBe(401);
  });

  it("no marca como pagado si el monto no coincide", async () => {
    const { u, code, total } = await wompiOrder();
    const ev = wompiEvent({ id: "tx-low", status: "APPROVED", reference: `${code}_bb`, amount_in_cents: (total - 1000) * 100 });
    const r = await request(app).post("/api/payments/webhooks/wompi").send(ev);
    expect(r.body.result).toBe("mismatch");
    expect((await u.get(`/api/orders/${code}`)).body.order.status).toBe("pending_payment");
  });

  it("confirma el pago con un evento verificado (idempotente)", async () => {
    const { u, code, total } = await wompiOrder();
    const ev = wompiEvent({ id: "tx-ok", status: "APPROVED", reference: `${code}_cc`, amount_in_cents: total * 100 });
    expect((await request(app).post("/api/payments/webhooks/wompi").send(ev)).body.result).toBe("paid");
    expect((await request(app).post("/api/payments/webhooks/wompi").send(ev)).body.result).toBe("ignored");
    const order = (await u.get(`/api/orders/${code}`)).body.order;
    expect(order.status).toBe("paid");
    expect(order.paymentRef).toBe("tx-ok");
  });
});
