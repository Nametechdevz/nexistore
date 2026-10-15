/** Administración: inventario de cuentas, billetera, soporte conversacional y alertas. */
import { Router } from "express";
import { z } from "zod";
import { execute, query, queryOne, toIso, transaction } from "../db.js";
import { ah, badRequest, conflict, HttpError, intParam, likeEscape, notFound, pageParams, parse } from "../lib/http.js";
import { open, requireVault, vaultConfigured } from "../lib/vault.js";
import { requireAdmin } from "../middleware/session.js";
import { inventorySummary, markFallen, notifyReplacement, replaceItem, sealContent, syncAutoStock } from "../services/inventory.js";
import { checkLowStock, listNotifications, markRead, notify, runAlerts } from "../services/notifications.js";
import { addMessage, getTicket, listTickets, resolveIssue, suggestedRefund } from "../services/support.js";
import { creditTopup, mapTopup, moveWallet, newTopupCode } from "../services/wallet.js";
import { INVENTORY_STATUSES } from "../../shared/constants.js";
import { formatCOP } from "../../shared/pricing.js";
import {
  adminTopupSchema, inventoryBulkSchema, inventoryFallSchema, MANUAL_TOPUP_METHODS, inventoryUpdateSchema, resolveTicketSchema, ticketAdminMessageSchema, walletAdjustSchema,
} from "../../shared/schemas.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const adminOpsRouter = Router();
adminOpsRouter.use(requireAdmin);

const dateOrNull = (d: string | null) => (d ? new Date(`${d}T23:59:59Z`) : null);

/* ================= Inventario ================= */

adminOpsRouter.get(
  "/inventory/summary",
  ah(async (_req, res) => {
    const rows = await inventorySummary();
    res.json({
      vault: vaultConfigured(),
      items: rows.map((r: any) => ({
        productId: r.id,
        name: r.name,
        slug: r.slug,
        artGlyph: r.art_glyph || r.name.slice(0, 1),
        artColor: r.art_color || r.category_color,
        lowStockThreshold: Number(r.low_stock_threshold),
        available: Number(r.available ?? 0),
        reserved: Number(r.reserved ?? 0),
        sold: Number(r.sold ?? 0),
        fallen: Number(r.fallen ?? 0),
        expired: Number(r.expired ?? 0),
        expiring: Number(r.expiring ?? 0),
      })),
    });
  }),
);

