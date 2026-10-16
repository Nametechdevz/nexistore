import express, { Router, type Response } from "express";
import { z } from "zod";
import { execute, query, queryOne, toBool, toIso, transaction } from "../db.js";
import { ah, badRequest, conflict, HttpError, intParam, likeEscape, notFound, pageParams, parse } from "../lib/http.js";
import { requireAdmin } from "../middleware/session.js";
import { getProductBySlug, listCategories, listProducts, syncProductFromVariants } from "../services/catalog.js";
import { changeStatus, getOrder, listOrders, setDelivery } from "../services/orders.js";
import { DEFAULT_CAMPAIGN, DEFAULT_CRYPTO, DEFAULT_STORE, getSetting, setSetting } from "../services/settings.js";
import { detectedUrl, publicUrl, publicView, saveIntegrations } from "../services/integrations.js";
import { testMail } from "../services/mailer.js";
import { getManualAccounts, getPaymentDisplay, saveManualAccounts } from "../services/manual-pay.js";
import { notify } from "../services/notifications.js";
import { MAX_MEDIA_BYTES, saveMedia, sniffImage } from "../services/media.js";
import { paymentMethods } from "../payments/index.js";
import { ORDER_STATUSES } from "../../shared/constants.js";
import {
  campaignSchema,
  cryptoSettingsSchema,
  integrationsSchema,
  manualAccountsSchema,
  paymentDisplaySchema,
  rejectProofSchema,
  categoryInputSchema,
  couponInputSchema,
  orderDeliverySchema,
  orderStatusUpdateSchema,
  postInputSchema,
  productInputSchema,
  storeSettingsSchema,
  userAdminUpdateSchema,
} from "../../shared/schemas.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const adminRouter = Router();
adminRouter.use(requireAdmin);

const PAID = "('paid','processing','completed')";

function dup(e: any, field: string, msg: string): never {
  if (e?.code === "ER_DUP_ENTRY") throw conflict(msg, { [field]: msg });
  throw e;
}

/* ---------- Imágenes ---------- */

// El cuerpo es el archivo tal cual (image/*). Se valida la firma real del archivo, no la extensión.
adminRouter.post(
  "/media",
  express.raw({ type: () => true, limit: MAX_MEDIA_BYTES }),
  ah(async (req, res) => {
    const buf = Buffer.isBuffer(req.body) ? req.body : null;
    if (!buf?.length) throw badRequest("No llegó ninguna imagen.");
    if (!sniffImage(buf)) throw badRequest("Formato no admitido. Usa JPG, PNG, WebP o GIF.");
    const media = await saveMedia(buf, req.user!.id);
    res.status(201).json(media);
  }),
);

/* ---------- Dashboard ---------- */

