/** Carrito (persistente por usuario), cotización, checkout y pedidos del cliente. */
import { Router } from "express";
import { z } from "zod";
import { execute, query, queryOne, transaction } from "../db.js";
import { ah, badRequest, conflict, HttpError, notFound, parse } from "../lib/http.js";
import { requireAuth } from "../middleware/session.js";
import { adapters, cryptoRate, isProviderReady, toUsdt } from "../payments/index.js";
import { applyVerifiedPayment, changeStatus, createOrder, getOrder, listOrders, quoteCart } from "../services/orders.js";
import { ORDER_FILTERS, type OrderFilter } from "../../shared/constants.js";
import { cartLineSchema, cartSyncSchema, checkoutSchema, couponCodeSchema, reportIssueSchema, reviewSchema } from "../../shared/schemas.js";
import { reportIssue } from "../services/support.js";

export const shopRouter = Router();

/* ---------- Carrito ---------- */

async function readCart(userId: number) {
  return query<{ productId: number; quantity: number }>(
    "SELECT product_id AS productId, quantity FROM cart_items WHERE user_id = ? ORDER BY updated_at",
    [userId],
  );
}

shopRouter.get(
  "/cart",
  requireAuth,
  ah(async (req, res) => {
    res.json({ items: await readCart(req.user!.id) });
  }),
);

/** Sustituye o fusiona el carrito del servidor con el del navegador (al iniciar sesión). */
shopRouter.put(
  "/cart",
  requireAuth,
  ah(async (req, res) => {
    const { items, mode } = parse(cartSyncSchema, req.body);
    const userId = req.user!.id;
    await transaction(async (conn) => {
      if (mode === "replace") await conn.execute("DELETE FROM cart_items WHERE user_id = ?", [userId]);
      for (const it of items) {
        await conn.execute(
          `INSERT INTO cart_items (user_id, product_id, quantity)
           SELECT ?, id, LEAST(?, max_per_order) FROM products WHERE id = ? AND is_active = 1
           ON DUPLICATE KEY UPDATE quantity = LEAST(${mode === "merge" ? "quantity + VALUES(quantity)" : "VALUES(quantity)"}, 10)`,
          [userId, it.quantity, it.productId],
        );
      }
    });
    res.json({ items: await readCart(userId) });
  }),
);

/** Cotización con precios, inventario y cupón calculados en el servidor (sirve también a invitados). */
const quoteSchema = z.object({ items: z.array(cartLineSchema).max(50), couponCode: couponCodeSchema.optional().or(z.literal("")) });
shopRouter.post(
  "/cart/quote",
  ah(async (req, res) => {
    const { items, couponCode } = parse(quoteSchema, req.body);
    const q = await quoteCart(items, couponCode || undefined);
    res.json({
      items: q.items.map((i) => ({ product: i.product, quantity: i.quantity, available: i.available, lineTotal: i.lineTotal })),
      removed: q.removed,
      coupon: q.coupon,
      couponError: q.couponError,
      subtotal: q.subtotal,
      discount: q.discount,
      total: q.total,
    });
  }),
);

/* ---------- Checkout ---------- */

shopRouter.post(
  "/checkout",
  requireAuth,
  ah(async (req, res) => {
    const input = parse(checkoutSchema, req.body);
    const adapter = adapters[input.paymentProvider];
    const ready = await isProviderReady(input.paymentProvider);
    if (!ready.ok) {
      throw badRequest(`${adapter.label} no está disponible: ${ready.reason}`, { paymentProvider: ready.reason ?? "" });
    }
    const lines = await readCart(req.user!.id);
    if (!lines.length) throw badRequest("Tu carrito está vacío.");
    const rate = input.paymentProvider === "binance" ? await cryptoRate() : null;
    const order = await createOrder(req.user!.id, lines, { ...input, couponCode: input.couponCode || undefined }, {
      quoteForeign: rate ? (total) => ({ currency: "USDT", amount: toUsdt(total, rate) }) : undefined,
    });
    if (input.paymentProvider !== req.user!.preferredPayment) {
      await execute("UPDATE users SET preferred_payment = ? WHERE id = ?", [input.paymentProvider, req.user!.id]);
    }
    if (input.paymentProvider === "wallet") {
      return res.status(201).json({ code: order.code, action: { type: "instructions", text: "Pagado con saldo de la billetera." }, status: order.status });
    }
    let action;
    try {
      action = await adapter.createCheckout({
        code: order.code,
        total: order.total,
        buyerName: input.buyerName,
        buyerEmail: input.buyerEmail,
        buyerPhone: input.buyerPhone,
        buyerDocument: input.buyerDocument,
        foreign: order.foreign,
      });
    } catch (err) {
      console.error("Error creando checkout:", err);
      // El pedido existe y queda pendiente: el cliente puede reintentar el pago desde "Mis pedidos".
      return res.status(201).json({ code: order.code, action: null, warning: "No pudimos conectar con la pasarela. Intenta pagar de nuevo desde tu pedido." });
    }
    res.status(201).json({ code: order.code, action, status: order.status });
  }),
);

/* ---------- Pedidos del cliente ---------- */

