import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { query, queryOne, toIso, transaction } from "../db.js";
import { badRequest, conflict, HttpError, notFound } from "../lib/http.js";
import { randomToken } from "../lib/security.js";
import { getProductsByIds } from "./catalog.js";
import { canTransition, ORDER_STATUS_LABEL, type OrderStatus, type PaymentProvider } from "../../shared/constants.js";
import { computeTotals, type CouponRule } from "../../shared/pricing.js";
import type { CheckoutInput } from "../../shared/schemas.js";
import type { CartLine, Order } from "../../shared/types.js";
import type { VerifiedPayment } from "../payments/types.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

/* ---------- Cupones ---------- */

export async function findValidCoupon(code: string, subtotal: number, conn?: PoolConnection): Promise<CouponRule & { id: number }> {
  const sql = `SELECT * FROM coupons WHERE code = ? ${conn ? "FOR UPDATE" : ""}`;
  const c = conn ? ((await conn.query<RowDataPacket[]>(sql, [code]))[0][0] as any) : await queryOne<any>(sql, [code]);
  const now = Date.now();
  if (!c || !c.is_active) throw badRequest("El cupón no existe o no está activo.", { couponCode: "El cupón no existe o no está activo." });
  if (c.starts_at && new Date(c.starts_at).getTime() > now) throw badRequest("El cupón aún no está vigente.", { couponCode: "El cupón aún no está vigente." });
  if (c.ends_at && new Date(c.ends_at).getTime() < now) throw badRequest("El cupón ya expiró.", { couponCode: "El cupón ya expiró." });
  if (c.max_uses !== null && c.used_count >= c.max_uses) throw badRequest("El cupón alcanzó su límite de usos.", { couponCode: "El cupón alcanzó su límite de usos." });
  if (subtotal < c.min_subtotal) {
    const msg = `Este cupón requiere una compra mínima de $${Number(c.min_subtotal).toLocaleString("es-CO")}.`;
    throw badRequest(msg, { couponCode: msg });
  }
  return { id: c.id, code: c.code, kind: c.kind, value: Number(c.value), minSubtotal: Number(c.min_subtotal) };
}

/* ---------- Cotización del carrito (precios siempre del servidor) ---------- */