adminRouter.get(
  "/dashboard",
  ah(async (req, res) => {
    const range = req.query.range === "month" ? 30 : 7;
    const [kpi] = await query<any>(
      `SELECT (SELECT COUNT(*) FROM products WHERE is_active = 1) AS products,
              (SELECT COUNT(*) FROM orders) AS orders,
              (SELECT COUNT(*) FROM users WHERE role = 'customer') AS customers,
              (SELECT COALESCE(SUM(total),0) FROM orders WHERE status IN ${PAID}) AS revenue,
              (SELECT COUNT(*) FROM orders WHERE status IN ('paid','processing')) AS to_deliver,
              (SELECT COUNT(*) FROM orders WHERE status = 'pending_payment') AS pending_payment,
              (SELECT COUNT(*) FROM products WHERE is_active = 1 AND stock <= 5) AS low_stock,
              (SELECT COUNT(*) FROM support_tickets WHERE status = 'open') AS open_tickets,
              (SELECT COUNT(*) FROM support_tickets WHERE kind = 'account_issue' AND resolution IS NULL AND status <> 'closed') AS open_issues,
              (SELECT COUNT(*) FROM inventory_items WHERE status IN ('available','sold') AND expires_at IS NOT NULL
                  AND expires_at <= UTC_TIMESTAMP() + INTERVAL 7 DAY) AS expiring_accounts,
              (SELECT COUNT(*) FROM inventory_items WHERE status = 'available') AS available_accounts,
              (SELECT COUNT(*) FROM wallet_topups WHERE status = 'pending' AND provider = 'manual') AS pending_topups`,
    );
    const daily = await query<any>(
      `SELECT DATE(paid_at) AS day, SUM(total) AS total, COUNT(*) AS n FROM orders
        WHERE status IN ${PAID} AND paid_at >= (UTC_DATE() - INTERVAL ? DAY)
        GROUP BY DATE(paid_at) ORDER BY day`,
      [range - 1],
    );
    const byDay = new Map(daily.map((d) => [toIso(d.day)!.slice(0, 10), { total: Number(d.total), orders: Number(d.n) }]));
    const series = Array.from({ length: range }, (_, i) => {
      const d = new Date(Date.now() - (range - 1 - i) * 86_400_000).toISOString().slice(0, 10);
      return { day: d, ...(byDay.get(d) ?? { total: 0, orders: 0 }) };
    });
    const recent = await listOrders({ limit: 6, offset: 0 });
    const top = await query<any>(
      `SELECT oi.product_name AS name, SUM(oi.quantity) AS units, SUM(oi.quantity * oi.unit_price) AS revenue
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE o.status IN ${PAID} GROUP BY oi.product_name ORDER BY units DESC LIMIT 5`,
    );
    res.json({
      kpi: Object.fromEntries(Object.entries(kpi).map(([k, v]) => [k, Number(v)])),
      series,
      recent: recent.items,
      top: top.map((t) => ({ name: t.name, units: Number(t.units), revenue: Number(t.revenue) })),
      paymentMethods: await paymentMethods(),
    });
  }),
);

/* ---------- Productos ---------- */

adminRouter.get(
  "/products",
  ah(async (req, res) => {
    const { page, pageSize, offset } = pageParams(req.query);
    const q = String(req.query.q ?? "").trim().slice(0, 80);
    const category = String(req.query.category ?? "").trim();
    const result = await listProducts({
      q: q || undefined,
      category: /^[a-z0-9-]+$/.test(category) ? category : undefined,
      includeInactive: true,
      sort: "newest",
      limit: pageSize,
      offset,
    });
    // Incluye el estado activo para la tabla.
    const ids = result.items.map((p) => p.id);
    const active = ids.length
      ? await query<any>(`SELECT id, is_active FROM products WHERE id IN (${ids.map(() => "?").join(",")})`, ids)
      : [];
    const activeMap = new Map(active.map((a) => [a.id, toBool(a.is_active)]));
    res.json({ items: result.items.map((p) => ({ ...p, isActive: activeMap.get(p.id) ?? false })), total: result.total, page, pageSize });
  }),
);

adminRouter.get(
  "/products/:id",
  ah(async (req, res) => {
    const row = await queryOne<{ slug: string; art_color: string | null; low_stock_threshold: number }>(
      "SELECT slug, art_color, low_stock_threshold FROM products WHERE id = ?",
      [intParam(req.params.id)],
    );
    if (!row) throw notFound("Producto no encontrado.");
    // rawArtColor: color propio del producto (null = usa el de la categoría).
    res.json({ product: { ...(await getProductBySlug(row.slug, true)), rawArtColor: row.art_color, lowStockThreshold: Number(row.low_stock_threshold) } });
  }),
);

/** Galería final: si solo llega imageUrl (versiones anteriores), se usa como única imagen. */
const galleryOf = (d: z.infer<typeof productInputSchema>) => (d.images.length ? d.images : d.imageUrl ? [d.imageUrl] : []);

function productParams(d: z.infer<typeof productInputSchema>) {
  const images = galleryOf(d);
  return [
    d.name, d.slug, d.categoryId, d.summary, d.description, d.includesText, d.instructions, d.deliveryText, d.warrantyText,
    d.durationLabel, d.accountLabel, d.price, d.compareAtPrice || null, d.deliveryMode === "auto" ? 0 : d.stock, d.maxPerOrder, d.artGlyph, d.artColor,
    images[0] ?? null, JSON.stringify(images), d.isFeatured ? 1 : 0, d.isActive ? 1 : 0, d.deliveryMode, d.durationDays, d.lowStockThreshold,
  ];
}

async function assertCategory(id: number) {
  if (!(await queryOne("SELECT id FROM categories WHERE id = ?", [id]))) {
    throw new HttpError(422, "Revisa los datos del formulario.", { categoryId: "La categoría no existe." });
  }
}