shopRouter.get(
  "/orders",
  requireAuth,
  ah(async (req, res) => {
    const filter = (String(req.query.filter ?? "todos") as OrderFilter) in ORDER_FILTERS ? (String(req.query.filter ?? "todos") as OrderFilter) : "todos";
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = 10;
    const { items, total } = await listOrders({
      userId: req.user!.id,
      statuses: ORDER_FILTERS[filter],
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    const counts = await queryOne<{ total: number; completed: number; pending: number }>(
      `SELECT COUNT(*) AS total,
              SUM(status = 'completed') AS completed,
              SUM(status IN ('pending_payment','paid','processing')) AS pending
         FROM orders WHERE user_id = ?`,
      [req.user!.id],
    );
    res.json({
      items,
      total,
      page,
      pageSize,
      counts: { total: Number(counts?.total ?? 0), completed: Number(counts?.completed ?? 0), pending: Number(counts?.pending ?? 0) },
    });
  }),
);

shopRouter.get(
  "/orders/:code",
  requireAuth,
  ah(async (req, res) => {
    const order = await getOrder(String(req.params.code), req.user!.id);
    const reviewed = await query<{ product_id: number }>("SELECT product_id FROM reviews WHERE user_id = ?", [req.user!.id]);
    res.json({ order, reviewedProductIds: reviewed.map((r) => r.product_id) });
  }),
);

shopRouter.post(
  "/orders/:code/cancel",
  requireAuth,
  ah(async (req, res) => {
    const order = await getOrder(String(req.params.code), req.user!.id);
    if (order.status !== "pending_payment") throw conflict("Solo puedes cancelar pedidos pendientes de pago.");
    await changeStatus(order.code, "cancelled", { actor: "customer", userId: req.user!.id, note: "Cancelado por el cliente." });
    res.json({ order: await getOrder(order.code, req.user!.id) });
  }),
);

/** Reintenta el pago de un pedido pendiente (nueva sesión de checkout en la pasarela). */
shopRouter.post(
  "/orders/:code/pay",
  requireAuth,
  ah(async (req, res) => {
    const order = await getOrder(String(req.params.code), req.user!.id);
    if (order.status !== "pending_payment") throw conflict("Este pedido no está pendiente de pago.");
    const adapter = adapters[order.paymentProvider];
    if (!adapter || order.paymentProvider === "wallet" || !(await isProviderReady(order.paymentProvider)).ok) {
      throw badRequest(`${adapter?.label ?? "El método"} no está disponible en este momento.`);
    }
    const foreign = order.paymentCurrency && order.paymentAmountForeign ? { currency: order.paymentCurrency, amount: order.paymentAmountForeign } : null;
    const action = await adapter.createCheckout({ ...order, foreign }).catch((err) => {
      console.error(err);
      throw new HttpError(502, "No pudimos conectar con la pasarela de pago. Inténtalo más tarde.");
    });
    res.json({ action });
  }),
);

/** Consulta activa del pago al volver de la pasarela (no confía en parámetros de la URL). */
shopRouter.post(
  "/orders/:code/verify-payment",
  requireAuth,
  ah(async (req, res) => {
    const order = await getOrder(String(req.params.code), req.user!.id);
    const adapter = adapters[order.paymentProvider];
    let result: string = "skipped";
    if (order.status === "pending_payment" && adapter?.isConfigured() && adapter.verify) {
      const params = z.record(z.string(), z.string().max(100)).catch({}).parse(req.body?.params ?? {});
      try {
        const verified = await adapter.verify(order.code, params);
        if (verified && verified.orderCode === order.code) result = await applyVerifiedPayment(verified);
        else result = "not_found";
      } catch (err) {
        console.error("Error verificando pago:", err);
        result = "error";
      }
    }
    res.json({ result, order: await getOrder(order.code, req.user!.id) });
  }),
);

/** Reporte de cuenta caída desde el detalle del pedido: abre un caso de soporte vinculado. */
shopRouter.post(
  "/orders/:code/items/:itemId/report",
  requireAuth,
  ah(async (req, res) => {
    const data = parse(reportIssueSchema, req.body);
    const id = await reportIssue(req.user!.id, String(req.params.code), Number(req.params.itemId) || 0, data);
    res.status(201).json({ ticketId: id });
  }),
);

/* ---------- Reseñas (solo compradores con pedido completado) ---------- */

shopRouter.post(
  "/products/:id/reviews",
  requireAuth,
  ah(async (req, res) => {
    const productId = Number(req.params.id);
    if (!Number.isInteger(productId)) throw notFound();
    const data = parse(reviewSchema, req.body);
    const bought = await queryOne(
      `SELECT 1 FROM orders o JOIN order_items oi ON oi.order_id = o.id
        WHERE o.user_id = ? AND oi.product_id = ? AND o.status = 'completed' LIMIT 1`,
      [req.user!.id, productId],
    );
    if (!bought) throw new HttpError(403, "Solo puedes calificar productos que hayas recibido.");
    await execute(
      `INSERT INTO reviews (product_id, user_id, rating, comment) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE rating = VALUES(rating), comment = VALUES(comment)`,
      [productId, req.user!.id, data.rating, data.comment],
    );
    res.status(201).json({ ok: true });
  }),
);
