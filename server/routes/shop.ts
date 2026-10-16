/** Carrito (persistente por usuario), cotización, checkout y pedidos del cliente. */
import { Router } from "express";
import { z } from "zod";
import { execute, query, queryOne, transaction } from "../db.js";
import { ah, badRequest, conflict, HttpError, notFound, parse } from "../lib/http.js";
import { requireAuth } from "../middleware/session.js";
import { adapters, foreignQuoteFor, isProviderReady } from "../payments/index.js";
import { applyVerifiedPayment, changeStatus, createOrder, getOrder, listOrders, quoteCart } from "../services/orders.js";
import { ORDER_FILTERS, type OrderFilter } from "../../shared/constants.js";
import { cartLineSchema, cartSyncSchema, checkoutSchema, couponCodeSchema, paymentProofSchema, reportIssueSchema, reviewSchema } from "../../shared/schemas.js";
import { formatCOP } from "../../shared/pricing.js";
import { ownedProofId } from "../services/media.js";
import { accountSnapshot, findManualAccount } from "../services/manual-pay.js";
import { notify } from "../services/notifications.js";
import { reportIssue } from "../services/support.js";

export const shopRouter = Router();

/* ---------- Carrito ---------- */

async function readCart(userId: number) {
  const rows = await query<{ productId: number; variantId: number; quantity: number }>(
    "SELECT product_id AS productId, variant_id AS variantId, quantity FROM cart_items WHERE user_id = ? ORDER BY updated_at",
    [userId],
  );
  return rows.map((r) => ({ productId: r.productId, quantity: r.quantity, variantId: r.variantId || null }));
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
          `INSERT INTO cart_items (user_id, product_id, variant_id, quantity)
           SELECT ?, p.id, ?, LEAST(?, p.max_per_order) FROM products p WHERE p.id = ? AND p.is_active = 1
              AND (? = 0 OR EXISTS (SELECT 1 FROM product_variants v WHERE v.id = ? AND v.product_id = p.id AND v.is_active = 1))
           ON DUPLICATE KEY UPDATE quantity = LEAST(${mode === "merge" ? "quantity + VALUES(quantity)" : "VALUES(quantity)"}, 10)`,
          [userId, it.variantId ?? 0, it.quantity, it.productId, it.variantId ?? 0, it.variantId ?? 0],
        );
      }
    });
    res.json({ items: await readCart(userId) });
  }),
);

/** El cliente envía el comprobante de su pago por transferencia; un administrador lo revisa. */
shopRouter.post(
  "/orders/:code/proof",
  requireAuth,
  ah(async (req, res) => {
    const d = parse(paymentProofSchema, req.body);
    const code = String(req.params.code);
    const o = await queryOne<{ id: number; status: string; payment_provider: string; total: number }>(
      "SELECT id, status, payment_provider, total FROM orders WHERE code = ? AND user_id = ?",
      [code, req.user!.id],
    );
    if (!o) throw notFound("Pedido no encontrado.");
    if (o.payment_provider !== "manual" || o.status !== "pending_payment") throw conflict("Este pedido no espera un comprobante de transferencia.");
    const account = await findManualAccount(d.accountId);
    if (!account) throw badRequest("Elige una de las cuentas disponibles.", { accountId: "Cuenta no disponible." });
    const mediaId = await ownedProofId(d.proofUrl, req.user!.id);
    if (!mediaId) throw badRequest("Sube de nuevo la imagen del comprobante.", { proofUrl: "Comprobante no válido." });
    await execute(
      "UPDATE orders SET proof_media_id = ?, proof_reference = ?, manual_account = ?, proof_submitted_at = UTC_TIMESTAMP() WHERE id = ?",
      [mediaId, d.reference, accountSnapshot(account), o.id],
    );
    await execute("INSERT INTO order_events (order_id, status, note, actor) VALUES (?, 'pending_payment', ?, 'customer')", [
      o.id,
      `Comprobante enviado (${accountSnapshot(account)} · ref. ${d.reference}). En revisión.`,
    ]);
    await notify({
      audience: "admin",
      kind: "payment_proof",
      title: `Comprobante por revisar: pedido ${code}`,
      body: `${req.user!.name} · ${formatCOP(Number(o.total))} · ${account.label} · ref. ${d.reference}`,
      link: `/admin/pedidos/${code}`,
      email: true,
    });
    res.json({ order: await getOrder(code, req.user!.id) });
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
      items: q.items.map((i) => ({ product: i.product, variant: i.variant, quantity: i.quantity, available: i.available, lineTotal: i.lineTotal })),
      removed: q.removed,
      removedLines: q.removedLines,
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
    const order = await createOrder(req.user!.id, lines, { ...input, couponCode: input.couponCode || undefined }, {
      quoteForeign: await foreignQuoteFor(input.paymentProvider),
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
    if (action.type === "redirect" && action.externalRef) {
      await execute("UPDATE orders SET payment_ref = ? WHERE code = ?", [action.externalRef, order.code]);
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
    if (action.type === "redirect" && action.externalRef) {
      await execute("UPDATE orders SET payment_ref = ? WHERE code = ?", [action.externalRef, order.code]);
    }
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
        const verified = await adapter.verify(order.code, params, order.paymentRef);
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