/**
 * Guarda las opciones del producto: actualiza las existentes, crea las nuevas y quita las que ya no
 * vienen (si alguna tiene pedidos o cuentas asociadas se desactiva en vez de borrarse).
 */
async function saveVariants(productId: number, variants: z.infer<typeof productInputSchema>["variants"]) {
  await transaction(async (conn) => {
    const [rows] = (await conn.query("SELECT id FROM product_variants WHERE product_id = ? FOR UPDATE", [productId])) as unknown as [{ id: number }[]];
    const existing = new Set(rows.map((r) => r.id));
    const keep = new Set<number>();
    for (const [i, v] of variants.entries()) {
      if (v.id && existing.has(v.id)) {
        await conn.execute(
          "UPDATE product_variants SET name = ?, price = ?, compare_at_price = ?, stock = ?, duration_days = ?, sort_order = ?, is_active = 1 WHERE id = ?",
          [v.name, v.price, v.compareAtPrice || null, v.stock, v.durationDays, i, v.id],
        );
        keep.add(v.id);
      } else {
        await conn.execute(
          "INSERT INTO product_variants (product_id, name, price, compare_at_price, stock, duration_days, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [productId, v.name, v.price, v.compareAtPrice || null, v.stock, v.durationDays, i],
        );
      }
    }
    for (const id of existing) {
      if (keep.has(id)) continue;
      const [[used]] = (await conn.query(
        "SELECT (SELECT COUNT(*) FROM order_items WHERE variant_id = ?) + (SELECT COUNT(*) FROM inventory_items WHERE variant_id = ?) AS n",
        [id, id],
      )) as unknown as [[{ n: number }]];
      if (Number(used.n) > 0) await conn.execute("UPDATE product_variants SET is_active = 0 WHERE id = ?", [id]);
      else await conn.execute("DELETE FROM product_variants WHERE id = ?", [id]);
    }
    await syncProductFromVariants(conn, productId);
  });
}

