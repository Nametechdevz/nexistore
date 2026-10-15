import { config } from "../config.js";
import { execute, query, queryOne, toBool, toIso } from "../db.js";
import { sendMail } from "./mailer.js";
import { DEFAULT_STORE, getSetting } from "./settings.js";
import { EXPIRY_WARNING_DAYS } from "../../shared/constants.js";

export interface NotifyInput {
  audience: "user" | "admin";
  userId?: number | null;
  kind: string;
  title: string;
  body?: string;
  link?: string | null;
  /** Evita duplicados: la misma clave solo genera una notificación. */
  dedupeKey?: string;
  /** Además envía correo (al cliente, o al correo de soporte para alertas de administración). */
  email?: boolean;
}

/** Crea una notificación en la tienda (y opcionalmente un correo). Devuelve false si ya existía. */
export async function notify(n: NotifyInput): Promise<boolean> {
  const res = await execute(
    `INSERT IGNORE INTO notifications (audience, user_id, kind, title, body, link, dedupe_key) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [n.audience, n.audience === "user" ? n.userId ?? null : null, n.kind, n.title.slice(0, 160), (n.body ?? "").slice(0, 500), n.link ?? null, n.dedupeKey ?? null],
  );
  if (!res.affectedRows) return false;
  if (n.email) {
    let to: string | undefined;
    if (n.audience === "user" && n.userId) {
      to = (await queryOne<{ email: string }>("SELECT email FROM users WHERE id = ?", [n.userId]))?.email;
    } else {
      to = (await getSetting("store", DEFAULT_STORE)).supportEmail;
    }
    if (to) {
      const link = n.link ? `\n\n${config.appUrl}${n.link}` : "";
      // El correo es un aviso adicional: si falla, la notificación en la tienda ya existe.
      sendMail(to, n.title, `${n.body ?? ""}${link}`).catch((err) => console.error("No se pudo enviar el correo de notificación:", err));
    }
  }
  return true;
}

export async function listNotifications(audience: "user" | "admin", userId: number | null, limit = 20) {
  const rows = await query<Record<string, unknown>>(
    `SELECT id, kind, title, body, link, read_at, created_at FROM notifications
      WHERE audience = ? ${audience === "user" ? "AND user_id = ?" : ""}
      ORDER BY created_at DESC, id DESC LIMIT ?`,
    audience === "user" ? [audience, userId ?? 0, limit] : [audience, limit],
  );
  const unread = await queryOne<{ n: number }>(
    `SELECT COUNT(*) AS n FROM notifications WHERE audience = ? ${audience === "user" ? "AND user_id = ?" : ""} AND read_at IS NULL`,
    audience === "user" ? [audience, userId ?? 0] : [audience],
  );
  return {
    unread: Number(unread?.n ?? 0),
    items: rows.map((r) => ({
      id: r.id as number,
      kind: r.kind as string,
      title: r.title as string,
      body: r.body as string,
      link: (r.link as string | null) ?? null,
      read: toBool(r.read_at !== null),
      createdAt: toIso(r.created_at),
    })),
  };
}

export async function markRead(audience: "user" | "admin", userId: number | null, ids: number[] | "all") {
  const scope = audience === "user" ? "AND user_id = ?" : "";
  const params: (string | number)[] = audience === "user" ? [audience, userId ?? 0] : [audience];
  if (ids === "all") {
    await execute(`UPDATE notifications SET read_at = UTC_TIMESTAMP() WHERE audience = ? ${scope} AND read_at IS NULL`, params);
  } else if (ids.length) {
    await execute(
      `UPDATE notifications SET read_at = UTC_TIMESTAMP() WHERE audience = ? ${scope} AND id IN (${ids.map(() => "?").join(",")})`,
      [...params, ...ids],
    );
  }
}

/* ---------------- Alertas programadas ---------------- */

const day = () => new Date().toISOString().slice(0, 10);

/** Alerta de poco inventario para un producto (máximo una por producto y día). */
export async function checkLowStock(productIds?: number[]) {
  const filter = productIds?.length ? `AND p.id IN (${productIds.map(() => "?").join(",")})` : "";
  const rows = await query<{ id: number; name: string; stock: number; low_stock_threshold: number; delivery_mode: string }>(
    `SELECT p.id, p.name, p.stock, p.low_stock_threshold, p.delivery_mode FROM products p
      WHERE p.is_active = 1 AND p.stock <= p.low_stock_threshold ${filter}`,
    productIds ?? [],
  );
  for (const p of rows) {
    await notify({
      audience: "admin",
      kind: "low_stock",
      title: p.stock <= 0 ? `Sin inventario: ${p.name}` : `Poco inventario: ${p.name} (${p.stock})`,
      body:
        p.delivery_mode === "auto"
          ? `Quedan ${p.stock} cuentas disponibles (alerta en ${p.low_stock_threshold}). Agrega cuentas en Inventario.`
          : `Quedan ${p.stock} unidades (alerta en ${p.low_stock_threshold}).`,
      link: p.delivery_mode === "auto" ? `/admin/inventario?producto=${p.id}` : "/admin/productos",
      dedupeKey: `low-stock:${p.id}:${day()}`,
      email: true,
    });
  }
  return rows.length;
}

/**
 * Revisión periódica:
 * - cuentas de inventario que vencen pronto en el proveedor (aviso al admin),
 * - servicios de clientes que terminan en 7 días y en 1 día (aviso al cliente),
 * - marca como vencidas las cuentas cuyo plazo terminó y recalcula el inventario,
 * - poco inventario.
 */
export async function runAlerts(): Promise<{ expiring: number; customerNotices: number; expired: number; lowStock: number }> {
  // 1. Cuentas que vencen en el proveedor dentro del margen.
  const expiring = await query<{ id: number; label: string; status: string; expires_at: Date; name: string; product_id: number; service_ends_at: Date | null }>(
    `SELECT i.id, i.label, i.status, i.expires_at, i.service_ends_at, i.product_id, p.name FROM inventory_items i JOIN products p ON p.id = i.product_id
      WHERE i.status IN ('available','reserved','sold') AND i.expires_at IS NOT NULL
        AND i.expires_at <= (UTC_TIMESTAMP() + INTERVAL ? DAY) AND i.expires_at > UTC_TIMESTAMP()`,
    [EXPIRY_WARNING_DAYS],
  );
  for (const it of expiring) {
    const critical = it.status === "sold" && it.service_ends_at && new Date(it.service_ends_at) > new Date(it.expires_at);
    await notify({
      audience: "admin",
      kind: "account_expiring",
      title: `${critical ? "Urgente: " : ""}cuenta por vencer · ${it.name}`,
      body: `${it.label || `Cuenta #${it.id}`} vence el ${new Date(it.expires_at).toISOString().slice(0, 10)}${critical ? " antes de que termine el servicio del cliente: renuévala o reemplázala." : "."}`,
      link: `/admin/inventario?producto=${it.product_id}&estado=por-vencer`,
      dedupeKey: `acct-exp:${it.id}:${new Date(it.expires_at).toISOString().slice(0, 10)}`,
      email: Boolean(critical),
    });
  }

  // 2. Servicios de clientes que terminan pronto (7 días y 1 día antes).
  let customerNotices = 0;
  for (const days of [EXPIRY_WARNING_DAYS, 1]) {
    const rows = await query<{ id: number; customer_id: number; service_ends_at: Date; name: string; slug: string; code: string }>(
      `SELECT i.id, i.customer_id, i.service_ends_at, p.name, p.slug, o.code
         FROM inventory_items i JOIN products p ON p.id = i.product_id
         JOIN order_items oi ON oi.id = i.order_item_id JOIN orders o ON o.id = oi.order_id
        WHERE i.status = 'sold' AND i.customer_id IS NOT NULL AND i.service_ends_at IS NOT NULL
          AND i.service_ends_at > UTC_TIMESTAMP() AND i.service_ends_at <= (UTC_TIMESTAMP() + INTERVAL ? DAY)`,
      [days],
    );
    for (const r of rows) {
      const created = await notify({
        audience: "user",
        userId: r.customer_id,
        kind: "service_expiring",
        title: days === 1 ? `Tu ${r.name} vence mañana` : `Tu ${r.name} vence en ${days} días`,
        body: `El servicio del pedido ${r.code} termina el ${new Date(r.service_ends_at).toISOString().slice(0, 10)}. Renuévalo para no perder el acceso.`,
        link: `/producto/${r.slug}`,
        dedupeKey: `svc-end:${r.id}:${days}d`,
        email: true,
      });
      if (created) customerNotices++;
    }
  }

  // 3. Vencidas: cuentas del proveedor y servicios terminados.
  const expiredRows = await query<{ id: number; product_id: number }>(
    `SELECT id, product_id FROM inventory_items
      WHERE (status IN ('available','sold') AND expires_at IS NOT NULL AND expires_at <= UTC_TIMESTAMP())
         OR (status = 'sold' AND service_ends_at IS NOT NULL AND service_ends_at <= UTC_TIMESTAMP())`,
  );
  if (expiredRows.length) {
    await execute(`UPDATE inventory_items SET status = 'expired' WHERE id IN (${expiredRows.map(() => "?").join(",")})`, expiredRows.map((r) => r.id));
    const products = [...new Set(expiredRows.map((r) => r.product_id))];
    for (const pid of products) await syncStockFor(pid);
  }

  // 4. Poco inventario.
  const lowStock = await checkLowStock();
  return { expiring: expiring.length, customerNotices, expired: expiredRows.length, lowStock };
}

async function syncStockFor(productId: number) {
  await execute(
    `UPDATE products SET stock = (SELECT COUNT(*) FROM inventory_items WHERE product_id = ? AND status = 'available')
      WHERE id = ? AND delivery_mode = 'auto'`,
    [productId, productId],
  );
}