adminOpsRouter.get(
  "/inventory",
  ah(async (req, res) => {
    const { page, pageSize, offset } = pageParams(req.query, 100);
    const where: string[] = [];
    const params: (string | number)[] = [];
    const productId = Number(req.query.producto);
    if (Number.isInteger(productId) && productId > 0) {
      where.push("i.product_id = ?");
      params.push(productId);
    }
    const estado = String(req.query.estado ?? "");
    if ((INVENTORY_STATUSES as readonly string[]).includes(estado)) {
      where.push("i.status = ?");
      params.push(estado);
    } else if (estado === "por-vencer") {
      where.push("i.status IN ('available','sold') AND i.expires_at IS NOT NULL AND i.expires_at <= UTC_TIMESTAMP() + INTERVAL 7 DAY");
    } else if (estado === "servicio-por-vencer") {
      where.push("i.status = 'sold' AND i.service_ends_at IS NOT NULL AND i.service_ends_at <= UTC_TIMESTAMP() + INTERVAL 7 DAY");
    }
    const q = String(req.query.q ?? "").trim().slice(0, 80);
    if (q) {
      where.push("(i.label LIKE ? OR u.email LIKE ? OR o.code LIKE ?)");
      const like = `%${likeEscape(q)}%`;
      params.push(like, like, like);
    }
    const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const from = `FROM inventory_items i JOIN products p ON p.id = i.product_id
                  LEFT JOIN users u ON u.id = i.customer_id
                  LEFT JOIN order_items oi ON oi.id = i.order_item_id LEFT JOIN orders o ON o.id = oi.order_id`;
    const rows = await query<any>(
      `SELECT i.id, i.label, i.status, i.expires_at, i.sold_at, i.service_ends_at, i.notes, i.created_at, i.product_id,
              p.name AS product_name, u.name AS customer_name, u.email AS customer_email, o.code AS order_code
         ${from} ${w} ORDER BY FIELD(i.status,'sold','reserved','available','fallen','expired','disabled'), i.expires_at IS NULL, i.expires_at, i.id DESC
        LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    );
    const total = await queryOne<{ n: number }>(`SELECT COUNT(*) AS n ${from} ${w}`, params);
    res.json({
      items: rows.map((r) => ({
        id: r.id,
        label: r.label,
        status: r.status,
        productId: r.product_id,
        productName: r.product_name,
        expiresAt: toIso(r.expires_at),
        soldAt: toIso(r.sold_at),
        serviceEndsAt: toIso(r.service_ends_at),
        notes: r.notes,
        createdAt: toIso(r.created_at),
        customer: r.customer_email ? { name: r.customer_name, email: r.customer_email } : null,
        orderCode: r.order_code ?? null,
      })),
      total: Number(total?.n ?? 0),
      page,
      pageSize,
    });
  }),
);

/** Detalle con credenciales descifradas (solo administradores). */
adminOpsRouter.get(
  "/inventory/:id",
  ah(async (req, res) => {
    const r = await queryOne<any>("SELECT * FROM inventory_items WHERE id = ?", [intParam(req.params.id)]);
    if (!r) throw notFound("Cuenta no encontrada.");
    res.json({ item: { id: r.id, label: r.label, content: open(r.content), status: r.status, expiresAt: toIso(r.expires_at), notes: r.notes } });
  }),
);

/**
 * Carga masiva: una cuenta por línea.
 * Formato: credenciales | etiqueta opcional | vencimiento opcional (AAAA-MM-DD)
 */
adminOpsRouter.post(
  "/inventory/bulk",
  ah(async (req, res) => {
    requireVault();
    const d = parse(inventoryBulkSchema, req.body);
    const p = await queryOne<{ id: number; delivery_mode: string }>("SELECT id, delivery_mode FROM products WHERE id = ?", [d.productId]);
    if (!p) throw notFound("Producto no encontrado.");
    if (p.delivery_mode !== "auto") throw conflict("Activa la «entrega automática» en el producto antes de cargar cuentas.");
    const lines = d.lines.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length > 1000) throw badRequest("Máximo 1.000 cuentas por carga.");
    const parsed = lines.map((line, idx) => {
      const [cred = "", label = "", date = ""] = line.split("|").map((x) => x.trim());
      if (cred.length < 3) throw badRequest(`Línea ${idx + 1}: faltan las credenciales.`);
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest(`Línea ${idx + 1}: fecha inválida (usa AAAA-MM-DD).`);
      // Etiqueta visible: la indicada o el usuario/correo (sin la contraseña).
      const fallback = cred.split(/[:\s/]/)[0]!.slice(0, 80);
      return { content: sealContent(cred), label: (label || fallback).slice(0, 160), expires: date ? dateOrNull(date) : dateOrNull(d.expiresAt) };
    });
    await transaction(async (conn) => {
      for (const it of parsed) {
        await conn.execute("INSERT INTO inventory_items (product_id, label, content, expires_at) VALUES (?, ?, ?, ?)", [d.productId, it.label, it.content, it.expires]);
      }
      await syncAutoStock(conn, d.productId);
    });
    res.status(201).json({ created: parsed.length });
  }),
);

adminOpsRouter.put(
  "/inventory/:id",
  ah(async (req, res) => {
    const id = intParam(req.params.id);
    const d = parse(inventoryUpdateSchema, req.body);
    const it = await queryOne<{ status: string; product_id: number }>("SELECT status, product_id FROM inventory_items WHERE id = ?", [id]);
    if (!it) throw notFound("Cuenta no encontrada.");
    if (d.status && !["available", "disabled"].includes(it.status)) throw conflict("Solo se puede cambiar la disponibilidad de cuentas que no están vendidas ni reservadas.");
    await transaction(async (conn) => {
      await conn.execute("UPDATE inventory_items SET label = ?, expires_at = ?, notes = ? WHERE id = ?", [d.label, dateOrNull(d.expiresAt), d.notes, id]);
      if (d.content) {
        requireVault();
        await conn.execute("UPDATE inventory_items SET content = ? WHERE id = ?", [sealContent(d.content), id]);
      }
      if (d.status) await conn.execute("UPDATE inventory_items SET status = ? WHERE id = ?", [d.status, id]);
      await syncAutoStock(conn, it.product_id);
    });
    res.json({ ok: true });
  }),
);

adminOpsRouter.delete(
  "/inventory/:id",
  ah(async (req, res) => {
    const id = intParam(req.params.id);
    const it = await queryOne<{ status: string; product_id: number; order_item_id: number | null }>("SELECT status, product_id, order_item_id FROM inventory_items WHERE id = ?", [id]);
    if (!it) throw notFound("Cuenta no encontrada.");
    if (it.order_item_id) throw conflict("La cuenta está vinculada a un pedido: márcala como caída o deshabilítala en lugar de eliminarla.");
    await transaction(async (conn) => {
      await conn.execute("DELETE FROM inventory_items WHERE id = ?", [id]);
      await syncAutoStock(conn, it.product_id);
    });
    res.json({ ok: true });
  }),
);

/**
 * Cuenta caída detectada por el admin. Si estaba vendida y se pide, se reemplaza automáticamente
 * y se avisa al cliente; si no hay reemplazo, se avisa y queda un caso de soporte abierto.
 */
adminOpsRouter.post(
  "/inventory/:id/fall",
  ah(async (req, res) => {
    const id = intParam(req.params.id);
    const d = parse(inventoryFallSchema, req.body);
    const before = await queryOne<{ status: string; customer_id: number | null; order_item_id: number | null }>(
      "SELECT status, customer_id, order_item_id FROM inventory_items WHERE id = ?",
      [id],
    );
    if (!before) throw notFound("Cuenta no encontrada.");
    if (before.status === "sold" && d.replace) {
      try {
        const r = await transaction((conn) => replaceItem(conn, id, d.note || "Caída detectada por el administrador."));
        await notifyReplacement(r.customerId, r.productName, r.orderCode);
        return res.json({ result: "replaced", newItemId: r.newId });
      } catch (err) {
        if (!(err instanceof Error) || !/No hay cuentas disponibles/.test(err.message)) throw err;
        // Sin reemplazo: se marca caída y se abre un caso para el cliente.
      }
    }
    const it = await transaction((conn) => markFallen(conn, id, d.note || "Caída detectada por el administrador."));
    if (it.status === "sold" && it.customer_id && it.order_code) {
      const created = await execute(
        `INSERT INTO support_tickets (user_id, order_code, subject, message, kind, order_item_id, inventory_item_id, status, last_message_at)
         VALUES (?, ?, ?, ?, 'account_issue', ?, ?, 'answered', UTC_TIMESTAMP())`,
        [it.customer_id, it.order_code, `${it.name} · pedido ${it.order_code}`, "Falla detectada por NexiStore.", it.order_item_id, id],
      );
      const ticketId = created.insertId;
      await execute("INSERT INTO ticket_messages (ticket_id, author_role, body) VALUES (?, 'system', ?)", [
        ticketId,
        `Detectamos una falla en tu cuenta de ${it.name}. Estamos consiguiendo un reemplazo; te avisaremos por aquí. Si prefieres, podemos reembolsarte a tu billetera.`,
      ]);
      await notify({
        audience: "user",
        userId: it.customer_id,
        kind: "account_issue",
        title: `Falla en tu cuenta de ${it.name}`,
        body: "Estamos gestionando el reemplazo. Puedes seguir el caso en Soporte.",
        link: `/cuenta/soporte/${ticketId}`,
        email: true,
      });
      await notify({ audience: "admin", kind: "account_issue", title: `Sin reemplazo para ${it.name}`, body: `Agrega cuentas o reembolsa (solicitud #${ticketId}).`, link: `/admin/soporte/${ticketId}` });
      return res.json({ result: "fallen_pending", ticketId });
    }
    await checkLowStock([it.product_id]);
    res.json({ result: "fallen" });
  }),
);

/* ================= Billetera ================= */

adminOpsRouter.get(
  "/wallet/topups",
  ah(async (req, res) => {
    const status = ["pending", "paid", "cancelled"].includes(String(req.query.status)) ? String(req.query.status) : null;
    const rows = await query<any>(
      `SELECT t.*, u.name, u.email FROM wallet_topups t JOIN users u ON u.id = t.user_id
        ${status ? "WHERE t.status = ?" : ""} ORDER BY t.status = 'pending' DESC, t.id DESC LIMIT 100`,
      status ? [status] : [],
    );
    const totals = await queryOne<any>("SELECT COALESCE(SUM(wallet_balance),0) AS balances, COUNT(*) AS users FROM users WHERE wallet_balance > 0");
    res.json({ items: rows.map(mapTopup), totalBalances: Number(totals?.balances ?? 0), usersWithBalance: Number(totals?.users ?? 0) });
  }),
);

/** Confirma una recarga por transferencia tras verificar el dinero recibido. */
adminOpsRouter.post(
  "/wallet/topups/:code/confirm",
  ah(async (req, res) => {
    const t = await queryOne<{ provider: string; status: string }>("SELECT provider, status FROM wallet_topups WHERE code = ?", [String(req.params.code)]);
    if (!t) throw notFound("Recarga no encontrada.");
    if (t.provider !== "manual") throw conflict("Las recargas por pasarela se acreditan solas con la confirmación verificada del proveedor.");
    if (t.status !== "pending") throw conflict("La recarga no está pendiente.");
    await creditTopup(String(req.params.code), { actor: "admin", paymentRef: `admin-${req.user!.id}` });
    res.json({ ok: true });
  }),
);

adminOpsRouter.post(
  "/wallet/topups/:code/cancel",
  ah(async (req, res) => {
    const r = await execute("UPDATE wallet_topups SET status = 'cancelled' WHERE code = ? AND status = 'pending'", [String(req.params.code)]);
    if (!r.affectedRows) throw conflict("La recarga no está pendiente.");
    res.json({ ok: true });
  }),
);

/**
 * Recarga manual: el administrador registra dinero recibido por fuera (Nequi, efectivo…) y lo
 * acredita al instante. Queda como recarga pagada con método y comprobante, y no permite repetir
 * el mismo comprobante del mismo método (evita acreditar dos veces).
 */
adminOpsRouter.post(
  "/wallet/topups/manual",
  ah(async (req, res) => {
    const d = parse(adminTopupSchema, req.body);
    const user = await queryOne<{ id: number; name: string }>("SELECT id, name FROM users WHERE id = ?", [d.userId]);
    if (!user) throw new HttpError(422, "Revisa los datos.", { userId: "El cliente no existe." });
    const ref = d.reference ? `${d.method}:${d.reference}` : `${d.method}:admin-${req.user!.id}-${Date.now()}`;
    if (d.reference && (await queryOne("SELECT id FROM wallet_topups WHERE payment_ref = ? AND status = 'paid'", [ref]))) {
      throw new HttpError(409, "Ese comprobante ya fue usado en otra recarga.", { reference: "Ese comprobante ya fue usado en otra recarga." });
    }
    const code = newTopupCode();
    const label = MANUAL_TOPUP_METHODS[d.method];
    const note = `Recarga manual (${label}${d.reference ? ` · ${d.reference}` : ""})${d.note ? ` · ${d.note}` : ""}`;
    const balance = await transaction(async (conn) => {
      await conn.execute(
        "INSERT INTO wallet_topups (code, user_id, amount, provider, status, payment_ref, paid_at) VALUES (?, ?, ?, 'manual', 'paid', ?, UTC_TIMESTAMP())",
        [code, d.userId, d.amount, ref],
      );
      return (await moveWallet(conn, d.userId, d.amount, "topup", { reference: code, note, actor: `admin:${req.user!.id}` })).balance;
    });
    await notify({
      audience: "user",
      userId: d.userId,
      kind: "wallet",
      title: `Recarga de ${formatCOP(d.amount)} acreditada`,
      body: `${label}. Tu saldo disponible es ${formatCOP(balance)}.`,
      link: "/cuenta/billetera",
      email: true,
    });
    res.status(201).json({ code, balance });
  }),
);

/** Búsqueda rápida de clientes para el formulario de recarga manual. */
adminOpsRouter.get(
  "/wallet/customers",
  ah(async (req, res) => {
    const q = String(req.query.q ?? "").trim().slice(0, 80);
    if (q.length < 2) return res.json({ items: [] });
    const like = `%${likeEscape(q)}%`;
    const rows = await query<any>("SELECT id, name, email, wallet_balance FROM users WHERE name LIKE ? OR email LIKE ? ORDER BY name LIMIT 8", [like, like]);
    res.json({ items: rows.map((r) => ({ id: r.id, name: r.name, email: r.email, walletBalance: Number(r.wallet_balance) })) });
  }),
);

adminOpsRouter.get(
  "/customers/:id/wallet",
  ah(async (req, res) => {
    const id = intParam(req.params.id);
    const u = await queryOne<any>("SELECT id, name, email, wallet_balance FROM users WHERE id = ?", [id]);
    if (!u) throw notFound("Cliente no encontrado.");
    const txs = await query<any>("SELECT * FROM wallet_transactions WHERE user_id = ? ORDER BY id DESC LIMIT 100", [id]);
    res.json({
      customer: { id: u.id, name: u.name, email: u.email },
      balance: Number(u.wallet_balance),
      transactions: txs.map((t) => ({ id: t.id, kind: t.kind, amount: Number(t.amount), balanceAfter: Number(t.balance_after), reference: t.reference, note: t.note, actor: t.actor, createdAt: toIso(t.created_at) })),
    });
  }),
);

/** Ajuste manual (crédito o débito) con motivo obligatorio; queda en el historial. */
adminOpsRouter.post(
  "/customers/:id/wallet",
  ah(async (req, res) => {
    const id = intParam(req.params.id);
    const d = parse(walletAdjustSchema, req.body);
    const { balance } = await transaction((conn) => moveWallet(conn, id, d.amount, "adjustment", { note: d.note, actor: `admin:${req.user!.id}` }));
    await notify({
      audience: "user",
      userId: id,
      kind: "wallet",
      title: d.amount > 0 ? `Te acreditamos ${formatCOP(d.amount)}` : `Ajuste de ${formatCOP(d.amount)} en tu billetera`,
      body: `${d.note}. Saldo: ${formatCOP(balance)}.`,
      link: "/cuenta/billetera",
    });
    res.json({ balance });
  }),
);

/* ================= Soporte ================= */

adminOpsRouter.get(
  "/tickets",
  ah(async (req, res) => {
    const status = ["open", "answered", "closed"].includes(String(req.query.status)) ? String(req.query.status) : null;
    const kind = ["general", "account_issue"].includes(String(req.query.kind)) ? String(req.query.kind) : null;
    res.json({ items: await listTickets({ status, kind }) });
  }),
);

adminOpsRouter.get(
  "/tickets/:id",
  ah(async (req, res) => {
    const ticket = await getTicket(intParam(req.params.id));
    const suggested = ticket.item ? await suggestedRefund(ticket.item.inventoryItemId ?? null, ticket.item.unitPrice) : null;
    res.json({ ticket, suggestedRefund: suggested });
  }),
);

adminOpsRouter.post(
  "/tickets/:id/messages",
  ah(async (req, res) => {
    const d = parse(ticketAdminMessageSchema, req.body);
    await addMessage(intParam(req.params.id), { role: "admin", id: req.user!.id }, d.body, d.status);
    res.status(201).json({ ticket: await getTicket(intParam(req.params.id)) });
  }),
);

adminOpsRouter.post(
  "/tickets/:id/status",
  ah(async (req, res) => {
    const { status } = parse(z.object({ status: z.enum(["open", "answered", "closed"]) }), req.body);
    const r = await execute("UPDATE support_tickets SET status = ? WHERE id = ?", [status, intParam(req.params.id)]);
    if (!r.affectedRows) throw notFound("Solicitud no encontrada.");
    res.json({ ok: true });
  }),
);

adminOpsRouter.post(
  "/tickets/:id/resolve",
  ah(async (req, res) => {
    const d = parse(resolveTicketSchema, req.body);
    await resolveIssue(intParam(req.params.id), req.user!.id, d.action, { amount: d.amount, message: d.message });
    res.json({ ticket: await getTicket(intParam(req.params.id)) });
  }),
);

/* ================= Notificaciones y alertas ================= */

adminOpsRouter.get(
  "/notifications",
  ah(async (_req, res) => {
    res.json(await listNotifications("admin", null, 30));
  }),
);

adminOpsRouter.post(
  "/notifications/read",
  ah(async (req, res) => {
    const { ids } = parse(z.object({ ids: z.union([z.literal("all"), z.array(z.number().int().positive()).max(100)]) }), req.body);
    await markRead("admin", null, ids);
    res.json({ ok: true });
  }),
);

/** Ejecuta la revisión de alertas ahora (además de la automática cada hora). */
adminOpsRouter.post(
  "/alerts/run",
  ah(async (_req, res) => {
    res.json(await runAlerts());
  }),
);
