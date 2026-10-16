import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { query, queryOne, toIso, transaction } from "../db.js";
import { badRequest, conflict, HttpError, notFound } from "../lib/http.js";
import { randomToken } from "../lib/security.js";
import { open, sealIfPossible } from "../lib/vault.js";
import { getProductsByIds, getVariants, syncProductFromVariants } from "./catalog.js";
import { deliverReserved, deliveriesFor, releaseReserved, reserveItems } from "./inventory.js";
import { checkLowStock, notify } from "./notifications.js";
import { creditTopup, moveWallet } from "./wallet.js";
import { proofUrlFor } from "./media.js";
import { canTransition, ORDER_STATUS_LABEL, type OrderStatus } from "../../shared/constants.js";
import { computeTotals, formatCOP, type CouponRule } from "../../shared/pricing.js";
import type { CheckoutInput } from "../../shared/schemas.js";
import type { CartLine, Order, ProductSummary, ProductVariant } from "../../shared/types.js";
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

type Resolved = {
  p: ProductSummary & { isActive: boolean };
  v: ProductVariant | null;
  quantity: number;
  price: number;
  stock: number;
};

/**
 * Resuelve cada línea del carrito con su producto y opción. Si el producto tiene opciones, la línea
 * debe traer una opción activa; precio e inventario salen de la opción.
 */
function resolveLine(
  l: CartLine,
  products: Map<number, ProductSummary & { isActive: boolean }>,
  variants: Map<number, ProductVariant[]>,
): Resolved | { error: string } {
  const p = products.get(l.productId);
  if (!p || !p.isActive) return { error: "Uno de los productos ya no está disponible. Revisa tu carrito." };
  const vs = variants.get(p.id) ?? [];
  let v: ProductVariant | null = null;
  if (vs.length) {
    v = vs.find((x) => x.id === l.variantId) ?? null;
    if (!v) return { error: `Elige una opción de ${p.name} en la página del producto.` };
  }
  return { p, v, quantity: l.quantity, price: v?.price ?? p.price, stock: v?.stock ?? p.stock };
}

const displayName = (r: { p: { name: string }; v: { name: string } | null }) => (r.v ? `${r.p.name} (${r.v.name})` : r.p.name);

