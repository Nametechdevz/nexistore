import type { ResultSetHeader } from "mysql2/promise";
import { query, queryOne, toIso, transaction } from "../db.js";
import { badRequest, conflict, notFound } from "../lib/http.js";
import { markFallen, notifyReplacement, replaceItem } from "./inventory.js";
import { notify } from "./notifications.js";
import { moveWallet } from "./wallet.js";
import { ISSUE_REASONS } from "../../shared/schemas.js";
import { formatCOP } from "../../shared/pricing.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const TICKET_STATUS_LABEL = { open: "Abierta", answered: "Respondida", closed: "Cerrada" } as const;

const mapTicket = (r: any) => ({
  id: r.id as number,
  subject: r.subject as string,
  kind: r.kind as "general" | "account_issue",
  status: r.status as "open" | "answered" | "closed",
  orderCode: (r.order_code as string | null) ?? null,
  resolution: (r.resolution as string | null) ?? null,
  createdAt: toIso(r.created_at),
  lastMessageAt: toIso(r.last_message_at ?? r.updated_at),
  lastMessage: r.last_body ? { body: String(r.last_body).slice(0, 160), authorRole: r.last_role as string } : null,
  customer: r.email ? { id: r.user_id as number, name: r.name as string, email: r.email as string } : undefined,
});

const LAST_MSG = `(SELECT body FROM ticket_messages m WHERE m.ticket_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_body,
                  (SELECT author_role FROM ticket_messages m WHERE m.ticket_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_role`;

export async function listTickets(opts: { userId?: number; status?: string | null; kind?: string | null }) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.userId) {
    where.push("t.user_id = ?");
    params.push(opts.userId);
  }
  if (opts.status) {
    where.push("t.status = ?");
    params.push(opts.status);
  }
  if (opts.kind) {
    where.push("t.kind = ?");
    params.push(opts.kind);
  }
  const rows = await query<any>(
    `SELECT t.*, u.name, u.email, ${LAST_MSG} FROM support_tickets t JOIN users u ON u.id = t.user_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY t.status = 'open' DESC, COALESCE(t.last_message_at, t.updated_at) DESC LIMIT 100`,
    params,
  );
  return rows.map((r) => ({ ...mapTicket(r), customer: opts.userId ? undefined : mapTicket(r).customer }));
}

export async function getTicket(id: number, userId?: number) {
  const t = await queryOne<any>(
    `SELECT t.*, u.name, u.email FROM support_tickets t JOIN users u ON u.id = t.user_id WHERE t.id = ? ${userId ? "AND t.user_id = ?" : ""}`,
    userId ? [id, userId] : [id],
  );
  if (!t) throw notFound("Solicitud no encontrada.");
  const messages = await query<any>(
    `SELECT m.id, m.author_role, m.body, m.created_at, u.name FROM ticket_messages m LEFT JOIN users u ON u.id = m.author_id
      WHERE m.ticket_id = ? ORDER BY m.id`,
    [id],
  );
  let item: any = null;
  if (t.inventory_item_id || t.order_item_id) {
    item = await queryOne<any>(
      `SELECT oi.id AS order_item_id, oi.product_name, oi.unit_price, oi.quantity, oi.product_id, i.id AS inventory_item_id, i.status AS inventory_status,
              i.label, i.service_ends_at, i.expires_at,
              (SELECT COUNT(*) FROM inventory_items a WHERE a.product_id = oi.product_id AND a.status = 'available') AS available_replacements
         FROM order_items oi LEFT JOIN inventory_items i ON i.id = ?
        WHERE oi.id = ?`,
      [t.inventory_item_id ?? 0, t.order_item_id ?? 0],
    );
  }
  return {
    ...mapTicket(t),
    customer: userId ? undefined : { id: t.user_id as number, name: t.name as string, email: t.email as string },
    messages: messages.map((m) => ({
      id: m.id as number,
      authorRole: m.author_role as "customer" | "admin" | "system",
      authorName: m.author_role === "admin" ? "Soporte NexiStore" : m.author_role === "system" ? "Sistema" : (m.name as string),
      body: m.body as string,
      createdAt: toIso(m.created_at),
    })),
    item: item
      ? {
          orderItemId: item.order_item_id,
          productId: item.product_id,
          productName: item.product_name,
          unitPrice: Number(item.unit_price),
          inventoryItemId: item.inventory_item_id,
          inventoryStatus: item.inventory_status,
          label: userId ? undefined : item.label,
          serviceEndsAt: toIso(item.service_ends_at),
          availableReplacements: userId ? undefined : Number(item.available_replacements),
        }
      : null,
  };
}