export async function quoteCart(lines: CartLine[], couponCode?: string) {
  const merged = mergeLines(lines);
  const products = await getProductsByIds(merged.map((l) => l.productId));
  const items = merged
    .map((l) => {
      const p = products.get(l.productId);
      if (!p || !p.isActive) return null;
      const quantity = Math.min(l.quantity, p.maxPerOrder);
      return { product: p, quantity, available: p.stock >= quantity, lineTotal: p.price * quantity };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  const base = computeTotals(items.map((i) => ({ unitPrice: i.product.price, quantity: i.quantity })));
  let coupon: (CouponRule & { id: number }) | null = null;
  let couponError: string | null = null;
  if (couponCode) {
    try {
      coupon = await findValidCoupon(couponCode, base.subtotal);
    } catch (e) {
      couponError = e instanceof HttpError ? e.message : "Cupón inválido.";
    }
  }
  const totals = computeTotals(items.map((i) => ({ unitPrice: i.product.price, quantity: i.quantity })), coupon);
  return {
    items,
    removed: merged.filter((l) => !items.some((i) => i.product.id === l.productId)).map((l) => l.productId),
    coupon: coupon ? { code: coupon.code, kind: coupon.kind, value: coupon.value } : null,
    couponError,
    ...totals,
  };
}

function mergeLines(lines: CartLine[]): CartLine[] {
  const map = new Map<number, number>();
  for (const l of lines) map.set(l.productId, (map.get(l.productId) ?? 0) + l.quantity);
  return [...map].map(([productId, quantity]) => ({ productId, quantity }));
}

/* ---------- Creación de pedidos ---------- */

function newOrderCode(): string {
  const d = new Date();
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  return `NS-${ymd}-${randomToken(3).toUpperCase()}`;
}

/**
 * Crea el pedido en una transacción: bloquea filas de producto, valida inventario,
 * reserva stock, aplica cupón y registra el evento inicial. Los precios vienen de la BD.
 */
export async function createOrder(userId: number, lines: CartLine[], input: CheckoutInput): Promise<{ id: number; code: string; total: number }> {
  const merged = mergeLines(lines);
  if (!merged.length) throw badRequest("Tu carrito está vacío.");

  return transaction(async (conn) => {
    const ids = merged.map((l) => l.productId).sort((a, b) => a - b);
    const products = await getProductsByIds(ids, conn, true);
    const priced = merged.map((l) => {
      const p = products.get(l.productId);
      if (!p || !p.isActive) throw conflict("Uno de los productos ya no está disponible. Revisa tu carrito.");
      if (l.quantity > p.maxPerOrder) throw conflict(`Puedes comprar máximo ${p.maxPerOrder} unidades de ${p.name}.`);
      if (p.stock < l.quantity) throw conflict(`No hay inventario suficiente de ${p.name}. Disponible: ${Math.max(p.stock, 0)}.`);
      return { p, quantity: l.quantity };
    });

    const subtotal = priced.reduce((s, i) => s + i.p.price * i.quantity, 0);
    const coupon = input.couponCode ? await findValidCoupon(input.couponCode, subtotal, conn) : null;
    const totals = computeTotals(priced.map((i) => ({ unitPrice: i.p.price, quantity: i.quantity })), coupon);
    if (totals.total <= 0) throw badRequest("El total del pedido debe ser mayor que cero.");

    const code = newOrderCode();
    const [res] = await conn.execute<import("mysql2").ResultSetHeader>(
      `INSERT INTO orders (code, user_id, status, payment_provider, subtotal, discount, total, coupon_code,
                           buyer_name, buyer_email, buyer_phone, buyer_document, notes)
       VALUES (?, ?, 'pending_payment', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [code, userId, input.paymentProvider, totals.subtotal, totals.discount, totals.total, coupon?.code ?? null,
        input.buyerName, input.buyerEmail, input.buyerPhone, input.buyerDocument, input.notes || null],
    );
    const orderId = res.insertId;
    for (const { p, quantity } of priced) {
      await conn.execute(
        `INSERT INTO order_items (order_id, product_id, product_name, product_summary, art_glyph, art_color, unit_price, quantity)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [orderId, p.id, p.name, p.summary, p.artGlyph, p.artColor, p.price, quantity],
      );
      await conn.execute("UPDATE products SET stock = stock - ? WHERE id = ?", [quantity, p.id]);
    }
    if (coupon) await conn.execute("UPDATE coupons SET used_count = used_count + 1 WHERE id = ?", [coupon.id]);
    await conn.execute("INSERT INTO order_events (order_id, status, note, actor) VALUES (?, 'pending_payment', ?, 'customer')", [
      orderId,
      "Pedido creado. Esperando confirmación del pago.",
    ]);
    await conn.execute("DELETE FROM cart_items WHERE user_id = ?", [userId]);
    return { id: orderId, code, total: totals.total };
  });
}

/* ---------- Lectura ---------- */

function mapOrder(r: any, items: any[], events?: any[]): Order {
  return {
    id: r.id,
    code: r.code,
    status: r.status,
    paymentProvider: r.payment_provider,
    paymentRef: r.payment_ref,
    subtotal: Number(r.subtotal),
    discount: Number(r.discount),
    total: Number(r.total),
    couponCode: r.coupon_code,
    buyerName: r.buyer_name,
    buyerEmail: r.buyer_email,
    buyerPhone: r.buyer_phone,
    buyerDocument: r.buyer_document,
    createdAt: toIso(r.created_at)!,
    paidAt: toIso(r.paid_at),
    customerId: r.user_id,
    items: items.map((i) => ({
      id: i.id,
      productId: i.product_id,
      productSlug: i.product_slug ?? null,
      productName: i.product_name,
      productSummary: i.product_summary,
      artGlyph: i.art_glyph,
      artColor: i.art_color,
      unitPrice: Number(i.unit_price),
      quantity: Number(i.quantity),
      // El contenido de entrega solo se muestra cuando el pedido está completado.
      deliveryContent: r.status === "completed" ? i.delivery_content : null,
    })),
    events: events?.map((e) => ({ status: e.status, note: e.note, createdAt: toIso(e.created_at)! })),
  };
}

async function itemsFor(orderIds: number[]) {
  if (!orderIds.length) return new Map<number, any[]>();
  const rows = await query<any>(
    `SELECT oi.*, p.slug AS product_slug FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id IN (${orderIds.map(() => "?").join(",")}) ORDER BY oi.id`,
    orderIds,
  );
  const map = new Map<number, any[]>();
  for (const r of rows) map.set(r.order_id, [...(map.get(r.order_id) ?? []), r]);
  return map;
}

export async function listOrders(opts: { userId?: number; statuses?: readonly string[] | null; q?: string; limit: number; offset: number }) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.userId) {
    where.push("o.user_id = ?");
    params.push(opts.userId);
  }
  if (opts.statuses?.length) {
    where.push(`o.status IN (${opts.statuses.map(() => "?").join(",")})`);
    params.push(...opts.statuses);
  }
  if (opts.q) {
    where.push("(o.code LIKE ? OR o.buyer_name LIKE ? OR o.buyer_email LIKE ?)");
    const like = `%${opts.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    params.push(like, like, like);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = await query<any>(`SELECT o.* FROM orders o ${w} ORDER BY o.created_at DESC, o.id DESC LIMIT ? OFFSET ?`, [...params, opts.limit, opts.offset]);
  const total = await queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM orders o ${w}`, params);
  const items = await itemsFor(rows.map((r) => r.id));
  return { items: rows.map((r) => mapOrder(r, items.get(r.id) ?? [])), total: Number(total?.n ?? 0) };
}

