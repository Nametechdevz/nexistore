/**
 * Inventario de cuentas para productos con entrega automática.
 * Ciclo: disponible → reservada (pedido creado) → vendida (pago confirmado) → vencida / caída.
 * El "stock" del producto es siempre el número de cuentas disponibles.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { query, queryOne, toIso } from "../db.js";
import { conflict, notFound } from "../lib/http.js";
import { open, seal } from "../lib/vault.js";
import { notify } from "./notifications.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function syncAutoStock(conn: PoolConnection, productId: number) {
  await conn.execute(
    `UPDATE products SET stock = (SELECT COUNT(*) FROM inventory_items WHERE product_id = ? AND status = 'available')
      WHERE id = ? AND delivery_mode = 'auto'`,
    [productId, productId],
  );
}

/**
 * Reserva N cuentas disponibles para un ítem de pedido. Con opción, usa primero las cuentas de esa
 * opción y luego las compartidas (sin opción). Prefiere las de vencimiento más lejano.
 */
export async function reserveItems(conn: PoolConnection, productId: number, variantId: number | null, orderItemId: number, qty: number, productName: string) {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT id FROM inventory_items
      WHERE product_id = ? AND status = 'available'
        ${variantId ? "AND (variant_id = ? OR variant_id IS NULL)" : ""}
        AND (expires_at IS NULL OR expires_at > (UTC_TIMESTAMP() + INTERVAL 1 DAY))
      ORDER BY (variant_id IS NULL), (expires_at IS NULL) DESC, expires_at DESC, id
      LIMIT ? FOR UPDATE`,
    variantId ? [productId, variantId, qty] : [productId, qty],
  );
  if (rows.length < qty) throw conflict(`No hay cuentas disponibles suficientes de ${productName}. Disponibles: ${rows.length}.`);
  const ids = rows.map((r) => r.id as number);
  await conn.query(`UPDATE inventory_items SET status = 'reserved', order_item_id = ? WHERE id IN (${ids.map(() => "?").join(",")})`, [orderItemId, ...ids]);
  await syncAutoStock(conn, productId);
}

/** Devuelve al inventario las cuentas reservadas de un pedido cancelado. */
export async function releaseReserved(conn: PoolConnection, orderId: number) {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT i.id, i.product_id FROM inventory_items i JOIN order_items oi ON oi.id = i.order_item_id
      WHERE oi.order_id = ? AND i.status = 'reserved' FOR UPDATE`,
    [orderId],
  );
  if (!rows.length) return;
  await conn.query(`UPDATE inventory_items SET status = 'available', order_item_id = NULL WHERE id IN (${rows.map(() => "?").join(",")})`, rows.map((r) => r.id));
  for (const pid of new Set(rows.map((r) => r.product_id as number))) await syncAutoStock(conn, pid);
}

/**
 * Entrega automática al confirmarse el pago: las cuentas reservadas pasan a vendidas, se fija el
 * fin del servicio según la duración del producto. Devuelve true si TODO el pedido quedó entregado.
 */
export async function deliverReserved(conn: PoolConnection, orderId: number, customerId: number): Promise<boolean> {
  const [items] = await conn.query<RowDataPacket[]>(
    `SELECT oi.id, oi.quantity, oi.delivery_content, p.delivery_mode, COALESCE(v.duration_days, p.duration_days) AS duration_days
       FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id LEFT JOIN product_variants v ON v.id = oi.variant_id
      WHERE oi.order_id = ?`,
    [orderId],
  );
  let allDelivered = items.length > 0;
  for (const it of items) {
    if (it.delivery_mode !== "auto") {
      if (!it.delivery_content) allDelivered = false;
      continue;
    }
    await conn.execute(
      `UPDATE inventory_items SET status = 'sold', customer_id = ?, sold_at = UTC_TIMESTAMP(),
              service_ends_at = IF(? IS NULL, expires_at, UTC_TIMESTAMP() + INTERVAL ? DAY)
        WHERE order_item_id = ? AND status = 'reserved'`,
      [customerId, it.duration_days ?? null, it.duration_days ?? 0, it.id],
    );
    const [[{ n }]] = (await conn.query("SELECT COUNT(*) AS n FROM inventory_items WHERE order_item_id = ? AND status = 'sold'", [it.id])) as unknown as [[{ n: number }]];
    if (Number(n) < Number(it.quantity)) allDelivered = false;
  }
  return allDelivered;
}

/** Cuentas entregadas de un ítem de pedido (con credenciales descifradas si se piden). */
export async function deliveriesFor(orderItemIds: number[], reveal: boolean) {
  if (!orderItemIds.length) return new Map<number, any[]>();
  const rows = await query<any>(
    `SELECT id, order_item_id, content, status, service_ends_at, sold_at FROM inventory_items
      WHERE order_item_id IN (${orderItemIds.map(() => "?").join(",")}) AND status IN ('sold','expired','fallen')
      ORDER BY status = 'fallen', id`,
    orderItemIds,
  );
  const map = new Map<number, any[]>();
  for (const r of rows) {
    const list = map.get(r.order_item_id) ?? [];
    list.push({
      id: r.id,
      status: r.status,
      content: reveal && r.status !== "fallen" ? open(r.content) : null,
      serviceEndsAt: toIso(r.service_ends_at),
      soldAt: toIso(r.sold_at),
    });
    map.set(r.order_item_id, list);
  }
  return map;
}