export async function quoteCart(lines: CartLine[], couponCode?: string) {
  const merged = mergeLines(lines);
  const ids = [...new Set(merged.map((l) => l.productId))];
  const [products, variants] = await Promise.all([getProductsByIds(ids), getVariants(ids)]);
  const items = merged
    .map((l) => {
      const r = resolveLine(l, products, variants);
      if ("error" in r) return null;
      const quantity = Math.min(l.quantity, r.p.maxPerOrder);
      return {
        product: { ...r.p, price: r.price, compareAtPrice: r.v ? r.v.compareAtPrice : r.p.compareAtPrice, stock: r.stock },
        variant: r.v ? { id: r.v.id, name: r.v.name } : null,
        quantity,
        available: r.stock >= quantity,
        lineTotal: r.price * quantity,
      };
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
  const kept = new Set(items.map((i) => `${i.product.id}:${i.variant?.id ?? 0}`));
  return {
    items,
    removed: merged.filter((l) => !kept.has(`${l.productId}:${l.variantId ?? 0}`)).map((l) => l.productId),
    removedLines: merged.filter((l) => !kept.has(`${l.productId}:${l.variantId ?? 0}`)).map((l) => ({ productId: l.productId, variantId: l.variantId ?? null })),
    coupon: coupon ? { code: coupon.code, kind: coupon.kind, value: coupon.value } : null,
    couponError,
    ...totals,
  };
}

/** Une líneas repetidas del mismo producto y opción. */
function mergeLines(lines: CartLine[]): CartLine[] {
  const map = new Map<string, CartLine>();
  for (const l of lines) {
    const key = `${l.productId}:${l.variantId ?? 0}`;
    const prev = map.get(key);
    map.set(key, { productId: l.productId, variantId: l.variantId ?? null, quantity: (prev?.quantity ?? 0) + l.quantity });
  }
  return [...map.values()];
}

/* ---------- Creación de pedidos ---------- */

function newOrderCode(): string {
  const d = new Date();
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  return `NS-${ymd}-${randomToken(3).toUpperCase()}`;
}

export interface ForeignQuote {
  currency: string;
  amount: string;
}

/**
 * Crea el pedido en una transacción: bloquea filas de producto, valida inventario, reserva stock
 * (o cuentas del inventario si la entrega es automática), aplica cupón y registra el evento inicial.
 * Si se paga con billetera, descuenta el saldo y confirma el pago en la misma transacción.
 */
export async function createOrder(
  userId: number,
  lines: CartLine[],
  input: CheckoutInput,
  opts: { quoteForeign?: (totalCop: number) => ForeignQuote | null } = {},
): Promise<{ id: number; code: string; total: number; status: OrderStatus; foreign: ForeignQuote | null }> {
  const merged = mergeLines(lines);
  if (!merged.length) throw badRequest("Tu carrito está vacío.");

  const result = await transaction(async (conn) => {
    const ids = [...new Set(merged.map((l) => l.productId))].sort((a, b) => a - b);
    const products = await getProductsByIds(ids, conn, true);
    const variants = await getVariants(ids, { conn, lock: true });
    const priced = merged.map((l) => {
      const r = resolveLine(l, products, variants);
      if ("error" in r) throw conflict(r.error);
      if (l.quantity > r.p.maxPerOrder) throw conflict(`Puedes comprar máximo ${r.p.maxPerOrder} unidades de ${displayName(r)}.`);
      if (r.stock < l.quantity) throw conflict(`No hay inventario suficiente de ${displayName(r)}. Disponible: ${Math.max(r.stock, 0)}.`);
      return r;
    });

    const subtotal = priced.reduce((s, i) => s + i.price * i.quantity, 0);
    const coupon = input.couponCode ? await findValidCoupon(input.couponCode, subtotal, conn) : null;
    const totals = computeTotals(priced.map((i) => ({ unitPrice: i.price, quantity: i.quantity })), coupon);
    if (totals.total <= 0) throw badRequest("El total del pedido debe ser mayor que cero.");
    const foreign = opts.quoteForeign?.(totals.total) ?? null;

    const code = newOrderCode();
    const [res] = await conn.execute<ResultSetHeader>(
      `INSERT INTO orders (code, user_id, status, payment_provider, subtotal, discount, total, coupon_code,
                           buyer_name, buyer_email, buyer_phone, buyer_document, notes, payment_currency, payment_amount_foreign)
       VALUES (?, ?, 'pending_payment', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [code, userId, input.paymentProvider, totals.subtotal, totals.discount, totals.total, coupon?.code ?? null,
        input.buyerName, input.buyerEmail, input.buyerPhone, input.buyerDocument, input.notes || null,
        foreign?.currency ?? null, foreign?.amount ?? null],
    );
    const orderId = res.insertId;
    for (const r of priced) {
      const { p, v, quantity } = r;
      const [ir] = await conn.execute<ResultSetHeader>(
        `INSERT INTO order_items (order_id, product_id, variant_id, product_name, variant_name, product_summary, art_glyph, art_color, unit_price, quantity)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [orderId, p.id, v?.id ?? null, p.name, v?.name ?? null, p.summary, p.artGlyph, p.artColor, r.price, quantity],
      );
      if (p.deliveryMode === "auto") {
        await reserveItems(conn, p.id, v?.id ?? null, ir.insertId, quantity, displayName(r));
      } else if (v) {
        await conn.execute("UPDATE product_variants SET stock = stock - ? WHERE id = ?", [quantity, v.id]);
      } else {
        await conn.execute("UPDATE products SET stock = stock - ? WHERE id = ?", [quantity, p.id]);
      }
      if (v) await syncProductFromVariants(conn, p.id);
    }
    if (coupon) await conn.execute("UPDATE coupons SET used_count = used_count + 1 WHERE id = ?", [coupon.id]);
    await conn.execute("INSERT INTO order_events (order_id, status, note, actor) VALUES (?, 'pending_payment', ?, 'customer')", [
      orderId,
      "Pedido creado. Esperando confirmación del pago.",
    ]);
    await conn.execute("DELETE FROM cart_items WHERE user_id = ?", [userId]);

    let status: OrderStatus = "pending_payment";
    let effects: PostEffects | null = null;
    if (input.paymentProvider === "wallet") {
      const { txId } = await moveWallet(conn, userId, -totals.total, "purchase", { reference: code, note: `Pago del pedido ${code}`, actor: "customer" });
      effects = await changeStatusTx(conn, code, "paid", { actor: "wallet", paymentRef: `wallet-tx-${txId}`, note: "Pagado con saldo de la billetera." });
      status = effects.finalStatus;
    }
    return { id: orderId, code, total: totals.total, status, foreign, effects, productIds: priced.map((i) => i.p.id) };
  });
  if (result.effects) await runPostEffects(result.effects);
  void checkLowStock(result.productIds).catch(() => undefined);
  return { id: result.id, code: result.code, total: result.total, status: result.status, foreign: result.foreign };
}

/* ---------- Lectura ---------- */

function mapOrder(r: any, items: any[], deliveries: Map<number, any[]>, opts: { events?: any[]; admin?: boolean }): Order {
  const reveal = opts.admin || r.status === "completed";
  return {
    id: r.id,
    code: r.code,
    status: r.status,
    paymentProvider: r.payment_provider,
    paymentRef: r.payment_ref,
    paymentCurrency: r.payment_currency ?? null,
    paymentAmountForeign: r.payment_amount_foreign ? String(Number(r.payment_amount_foreign)) : null,
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
      variantName: i.variant_name ?? null,
      productSummary: i.product_summary,
      artGlyph: i.art_glyph,
      artColor: i.art_color,
      unitPrice: Number(i.unit_price),
      quantity: Number(i.quantity),
      deliveryMode: i.delivery_mode ?? "manual",
      // Las credenciales solo se muestran al cliente cuando el pedido está completado.
      deliveryContent: reveal ? open(i.delivery_content) : null,
      deliveries: (deliveries.get(i.id) ?? []).map((d) => ({ ...d, content: reveal ? d.content : null })),
    })),
    events: opts.events?.map((e) => ({ status: e.status, note: e.note, createdAt: toIso(e.created_at)! })),
  };
}