export async function createTicket(userId: number, data: { subject: string; message: string; orderCode?: string | null; kind?: "general" | "account_issue"; orderItemId?: number | null; inventoryItemId?: number | null }) {
  const id = await transaction(async (conn) => {
    const [r] = await conn.execute<ResultSetHeader>(
      `INSERT INTO support_tickets (user_id, order_code, subject, message, kind, order_item_id, inventory_item_id, last_message_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
      [userId, data.orderCode || null, data.subject, data.message, data.kind ?? "general", data.orderItemId ?? null, data.inventoryItemId ?? null],
    );
    await conn.execute("INSERT INTO ticket_messages (ticket_id, author_role, author_id, body) VALUES (?, 'customer', ?, ?)", [r.insertId, userId, data.message]);
    return r.insertId;
  });
  await notify({
    audience: "admin",
    kind: data.kind === "account_issue" ? "account_issue" : "ticket",
    title: data.kind === "account_issue" ? `Cuenta reportada con falla: ${data.subject}` : `Nueva solicitud: ${data.subject}`,
    body: data.message.slice(0, 200),
    link: `/admin/soporte/${id}`,
    email: data.kind === "account_issue",
  });
  return id;
}

export async function addMessage(ticketId: number, author: { role: "customer" | "admin"; id: number }, body: string, nextStatus?: "open" | "answered" | "closed") {
  const t = await queryOne<any>("SELECT id, user_id, subject, status FROM support_tickets WHERE id = ?", [ticketId]);
  if (!t || (author.role === "customer" && t.user_id !== author.id)) throw notFound("Solicitud no encontrada.");
  const status = nextStatus ?? (author.role === "customer" ? "open" : "answered");
  await transaction(async (conn) => {
    await conn.execute("INSERT INTO ticket_messages (ticket_id, author_role, author_id, body) VALUES (?, ?, ?, ?)", [ticketId, author.role, author.id, body]);
    await conn.execute("UPDATE support_tickets SET status = ?, last_message_at = UTC_TIMESTAMP() WHERE id = ?", [status, ticketId]);
  });
  if (author.role === "admin") {
    await notify({
      audience: "user",
      userId: t.user_id,
      kind: "ticket_reply",
      title: `Respuesta de soporte: ${t.subject}`,
      body: body.slice(0, 200),
      link: `/cuenta/soporte/${ticketId}`,
      email: true,
    });
  } else {
    await notify({ audience: "admin", kind: "ticket", title: `Nuevo mensaje: ${t.subject}`, body: body.slice(0, 200), link: `/admin/soporte/${ticketId}` });
  }
}

/** El cliente reporta una cuenta que dejó de funcionar desde el detalle del pedido. */
export async function reportIssue(userId: number, orderCode: string, orderItemId: number, data: { inventoryItemId?: number; reason: keyof typeof ISSUE_REASONS; message: string }) {
  const oi = await queryOne<any>(
    `SELECT oi.id, oi.product_name, o.id AS order_id, o.status FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE oi.id = ? AND o.code = ? AND o.user_id = ?`,
    [orderItemId, orderCode, userId],
  );
  if (!oi) throw notFound("Producto del pedido no encontrado.");
  if (oi.status !== "completed") throw conflict("Solo puedes reportar fallas de productos ya entregados.");
  if (data.inventoryItemId) {
    const own = await queryOne("SELECT id FROM inventory_items WHERE id = ? AND order_item_id = ? AND status = 'sold'", [data.inventoryItemId, orderItemId]);
    if (!own) throw badRequest("La cuenta indicada no pertenece a este pedido o ya fue reemplazada.");
  }
  const openTicket = await queryOne<{ id: number }>(
    "SELECT id FROM support_tickets WHERE user_id = ? AND order_item_id = ? AND kind = 'account_issue' AND status <> 'closed' AND (inventory_item_id <=> ?)",
    [userId, orderItemId, data.inventoryItemId ?? null],
  );
  if (openTicket) throw conflict("Ya tienes un reporte abierto para esta cuenta. Te responderemos allí.");
  const message = `${ISSUE_REASONS[data.reason]}.${data.message ? `\n\n${data.message}` : ""}`;
  const id = await createTicket(userId, {
    subject: `${oi.product_name} · pedido ${orderCode}`,
    message,
    orderCode,
    kind: "account_issue",
    orderItemId,
    inventoryItemId: data.inventoryItemId ?? null,
  });
  await query("INSERT INTO order_events (order_id, status, note, actor) VALUES (?, 'issue_reported', ?, 'customer')", [
    oi.order_id,
    `Reportaste una falla en ${oi.product_name}. Solicitud de soporte #${id}.`,
  ]);
  return id;
}

/**
 * Resolución de un reporte de cuenta caída:
 * - replace: marca la cuenta como caída y entrega otra del inventario.
 * - refund: marca la cuenta como caída y reembolsa a la billetera (monto sugerido: proporcional a los días restantes).
 */
export async function resolveIssue(ticketId: number, adminId: number, action: "replace" | "refund", opts: { amount?: number; message?: string }) {
  const t = await queryOne<any>("SELECT * FROM support_tickets WHERE id = ? AND kind = 'account_issue'", [ticketId]);
  if (!t) throw notFound("Reporte no encontrado.");
  if (t.resolution) throw conflict("Este reporte ya fue resuelto.");
  // Si el cliente no indicó la cuenta, se toma la vendida de ese ítem.
  let itemId: number | null = t.inventory_item_id;
  if (!itemId && t.order_item_id) {
    itemId = (await queryOne<{ id: number }>("SELECT id FROM inventory_items WHERE order_item_id = ? AND status = 'sold' ORDER BY id LIMIT 1", [t.order_item_id]))?.id ?? null;
  }
  let text: string;
  if (action === "replace") {
    if (!itemId) throw conflict("Este producto no tiene una cuenta de inventario vinculada: entrega el reemplazo desde el pedido.");
    const r = await transaction((conn) => replaceItem(conn, itemId!, `Reemplazada por reporte #${ticketId}.`));
    await notifyReplacement(r.customerId, r.productName, r.orderCode);
    text = opts.message || `Reemplazamos tu cuenta de ${r.productName}. Encuentra los nuevos datos de acceso en el pedido ${r.orderCode}.`;
  } else {
    const oi = await queryOne<any>("SELECT oi.unit_price, o.code, o.id AS order_id FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.id = ?", [t.order_item_id ?? 0]);
    if (!oi) throw conflict("El reporte no está vinculado a un pedido.");
    const amount = opts.amount ?? (await suggestedRefund(itemId, Number(oi.unit_price)));
    if (amount > Number(oi.unit_price)) throw badRequest(`El reembolso no puede superar el precio pagado (${formatCOP(Number(oi.unit_price))}).`);
    await transaction(async (conn) => {
      if (itemId) await markFallen(conn, itemId, `Reembolsada por reporte #${ticketId}.`);
      await moveWallet(conn, t.user_id, amount, "refund", { reference: oi.code, note: `Reembolso por falla (solicitud #${ticketId})`, actor: "admin" });
      await conn.execute("INSERT INTO order_events (order_id, status, note, actor) VALUES (?, 'issue_refunded', ?, 'admin')", [
        oi.order_id,
        `Reembolsamos ${formatCOP(amount)} a tu billetera por la falla reportada.`,
      ]);
    });
    await notify({ audience: "user", userId: t.user_id, kind: "wallet", title: `Reembolso de ${formatCOP(amount)} a tu billetera`, body: `Por la falla reportada en el pedido ${oi.code}.`, link: "/cuenta/billetera", email: true });
    text = opts.message || `Reembolsamos ${formatCOP(amount)} a tu billetera NexiStore por la falla de la cuenta. Puedes usar el saldo en tu próxima compra.`;
  }
  await query("UPDATE support_tickets SET resolution = ? WHERE id = ?", [action === "replace" ? "replaced" : "refunded", ticketId]);
  await addMessage(ticketId, { role: "admin", id: adminId }, text, "answered");
}

/** Reembolso proporcional a los días de servicio restantes. */
export async function suggestedRefund(itemId: number | null, unitPrice: number): Promise<number> {
  if (!itemId) return unitPrice;
  const it = await queryOne<{ sold_at: Date | null; service_ends_at: Date | null }>("SELECT sold_at, service_ends_at FROM inventory_items WHERE id = ?", [itemId]);
  if (!it?.sold_at || !it.service_ends_at) return unitPrice;
  const total = new Date(it.service_ends_at).getTime() - new Date(it.sold_at).getTime();
  const left = new Date(it.service_ends_at).getTime() - Date.now();
  if (total <= 0) return unitPrice;
  return Math.max(0, Math.min(unitPrice, Math.round((unitPrice * Math.max(0, left)) / total / 100) * 100));
}