export async function getOrder(code: string, userId?: number, withRawDelivery = false): Promise<Order> {
  const r = await queryOne<any>(`SELECT * FROM orders WHERE code = ? ${userId ? "AND user_id = ?" : ""}`, userId ? [code, userId] : [code]);
  if (!r) throw notFound("Pedido no encontrado.");
  const items = await itemsFor([r.id]);
  const events = await query<any>("SELECT * FROM order_events WHERE order_id = ? ORDER BY created_at, id", [r.id]);
  const order = mapOrder(r, items.get(r.id) ?? [], events);
  if (withRawDelivery) {
    for (const it of order.items) it.deliveryContent = (items.get(r.id) ?? []).find((x) => x.id === it.id)?.delivery_content ?? null;
  }
  return order;
}

/* ---------- Cambios de estado ---------- */

async function releaseStock(conn: PoolConnection, orderId: number) {
  const [rows] = await conn.query<RowDataPacket[]>("SELECT stock_released FROM orders WHERE id = ? FOR UPDATE", [orderId]);
  if (rows[0]?.stock_released) return;
  const [items] = await conn.query<RowDataPacket[]>("SELECT product_id, quantity FROM order_items WHERE order_id = ?", [orderId]);
  for (const it of items) {
    if (it.product_id) await conn.execute("UPDATE products SET stock = stock + ? WHERE id = ?", [it.quantity, it.product_id]);
  }
  await conn.execute("UPDATE orders SET stock_released = 1 WHERE id = ?", [orderId]);
}

export async function changeStatus(
  code: string,
  to: OrderStatus,
  opts: { actor: "admin" | "customer" | "system" | PaymentProvider; note?: string; userId?: number; paymentRef?: string },
): Promise<void> {
  await transaction(async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>(`SELECT id, status, user_id, payment_provider FROM orders WHERE code = ? FOR UPDATE`, [code]);
    const o = rows[0];
    if (!o || (opts.userId && o.user_id !== opts.userId)) throw notFound("Pedido no encontrado.");
    const from = o.status as OrderStatus;
    if (from === to) return;
    if (!canTransition(from, to)) {
      throw conflict(`No se puede pasar de "${ORDER_STATUS_LABEL[from]}" a "${ORDER_STATUS_LABEL[to]}".`);
    }
    // Un administrador solo puede marcar como pagado un pedido de transferencia manual.
    // Los pagos de pasarela solo se confirman con eventos verificados del proveedor.
    if (to === "paid" && opts.actor === "admin" && o.payment_provider !== "manual") {
      throw new HttpError(403, "Los pagos de pasarela se confirman automáticamente con la notificación verificada del proveedor.");
    }
    if (to === "paid") {
      await conn.execute("UPDATE orders SET status = 'paid', paid_at = UTC_TIMESTAMP(), payment_ref = COALESCE(?, payment_ref) WHERE id = ?", [opts.paymentRef ?? null, o.id]);
      const [its] = await conn.query<RowDataPacket[]>("SELECT product_id, quantity FROM order_items WHERE order_id = ?", [o.id]);
      for (const it of its) if (it.product_id) await conn.execute("UPDATE products SET sales_count = sales_count + ? WHERE id = ?", [it.quantity, it.product_id]);
    } else {
      await conn.execute("UPDATE orders SET status = ? WHERE id = ?", [to, o.id]);
    }
    if (to === "cancelled") await releaseStock(conn, o.id);
    const defaultNotes: Partial<Record<OrderStatus, string>> = {
      paid: "Pago confirmado.",
      processing: "Estamos preparando tu producto.",
      completed: "Producto entregado. Revisa los datos de acceso en el detalle del pedido.",
      cancelled: "Pedido cancelado.",
      refunded: "Pago reembolsado.",
    };
    await conn.execute("INSERT INTO order_events (order_id, status, note, actor) VALUES (?, ?, ?, ?)", [
      o.id,
      to,
      (opts.note || defaultNotes[to] || "").slice(0, 500),
      opts.actor,
    ]);
  });
}