adminRouter.post(
  "/products",
  ah(async (req, res) => {
    const d = parse(productInputSchema, req.body);
    await assertCategory(d.categoryId);
    const r = await execute(
      `INSERT INTO products (name, slug, category_id, summary, description, includes_text, instructions, delivery_text, warranty_text,
                             duration_label, account_label, price, compare_at_price, stock, max_per_order, art_glyph, art_color,
                             image_url, gallery, is_featured, is_active, delivery_mode, duration_days, low_stock_threshold)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      productParams(d),
    ).catch((e) => dup(e, "slug", "Ya existe un producto con ese slug."));
    await saveVariants(r.insertId, d.variants);
    res.status(201).json({ id: r.insertId });
  }),
);

adminRouter.put(
  "/products/:id",
  ah(async (req, res) => {
    const id = intParam(req.params.id);
    const d = parse(productInputSchema, req.body);
    await assertCategory(d.categoryId);
    const r = await execute(
      `UPDATE products SET name = ?, slug = ?, category_id = ?, summary = ?, description = ?, includes_text = ?, instructions = ?,
              delivery_text = ?, warranty_text = ?, duration_label = ?, account_label = ?, price = ?, compare_at_price = ?, stock = ?,
              max_per_order = ?, art_glyph = ?, art_color = ?, image_url = ?, gallery = ?, is_featured = ?, is_active = ?,
              delivery_mode = ?, duration_days = ?, low_stock_threshold = ?
        WHERE id = ?`,
      [...productParams(d), id],
    ).catch((e) => dup(e, "slug", "Ya existe un producto con ese slug."));
    if (!r.affectedRows) throw notFound("Producto no encontrado.");
    await saveVariants(id, d.variants);
    // Con entrega automática, el inventario es el número de cuentas disponibles.
    if (d.deliveryMode === "auto") {
      await execute(
        "UPDATE products SET stock = (SELECT COUNT(*) FROM inventory_items WHERE product_id = ? AND status = 'available') WHERE id = ?",
        [id, id],
      );
    }
    res.json({ ok: true });
  }),
);

adminRouter.patch(
  "/products/:id/stock",
  ah(async (req, res) => {
    const id = intParam(req.params.id);
    const { delta } = parse(z.object({ delta: z.number().int().min(-100000).max(100000) }), req.body);
    const mode = await queryOne<{ delivery_mode: string }>("SELECT delivery_mode FROM products WHERE id = ?", [id]);
    if (mode?.delivery_mode === "auto") throw conflict("Este producto usa inventario de cuentas: agrega o retira cuentas en Inventario.");
    if (await queryOne("SELECT id FROM product_variants WHERE product_id = ? AND is_active = 1 LIMIT 1", [id])) {
      throw conflict("Este producto tiene opciones: ajusta el inventario de cada opción al editar el producto.");
    }
    const r = await execute("UPDATE products SET stock = GREATEST(stock + ?, 0) WHERE id = ?", [delta, id]);
    if (!r.affectedRows) throw notFound("Producto no encontrado.");
    const row = await queryOne<{ stock: number }>("SELECT stock FROM products WHERE id = ?", [id]);
    res.json({ stock: row?.stock ?? 0 });
  }),
);

adminRouter.patch(
  "/products/:id/active",
  ah(async (req, res) => {
    const { isActive } = parse(z.object({ isActive: z.boolean() }), req.body);
    const r = await execute("UPDATE products SET is_active = ? WHERE id = ?", [isActive ? 1 : 0, intParam(req.params.id)]);
    if (!r.affectedRows) throw notFound("Producto no encontrado.");
    res.json({ ok: true });
  }),
);

adminRouter.delete(
  "/products/:id",
  ah(async (req, res) => {
    const id = intParam(req.params.id);
    const sold = await queryOne("SELECT 1 FROM order_items WHERE product_id = ? LIMIT 1", [id]);
    if (sold) throw conflict("Este producto tiene pedidos asociados. Desactívalo en lugar de eliminarlo.");
    const r = await execute("DELETE FROM products WHERE id = ?", [id]);
    if (!r.affectedRows) throw notFound("Producto no encontrado.");
    res.json({ ok: true });
  }),
);

/* ---------- Categorías ---------- */

adminRouter.get(
  "/categories",
  ah(async (_req, res) => {
    res.json({ items: await listCategories(true) });
  }),
);

adminRouter.post(
  "/categories",
  ah(async (req, res) => {
    const d = parse(categoryInputSchema, req.body);
    const r = await execute(
      "INSERT INTO categories (name, slug, description, icon, color, sort_order, is_active, image_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [d.name, d.slug, d.description, d.icon, d.color, d.sortOrder, d.isActive ? 1 : 0, d.imageUrl || null],
    ).catch((e) => dup(e, "slug", "Ya existe una categoría con ese slug."));
    res.status(201).json({ id: r.insertId });
  }),
);

adminRouter.put(
  "/categories/:id",
  ah(async (req, res) => {
    const d = parse(categoryInputSchema, req.body);
    const r = await execute(
      "UPDATE categories SET name = ?, slug = ?, description = ?, icon = ?, color = ?, sort_order = ?, is_active = ?, image_url = ? WHERE id = ?",
      [d.name, d.slug, d.description, d.icon, d.color, d.sortOrder, d.isActive ? 1 : 0, d.imageUrl || null, intParam(req.params.id)],
    ).catch((e) => dup(e, "slug", "Ya existe una categoría con ese slug."));
    if (!r.affectedRows) throw notFound("Categoría no encontrada.");
    res.json({ ok: true });
  }),
);

adminRouter.delete(
  "/categories/:id",
  ah(async (req, res) => {
    const id = intParam(req.params.id);
    const used = await queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM products WHERE category_id = ?", [id]);
    if (Number(used?.n) > 0) throw conflict(`La categoría tiene ${used!.n} producto(s). Muévelos o elimínalos primero.`);
    const r = await execute("DELETE FROM categories WHERE id = ?", [id]);
    if (!r.affectedRows) throw notFound("Categoría no encontrada.");
    res.json({ ok: true });
  }),
);

/* ---------- Pedidos ---------- */

adminRouter.get(
  "/orders",
  ah(async (req, res) => {
    const { page, pageSize, offset } = pageParams(req.query);
    const status = String(req.query.status ?? "");
    const statuses = (ORDER_STATUSES as readonly string[]).includes(status) ? [status] : null;
    const q = String(req.query.q ?? "").trim().slice(0, 80);
    const result = await listOrders({ statuses, q: q || undefined, limit: pageSize, offset });
    res.json({ ...result, page, pageSize });
  }),
);

adminRouter.get(
  "/orders/:code",
  ah(async (req, res) => {
    const order = await getOrder(String(req.params.code), undefined, true);
    const customer = await queryOne<any>("SELECT id, name, email FROM users WHERE id = ?", [order.customerId ?? 0]);
    const payments = await query<any>("SELECT provider, external_id, status, amount, created_at FROM payment_events WHERE order_id = ? ORDER BY id", [order.id]);
    res.json({
      order,
      customer,
      payments: payments.map((p) => ({ provider: p.provider, externalId: p.external_id, status: p.status, amount: p.amount, createdAt: toIso(p.created_at) })),
    });
  }),
);

/** Rechaza el comprobante de un pedido por transferencia: el cliente puede enviar otro. */
adminRouter.post(
  "/orders/:code/reject-proof",
  ah(async (req, res) => {
    const { reason } = parse(rejectProofSchema, req.body);
    const o = await queryOne<{ id: number; user_id: number; status: string; proof_media_id: number | null }>(
      "SELECT id, user_id, status, proof_media_id FROM orders WHERE code = ?",
      [String(req.params.code)],
    );
    if (!o) throw notFound("Pedido no encontrado.");
    if (o.status !== "pending_payment" || !o.proof_media_id) throw conflict("El pedido no tiene un comprobante pendiente de revisión.");
    await execute("UPDATE orders SET proof_media_id = NULL, proof_reference = NULL, manual_account = NULL, proof_submitted_at = NULL WHERE id = ?", [o.id]);
    await execute("INSERT INTO order_events (order_id, status, note, actor) VALUES (?, 'pending_payment', ?, 'admin')", [o.id, `Comprobante rechazado: ${reason}`]);
    await notify({
      audience: "user",
      userId: o.user_id,
      kind: "payment_rejected",
      title: `Revisamos tu comprobante del pedido ${String(req.params.code)}`,
      body: `No pudimos validarlo: ${reason}. Puedes enviar uno nuevo desde tu pedido.`,
      link: `/cuenta/pedidos/${String(req.params.code)}`,
      email: true,
    });
    res.json({ order: await getOrder(String(req.params.code), undefined, true) });
  }),
);

adminRouter.post(
  "/orders/:code/status",
  ah(async (req, res) => {
    const d = parse(orderStatusUpdateSchema, req.body);
    await changeStatus(String(req.params.code), d.status, { actor: "admin", note: d.note, refundToWallet: d.refundToWallet });
    res.json({ order: await getOrder(String(req.params.code), undefined, true) });
  }),
);

adminRouter.post(
  "/orders/:code/delivery",
  ah(async (req, res) => {
    const d = parse(orderDeliverySchema, req.body);
    const code = String(req.params.code);
    await setDelivery(code, d.items);
    if (d.complete) {
      const order = await getOrder(code, undefined, true);
      const pending = order.items.some((i) => (i.deliveryMode === "auto" ? !i.deliveries.some((d) => d.status === "sold") : !i.deliveryContent?.trim()));
      if (pending) throw badRequest("Completa la entrega de todos los productos antes de finalizar.");
      await changeStatus(code, "completed", { actor: "admin" });
    }
    res.json({ order: await getOrder(code, undefined, true) });
  }),
);

/* ---------- Clientes ---------- */

adminRouter.get(
  "/customers",
  ah(async (req, res) => {
    const { page, pageSize, offset } = pageParams(req.query);
    const q = String(req.query.q ?? "").trim().slice(0, 80);
    const where = q ? "WHERE u.name LIKE ? OR u.email LIKE ?" : "";
    const params = q ? [`%${likeEscape(q)}%`, `%${likeEscape(q)}%`] : [];
    const rows = await query<any>(
      `SELECT u.id, u.name, u.email, u.phone, u.role, u.is_active, u.created_at, u.wallet_balance,
              (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS orders,
              (SELECT COALESCE(SUM(total),0) FROM orders o WHERE o.user_id = u.id AND o.status IN ${PAID}) AS spent
         FROM users u ${where} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    );
    const total = await queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM users u ${where}`, params);
    res.json({
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        phone: r.phone,
        role: r.role,
        isActive: toBool(r.is_active),
        createdAt: toIso(r.created_at),
        orders: Number(r.orders),
        spent: Number(r.spent),
        walletBalance: Number(r.wallet_balance),
      })),
      total: Number(total?.n ?? 0),
      page,
      pageSize,
    });
  }),
);

adminRouter.patch(
  "/customers/:id",
  ah(async (req, res) => {
    const id = intParam(req.params.id);
    const d = parse(userAdminUpdateSchema, req.body);
    if (id === req.user!.id && (d.role === "customer" || d.isActive === false)) {
      throw badRequest("No puedes quitarte permisos ni desactivar tu propia cuenta.");
    }
    if (d.role) await execute("UPDATE users SET role = ? WHERE id = ?", [d.role, id]);
    if (d.isActive !== undefined) {
      await execute("UPDATE users SET is_active = ? WHERE id = ?", [d.isActive ? 1 : 0, id]);
      if (!d.isActive) await execute("DELETE FROM sessions WHERE user_id = ?", [id]);
    }
    res.json({ ok: true });
  }),
);

/* ---------- Cupones ---------- */

const mapCoupon = (r: any) => ({
  id: r.id,
  code: r.code,
  description: r.description,
  kind: r.kind,
  value: Number(r.value),
  minSubtotal: Number(r.min_subtotal),
  maxUses: r.max_uses === null ? null : Number(r.max_uses),
  usedCount: Number(r.used_count),
  startsAt: toIso(r.starts_at),
  endsAt: toIso(r.ends_at),
  isActive: toBool(r.is_active),
});

const toDate = (v: string | null) => {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw badRequest("Fecha inválida.");
  return d;
};

adminRouter.get(
  "/coupons",
  ah(async (_req, res) => {
    res.json({ items: (await query("SELECT * FROM coupons ORDER BY created_at DESC")).map(mapCoupon) });
  }),
);

function couponParams(d: z.infer<typeof couponInputSchema>) {
  return [d.code, d.description, d.kind, d.value, d.minSubtotal, d.maxUses, toDate(d.startsAt), toDate(d.endsAt), d.isActive ? 1 : 0];
}

adminRouter.post(
  "/coupons",
  ah(async (req, res) => {
    const d = parse(couponInputSchema, req.body);
    const r = await execute(
      "INSERT INTO coupons (code, description, kind, value, min_subtotal, max_uses, starts_at, ends_at, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      couponParams(d),
    ).catch((e) => dup(e, "code", "Ya existe un cupón con ese código."));
    res.status(201).json({ id: r.insertId });
  }),
);

adminRouter.put(
  "/coupons/:id",
  ah(async (req, res) => {
    const d = parse(couponInputSchema, req.body);
    const r = await execute(
      "UPDATE coupons SET code = ?, description = ?, kind = ?, value = ?, min_subtotal = ?, max_uses = ?, starts_at = ?, ends_at = ?, is_active = ? WHERE id = ?",
      [...couponParams(d), intParam(req.params.id)],
    ).catch((e) => dup(e, "code", "Ya existe un cupón con ese código."));
    if (!r.affectedRows) throw notFound("Cupón no encontrado.");
    res.json({ ok: true });
  }),
);

adminRouter.delete(
  "/coupons/:id",
  ah(async (req, res) => {
    const r = await execute("DELETE FROM coupons WHERE id = ?", [intParam(req.params.id)]);
    if (!r.affectedRows) throw notFound("Cupón no encontrado.");
    res.json({ ok: true });
  }),
);

/* ---------- Contenido (blog) ---------- */

const mapPost = (r: any) => ({
  id: r.id,
  slug: r.slug,
  title: r.title,
  excerpt: r.excerpt,
  body: r.body,
  isPublished: toBool(r.is_published),
  publishedAt: toIso(r.published_at),
  updatedAt: toIso(r.updated_at),
});

adminRouter.get(
  "/posts",
  ah(async (_req, res) => {
    res.json({ items: (await query("SELECT * FROM posts ORDER BY updated_at DESC")).map(mapPost) });
  }),
);

adminRouter.post(
  "/posts",
  ah(async (req, res) => {
    const d = parse(postInputSchema, req.body);
    const r = await execute(
      "INSERT INTO posts (title, slug, excerpt, body, is_published, published_at) VALUES (?, ?, ?, ?, ?, IF(?, UTC_TIMESTAMP(), NULL))",
      [d.title, d.slug, d.excerpt, d.body, d.isPublished ? 1 : 0, d.isPublished ? 1 : 0],
    ).catch((e) => dup(e, "slug", "Ya existe un artículo con ese slug."));
    res.status(201).json({ id: r.insertId });
  }),
);

adminRouter.put(
  "/posts/:id",
  ah(async (req, res) => {
    const d = parse(postInputSchema, req.body);
    const r = await execute(
      `UPDATE posts SET title = ?, slug = ?, excerpt = ?, body = ?, is_published = ?,
              published_at = CASE WHEN ? = 1 THEN COALESCE(published_at, UTC_TIMESTAMP()) ELSE NULL END
        WHERE id = ?`,
      [d.title, d.slug, d.excerpt, d.body, d.isPublished ? 1 : 0, d.isPublished ? 1 : 0, intParam(req.params.id)],
    ).catch((e) => dup(e, "slug", "Ya existe un artículo con ese slug."));
    if (!r.affectedRows) throw notFound("Artículo no encontrado.");
    res.json({ ok: true });
  }),
);

adminRouter.delete(
  "/posts/:id",
  ah(async (req, res) => {
    const r = await execute("DELETE FROM posts WHERE id = ?", [intParam(req.params.id)]);
    if (!r.affectedRows) throw notFound("Artículo no encontrado.");
    res.json({ ok: true });
  }),
);

/* ---------- Configuración ---------- */

adminRouter.get(
  "/settings",
  ah(async (_req, res) => {
    res.json({
      campaign: await getSetting("campaign", DEFAULT_CAMPAIGN),
      store: await getSetting("store", DEFAULT_STORE),
      crypto: await getSetting("crypto", DEFAULT_CRYPTO),
      paymentMethods: await paymentMethods(),
      manualAccounts: await getManualAccounts(true),
      paymentDisplay: await getPaymentDisplay(),
    });
  }),
);

/** Cuentas para pagos por transferencia con comprobante (Nequi, Bre-B, QR…). */
adminRouter.put(
  "/settings/manual-accounts",
  ah(async (req, res) => {
    const d = parse(manualAccountsSchema, req.body);
    res.json({ accounts: await saveManualAccounts(d.accounts) });
  }),
);

/** Logo y nombre visibles de cada método de pago. */
adminRouter.put(
  "/settings/payment-display",
  ah(async (req, res) => {
    await setSetting("paymentDisplay", parse(paymentDisplaySchema, req.body));
    res.json({ paymentMethods: await paymentMethods() });
  }),
);

adminRouter.put(
  "/settings/campaign",
  ah(async (req, res) => {
    await setSetting("campaign", parse(campaignSchema, req.body));
    res.json({ ok: true });
  }),
);

adminRouter.put(
  "/settings/store",
  ah(async (req, res) => {
    await setSetting("store", parse(storeSettingsSchema, req.body));
    res.json({ ok: true });
  }),
);

adminRouter.get(
  "/settings/integrations",
  ah(async (_req, res) => {
    const base = publicUrl();
    res.json({
      values: publicView(),
      detectedUrl: detectedUrl(),
      publicUrl: base,
      webhooks: {
        wompi: `${base}/api/payments/webhooks/wompi`,
        mercadopago: `${base}/api/payments/webhooks/mercadopago`,
        zenobank: `${base}/api/payments/webhooks/zenobank`,
        googleRedirect: `${base}/api/auth/google/callback`,
      },
      envOverrides: { encryptionKeyFromEnv: Boolean(process.env.INVENTORY_ENCRYPTION_KEY?.trim()) },
    });
  }),
);

adminRouter.put(
  "/settings/integrations",
  ah(async (req, res) => {
    const d = parse(integrationsSchema, req.body);
    await saveIntegrations({ ...d, siteUrl: d.siteUrl?.replace(/\/$/, "") });
    res.json({ ok: true, values: publicView() });
  }),
);

adminRouter.post(
  "/settings/integrations/test-email",
  ah(async (req, res) => {
    try {
      await testMail(req.user!.email);
    } catch (err) {
      throw badRequest(`No se pudo enviar: ${err instanceof Error ? err.message : "error desconocido"}`);
    }
    res.json({ ok: true, to: req.user!.email });
  }),
);

adminRouter.put(
  "/settings/crypto",
  ah(async (req, res) => {
    await setSetting("crypto", parse(cryptoSettingsSchema, req.body));
    res.json({ ok: true });
  }),
);

/* ---------- Reportes ---------- */

async function reportData(from: Date, to: Date) {
  const params = [from, to];
  const totals = await queryOne<any>(
    `SELECT COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue, COALESCE(SUM(discount),0) AS discounts, COALESCE(AVG(total),0) AS avg_ticket
       FROM orders WHERE status IN ${PAID} AND paid_at BETWEEN ? AND ?`,
    params,
  );
  const byCategory = await query<any>(
    `SELECT COALESCE(c.name, 'Sin categoría') AS name, SUM(oi.quantity) AS units, SUM(oi.quantity * oi.unit_price) AS revenue
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       LEFT JOIN products p ON p.id = oi.product_id LEFT JOIN categories c ON c.id = p.category_id
      WHERE o.status IN ${PAID} AND o.paid_at BETWEEN ? AND ?
      GROUP BY c.name ORDER BY revenue DESC`,
    params,
  );
  const byProvider = await query<any>(
    `SELECT payment_provider AS provider, COUNT(*) AS orders, SUM(total) AS revenue FROM orders
      WHERE status IN ${PAID} AND paid_at BETWEEN ? AND ? GROUP BY payment_provider ORDER BY revenue DESC`,
    params,
  );
  const topProducts = await query<any>(
    `SELECT oi.product_name AS name, SUM(oi.quantity) AS units, SUM(oi.quantity * oi.unit_price) AS revenue
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.status IN ${PAID} AND o.paid_at BETWEEN ? AND ?
      GROUP BY oi.product_name ORDER BY revenue DESC LIMIT 10`,
    params,
  );
  const num = (rows: any[]) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "string" && k !== "name" && k !== "provider" ? Number(v) : v])));
  return {
    totals: { orders: Number(totals?.orders ?? 0), revenue: Number(totals?.revenue ?? 0), discounts: Number(totals?.discounts ?? 0), avgTicket: Math.round(Number(totals?.avg_ticket ?? 0)) },
    byCategory: num(byCategory),
    byProvider: num(byProvider),
    topProducts: num(topProducts),
  };
}

const rangeQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

function parseRange(q: unknown) {
  const { from, to } = parse(rangeQuery, q);
  const f = new Date(`${from}T00:00:00Z`);
  const t = new Date(`${to}T23:59:59Z`);
  if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime()) || f > t) throw badRequest("Rango de fechas inválido.");
  return { f, t };
}

adminRouter.get(
  "/reports",
  ah(async (req, res) => {
    const { f, t } = parseRange(req.query);
    res.json(await reportData(f, t));
  }),
);

/** CSV de pedidos pagados (separador ;, compatible con Excel en español). */
adminRouter.get(
  "/reports/orders.csv",
  ah(async (req, res: Response) => {
    const { f, t } = parseRange(req.query);
    const rows = await query<any>(
      `SELECT code, status, payment_provider, subtotal, discount, total, coupon_code, buyer_name, buyer_email, created_at, paid_at
         FROM orders WHERE created_at BETWEEN ? AND ? ORDER BY created_at`,
      [f, t],
    );
    // Neutraliza fórmulas (inyección CSV) y escapa comillas.
    const cell = (v: unknown) => {
      let s = v instanceof Date ? v.toISOString() : v === null || v === undefined ? "" : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const header = ["Pedido", "Estado", "Pago", "Subtotal", "Descuento", "Total", "Cupón", "Cliente", "Correo", "Creado", "Pagado"];
    const csv = [header, ...rows.map((r) => Object.values(r))].map((r) => r.map(cell).join(";")).join("\r\n");
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="pedidos-${req.query.from}-${req.query.to}.csv"`);
    res.send(`﻿${csv}`);
  }),
);