async function itemsFor(orderIds: number[]) {
  if (!orderIds.length) return new Map<number, any[]>();
  const rows = await query<any>(
    `SELECT oi.*, p.slug AS product_slug, p.delivery_mode FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
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
  const empty = new Map<number, any[]>();
  // En listados no se descifran credenciales.
  return { items: rows.map((r) => mapOrder(r, items.get(r.id) ?? [], empty, { admin: false })).map(stripSecrets), total: Number(total?.n ?? 0) };
}

const stripSecrets = (o: Order): Order => ({ ...o, items: o.items.map((i) => ({ ...i, deliveryContent: null, deliveries: [] })) });

export async function getOrder(code: string, userId?: number, admin = false): Promise<Order> {
  const r = await queryOne<any>(`SELECT * FROM orders WHERE code = ? ${userId ? "AND user_id = ?" : ""}`, userId ? [code, userId] : [code]);
  if (!r) throw notFound("Pedido no encontrado.");
  const items = (await itemsFor([r.id])).get(r.id) ?? [];
  const deliveries = await deliveriesFor(items.map((i) => i.id), true);
  const events = await query<any>("SELECT * FROM order_events WHERE order_id = ? ORDER BY created_at, id", [r.id]);
  const order = mapOrder(r, items, deliveries, { events, admin });
  if (r.payment_provider === "manual") {
    order.proof = {
      url: await proofUrlFor(r.proof_media_id ?? null),
      reference: r.proof_reference ?? null,
      account: r.manual_account ?? null,
      submittedAt: toIso(r.proof_submitted_at),
    };
  }
  return order;
}

/* ---------- Cambios de estado ---------- */

async function releaseStock(conn: PoolConnection, orderId: number) {
  const [rows] = await conn.query<RowDataPacket[]>("SELECT stock_released FROM orders WHERE id = ? FOR UPDATE", [orderId]);
  if (rows[0]?.stock_released) return;
  const [items] = await conn.query<RowDataPacket[]>(
    `SELECT oi.product_id, oi.variant_id, oi.quantity, p.delivery_mode, v.id AS live_variant
       FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id LEFT JOIN product_variants v ON v.id = oi.variant_id
      WHERE oi.order_id = ?`,
    [orderId],
  );
  for (const it of items) {
    if (!it.product_id || it.delivery_mode === "auto") continue;
    if (it.live_variant) await conn.execute("UPDATE product_variants SET stock = stock + ? WHERE id = ?", [it.quantity, it.live_variant]);
    else await conn.execute("UPDATE products SET stock = stock + ? WHERE id = ?", [it.quantity, it.product_id]);
  }
  await releaseReserved(conn, orderId);
  for (const pid of new Set(items.filter((i) => i.variant_id && i.product_id).map((i) => i.product_id as number))) await syncProductFromVariants(conn, pid);
  await conn.execute("UPDATE orders SET stock_released = 1 WHERE id = ?", [orderId]);
}

/** Efectos que se ejecutan después de confirmar la transacción (avisos, correos). */
interface PostEffects {
  code: string;
  userId: number;
  finalStatus: OrderStatus;
  delivered: boolean;
  refundedToWallet?: number;
}

async function runPostEffects(e: PostEffects) {
  if (e.finalStatus === "completed" && e.delivered) {
    await notify({
      audience: "user",
      userId: e.userId,
      kind: "order_delivered",
      title: `Tu pedido ${e.code} está listo`,
      body: "Ya puedes ver los datos de acceso en el detalle del pedido.",
      link: `/cuenta/pedidos/${e.code}`,
      email: true,
    });
  } else if (e.finalStatus === "paid") {
    await notify({ audience: "admin", kind: "order_paid", title: `Pedido ${e.code} pagado: pendiente de entrega`, link: `/admin/pedidos/${e.code}` });
  }
  if (e.refundedToWallet) {
    await notify({
      audience: "user",
      userId: e.userId,
      kind: "wallet",
      title: `Reembolso de ${formatCOP(e.refundedToWallet)} a tu billetera`,
      body: `Pedido ${e.code}.`,
      link: "/cuenta/billetera",
      email: true,
    });
  }
}

export async function changeStatusTx(
  conn: PoolConnection,
  code: string,
  to: OrderStatus,
  opts: { actor: string; note?: string; userId?: number; paymentRef?: string; refundToWallet?: boolean },
): Promise<PostEffects> {
  const [rows] = await conn.query<RowDataPacket[]>(`SELECT id, status, user_id, payment_provider, total FROM orders WHERE code = ? FOR UPDATE`, [code]);
  const o = rows[0];
  if (!o || (opts.userId && o.user_id !== opts.userId)) throw notFound("Pedido no encontrado.");
  const from = o.status as OrderStatus;
  const effects: PostEffects = { code, userId: o.user_id, finalStatus: from, delivered: false };
  if (from === to) return effects;
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
  if (to === "refunded" && opts.refundToWallet) {
    await moveWallet(conn, o.user_id, Number(o.total), "refund", { reference: code, note: `Reembolso del pedido ${code}`, actor: "admin" });
    effects.refundedToWallet = Number(o.total);
  }
  const defaultNotes: Partial<Record<OrderStatus, string>> = {
    paid: "Pago confirmado.",
    processing: "Estamos preparando tu producto.",
    completed: "Producto entregado. Revisa los datos de acceso en el detalle del pedido.",
    cancelled: "Pedido cancelado.",
    refunded: opts.refundToWallet ? "Pago reembolsado a tu billetera." : "Pago reembolsado.",
  };
  await conn.execute("INSERT INTO order_events (order_id, status, note, actor) VALUES (?, ?, ?, ?)", [
    o.id,
    to,
    (opts.note || defaultNotes[to] || "").slice(0, 500),
    opts.actor,
  ]);
  effects.finalStatus = to;

  // Entrega automática: si todo el pedido es de inventario, queda completado al instante.
  if (to === "paid") {
    const allDelivered = await deliverReserved(conn, o.id, o.user_id);
    if (allDelivered) {
      await conn.execute("UPDATE orders SET status = 'completed' WHERE id = ?", [o.id]);
      await conn.execute("INSERT INTO order_events (order_id, status, note, actor) VALUES (?, 'completed', ?, 'system')", [
        o.id,
        "Entrega automática: tus datos de acceso ya están disponibles.",
      ]);
      effects.finalStatus = "completed";
      effects.delivered = true;
    }
  }
  if (to === "completed") effects.delivered = true;
  return effects;
}

export async function changeStatus(
  code: string,
  to: OrderStatus,
  opts: { actor: string; note?: string; userId?: number; paymentRef?: string; refundToWallet?: boolean },
): Promise<void> {
  const effects = await transaction((conn) => changeStatusTx(conn, code, to, opts));
  await runPostEffects(effects).catch((err) => console.error("Error en avisos del pedido:", err));
}

/**
 * Aplica un pago verificado con el proveedor (pedido NS-… o recarga de billetera WT-…).
 * Idempotente. Solo confirma si el monto y la moneda son exactamente los esperados.
 */
export async function applyVerifiedPayment(p: VerifiedPayment): Promise<"paid" | "ignored" | "mismatch" | "recorded"> {
  const isTopup = p.orderCode.startsWith("WT-");
  const target = isTopup
    ? await queryOne<any>("SELECT id, code, status, amount AS total, provider AS payment_provider, payment_currency, payment_amount_foreign FROM wallet_topups WHERE code = ?", [p.orderCode])
    : await queryOne<any>("SELECT id, code, status, total, payment_provider, payment_currency, payment_amount_foreign FROM orders WHERE code = ?", [p.orderCode]);
  let duplicate = false;
  try {
    await query(
      "INSERT INTO payment_events (provider, external_id, order_id, status, amount, payload) VALUES (?, ?, ?, ?, ?, ?)",
      [p.provider, p.externalId, isTopup ? null : target?.id ?? null, p.status, p.currency === "COP" ? p.amount : null, JSON.stringify({ code: p.orderCode, ...(p.raw as object) })],
    );
  } catch (e: any) {
    if (e?.code !== "ER_DUP_ENTRY") throw e;
    duplicate = true;
  }
  const pendingStatus = isTopup ? "pending" : "pending_payment";
  if (!target) return "ignored";
  if (duplicate && !(p.status === "approved" && target.status === pendingStatus)) return "ignored";
  if (target.payment_provider !== p.provider) return "mismatch";
  if (p.status !== "approved") {
    if (p.status === "rejected" && !isTopup && target.status === "pending_payment") {
      await query("INSERT INTO order_events (order_id, status, note, actor) VALUES (?, 'payment_rejected', ?, ?)", [
        target.id,
        "El pago fue rechazado por la pasarela. Puedes intentarlo de nuevo.",
        p.provider,
      ]);
    }
    return "recorded";
  }
  const amountOk =
    p.currency === "COP"
      ? p.amount === Number(target.total)
      : Boolean(target.payment_currency) && p.currency === target.payment_currency && Number(p.foreignAmount) === Number(target.payment_amount_foreign);
  if (!amountOk) {
    const note = `Pago recibido con monto o moneda distintos (${p.currency === "COP" ? p.amount : p.foreignAmount} ${p.currency}). Requiere revisión.`;
    if (!isTopup) await query("INSERT INTO order_events (order_id, status, note, actor) VALUES (?, 'payment_review', ?, ?)", [target.id, note, p.provider]);
    await notify({ audience: "admin", kind: "payment_review", title: `Revisar pago de ${p.orderCode}`, body: note, link: isTopup ? "/admin/billetera" : `/admin/pedidos/${p.orderCode}` });
    return "mismatch";
  }
  if (target.status !== pendingStatus) return "ignored";
  if (isTopup) {
    await creditTopup(p.orderCode, { actor: p.provider, paymentRef: p.externalId });
    return "paid";
  }
  await changeStatus(target.code, "paid", { actor: p.provider, paymentRef: p.externalId, note: `Pago aprobado (${p.provider} #${p.externalId}).` });
  return "paid";
}

export async function setDelivery(code: string, items: { itemId: number; content: string }[]): Promise<void> {
  const order = await queryOne<any>("SELECT id, status FROM orders WHERE code = ?", [code]);
  if (!order) throw notFound("Pedido no encontrado.");
  if (!["paid", "processing", "completed"].includes(order.status)) throw conflict("Solo se puede entregar un pedido pagado.");
  for (const it of items) {
    await query("UPDATE order_items SET delivery_content = ? WHERE id = ? AND order_id = ?", [sealIfPossible(it.content.trim() || null), it.itemId, order.id]);
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
  await query("UPDATE wallet_topups SET status = 'cancelled' WHERE status = 'pending' AND created_at < (UTC_TIMESTAMP() - INTERVAL ? HOUR)", [hours]);
  return rows.length;
}