/**
 * Aplica un pago verificado con el proveedor. Idempotente: el mismo evento no se procesa dos veces.
 * Solo marca como pagado si el pedido está pendiente, el proveedor coincide y el monto y la moneda
 * son exactamente los del pedido.
 */
export async function applyVerifiedPayment(p: VerifiedPayment): Promise<"paid" | "ignored" | "mismatch" | "recorded"> {
  const order = await queryOne<any>("SELECT id, code, status, total, payment_provider FROM orders WHERE code = ?", [p.orderCode]);
  let duplicate = false;
  try {
    await query(
      "INSERT INTO payment_events (provider, external_id, order_id, status, amount, payload) VALUES (?, ?, ?, ?, ?, ?)",
      [p.provider, p.externalId, order?.id ?? null, p.status, p.amount, JSON.stringify(p.raw)],
    );
  } catch (e: any) {
    if (e?.code !== "ER_DUP_ENTRY") throw e;
    duplicate = true;
  }
  if (!order) return "ignored";
  // Evento repetido: solo se reintenta la confirmación (por si el primer intento falló a mitad).
  if (duplicate && !(p.status === "approved" && order.status === "pending_payment")) return "ignored";
  if (order.payment_provider !== p.provider) return "mismatch";
  if (p.status !== "approved") {
    if (p.status === "rejected" && order.status === "pending_payment") {
      await query("INSERT INTO order_events (order_id, status, note, actor) VALUES (?, 'payment_rejected', ?, ?)", [
        order.id,
        "El pago fue rechazado por la pasarela. Puedes intentarlo de nuevo.",
        p.provider,
      ]);
    }
    return "recorded";
  }
  if (p.currency !== "COP" || p.amount !== Number(order.total)) {
    await query("INSERT INTO order_events (order_id, status, note, actor) VALUES (?, 'payment_review', ?, ?)", [
      order.id,
      `Pago recibido con monto o moneda distintos (${p.amount} ${p.currency}). Requiere revisión.`,
      p.provider,
    ]);
    return "mismatch";
  }
  if (order.status !== "pending_payment") return "ignored";
  await changeStatus(order.code, "paid", { actor: p.provider, paymentRef: p.externalId, note: `Pago aprobado (${p.provider} #${p.externalId}).` });
  return "paid";
}

export async function setDelivery(code: string, items: { itemId: number; content: string }[]): Promise<void> {
  const order = await queryOne<any>("SELECT id, status FROM orders WHERE code = ?", [code]);
  if (!order) throw notFound("Pedido no encontrado.");
  if (!["paid", "processing", "completed"].includes(order.status)) throw conflict("Solo se puede entregar un pedido pagado.");
  for (const it of items) {
    await query("UPDATE order_items SET delivery_content = ? WHERE id = ? AND order_id = ?", [it.content || null, it.itemId, order.id]);
  }
}

/** Cancela pedidos sin pagar con más de N horas y libera su inventario. */
export async function expireStaleOrders(hours = 48): Promise<number> {
  const rows = await query<{ code: string }>(
    "SELECT code FROM orders WHERE status = 'pending_payment' AND created_at < (UTC_TIMESTAMP() - INTERVAL ? HOUR) LIMIT 200",
    [hours],
  );
  for (const r of rows) {
    await changeStatus(r.code, "cancelled", { actor: "system", note: "Cancelado automáticamente por falta de pago." }).catch(() => undefined);
  }
  return rows.length;
}