/**
 * Reemplaza una cuenta caída por otra disponible del mismo producto. Conserva el fin del servicio
 * del cliente. Lanza 409 si no hay reemplazo disponible.
 */
export async function replaceItem(conn: PoolConnection, itemId: number, note: string): Promise<{ newId: number; orderCode: string; customerId: number; productName: string }> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT i.*, p.name, o.code AS order_code, o.id AS order_id, oi.variant_id AS order_variant_id FROM inventory_items i
       JOIN products p ON p.id = i.product_id
       LEFT JOIN order_items oi ON oi.id = i.order_item_id LEFT JOIN orders o ON o.id = oi.order_id
      WHERE i.id = ? FOR UPDATE`,
    [itemId],
  );
  const old = rows[0];
  if (!old) throw notFound("Cuenta no encontrada.");
  if (!["sold", "fallen"].includes(old.status) || !old.order_item_id || !old.customer_id) {
    throw conflict("Solo se puede reemplazar una cuenta vendida a un cliente.");
  }
  const [cands] = await conn.query<RowDataPacket[]>(
    `SELECT id FROM inventory_items WHERE product_id = ? AND status = 'available'
       ${old.order_variant_id ? "AND (variant_id = ? OR variant_id IS NULL)" : ""}
       AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP())
     ORDER BY (variant_id IS NULL), (expires_at IS NULL) DESC, expires_at DESC, id LIMIT 1 FOR UPDATE`,
    old.order_variant_id ? [old.product_id, old.order_variant_id] : [old.product_id],
  );
  const next = cands[0];
  if (!next) throw conflict(`No hay cuentas disponibles de ${old.name} para reemplazar. Agrega inventario o reembolsa a la billetera.`);
  await conn.execute(
    `UPDATE inventory_items SET status = 'sold', order_item_id = ?, customer_id = ?, sold_at = UTC_TIMESTAMP(), service_ends_at = ? WHERE id = ?`,
    [old.order_item_id, old.customer_id, old.service_ends_at, next.id],
  );
  await conn.execute("UPDATE inventory_items SET status = 'fallen', replaced_by = ?, notes = LEFT(CONCAT(notes, ' ', ?), 500) WHERE id = ?", [next.id, note, itemId]);
  await syncAutoStock(conn, old.product_id);
  if (old.order_id) {
    await conn.execute("INSERT INTO order_events (order_id, status, note, actor) VALUES (?, 'account_replaced', ?, 'admin')", [
      old.order_id,
      `Cuenta de ${old.name} reemplazada por falla. Revisa los nuevos datos de acceso.`,
    ]);
  }
  return { newId: next.id, orderCode: old.order_code, customerId: old.customer_id, productName: old.name };
}

/** Marca una cuenta como caída. Si estaba vendida, avisa al cliente y abre un caso de soporte. */
export async function markFallen(conn: PoolConnection, itemId: number, note: string) {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT i.*, p.name, o.code AS order_code, o.id AS order_id FROM inventory_items i JOIN products p ON p.id = i.product_id
       LEFT JOIN order_items oi ON oi.id = i.order_item_id LEFT JOIN orders o ON o.id = oi.order_id WHERE i.id = ? FOR UPDATE`,
    [itemId],
  );
  const it = rows[0];
  if (!it) throw notFound("Cuenta no encontrada.");
  await conn.execute("UPDATE inventory_items SET status = 'fallen', notes = LEFT(CONCAT(notes, ' ', ?), 500) WHERE id = ?", [note, itemId]);
  await syncAutoStock(conn, it.product_id);
  if (it.status === "sold" && it.order_id) {
    await conn.execute("INSERT INTO order_events (order_id, status, note, actor) VALUES (?, 'account_issue', ?, 'admin')", [
      it.order_id,
      `Detectamos una falla en tu cuenta de ${it.name}. Estamos gestionando el reemplazo.`,
    ]);
  }
  return it as { status: string; customer_id: number | null; order_code: string | null; order_item_id: number | null; name: string; product_id: number };
}

export function sealContent(content: string) {
  return seal(content.trim());
}

export async function inventorySummary() {
  return query<any>(
    `SELECT p.id, p.name, p.slug, p.art_glyph, p.art_color, p.low_stock_threshold, c.color AS category_color,
            SUM(i.status = 'available') AS available, SUM(i.status = 'reserved') AS reserved, SUM(i.status = 'sold') AS sold,
            SUM(i.status = 'fallen') AS fallen, SUM(i.status = 'expired') AS expired,
            SUM(i.status IN ('available','sold') AND i.expires_at IS NOT NULL AND i.expires_at <= UTC_TIMESTAMP() + INTERVAL 7 DAY) AS expiring
       FROM products p JOIN categories c ON c.id = p.category_id
       LEFT JOIN inventory_items i ON i.product_id = p.id
      WHERE p.delivery_mode = 'auto'
      GROUP BY p.id ORDER BY p.name`,
  );
}

export async function getItemOwner(itemId: number) {
  return queryOne<{ customer_id: number | null }>("SELECT customer_id FROM inventory_items WHERE id = ?", [itemId]);
}

export async function notifyReplacement(customerId: number, productName: string, orderCode: string) {
  await notify({
    audience: "user",
    userId: customerId,
    kind: "account_replaced",
    title: `Reemplazamos tu cuenta de ${productName}`,
    body: `Ya tienes nuevos datos de acceso en el pedido ${orderCode}.`,
    link: `/cuenta/pedidos/${orderCode}`,
    email: true,
  });
}
