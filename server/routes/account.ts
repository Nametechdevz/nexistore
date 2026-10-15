import { Router } from "express";
import { z } from "zod";
import { execute, query, queryOne, toBool, toIso, transaction } from "../db.js";
import { ah, HttpError, intParam, notFound, parse } from "../lib/http.js";
import { hashPassword, verifyPassword } from "../lib/security.js";
import { requireAuth } from "../middleware/session.js";
import { PAYMENT_PROVIDERS } from "../../shared/constants.js";
import { addressSchema, changePasswordSchema, profileSchema, ticketSchema } from "../../shared/schemas.js";

export const accountRouter = Router();
accountRouter.use(requireAuth);

accountRouter.patch(
  "/profile",
  ah(async (req, res) => {
    const data = parse(profileSchema, req.body);
    await execute("UPDATE users SET name = ?, phone = ?, document_id = ? WHERE id = ?", [
      data.name,
      data.phone || null,
      data.documentId || null,
      req.user!.id,
    ]);
    res.json({ ok: true });
  }),
);

accountRouter.post(
  "/password",
  ah(async (req, res) => {
    const data = parse(changePasswordSchema, req.body);
    const row = await queryOne<{ password_hash: string | null }>("SELECT password_hash FROM users WHERE id = ?", [req.user!.id]);
    if (row?.password_hash && !(await verifyPassword(data.currentPassword, row.password_hash))) {
      throw new HttpError(422, "Revisa los datos del formulario.", { currentPassword: "La contraseña actual no es correcta." });
    }
    await execute("UPDATE users SET password_hash = ? WHERE id = ?", [await hashPassword(data.password), req.user!.id]);
    // Cierra las demás sesiones.
    await execute("DELETE FROM sessions WHERE user_id = ? AND id <> ?", [req.user!.id, req.sessionId ?? ""]);
    res.json({ ok: true });
  }),
);

accountRouter.put(
  "/payment-preference",
  ah(async (req, res) => {
    const { provider } = parse(z.object({ provider: z.enum(PAYMENT_PROVIDERS).nullable() }), req.body);
    await execute("UPDATE users SET preferred_payment = ? WHERE id = ?", [provider, req.user!.id]);
    res.json({ ok: true });
  }),
);

accountRouter.get(
  "/summary",
  ah(async (req, res) => {
    const counts = await queryOne<{ total: number; completed: number; pending: number; spent: number }>(
      `SELECT COUNT(*) AS total, SUM(status = 'completed') AS completed,
              SUM(status IN ('pending_payment','paid','processing')) AS pending,
              COALESCE(SUM(CASE WHEN status IN ('paid','processing','completed') THEN total END), 0) AS spent
         FROM orders WHERE user_id = ?`,
      [req.user!.id],
    );
    res.json({
      total: Number(counts?.total ?? 0),
      completed: Number(counts?.completed ?? 0),
      pending: Number(counts?.pending ?? 0),
      spent: Number(counts?.spent ?? 0),
    });
  }),
);

/* ---------- Direcciones de facturación ---------- */

const mapAddress = (r: Record<string, unknown>) => ({
  id: r.id,
  label: r.label,
  line1: r.line1,
  city: r.city,
  region: r.region,
  phone: r.phone,
  isDefault: toBool(r.is_default),
});

accountRouter.get(
  "/addresses",
  ah(async (req, res) => {
    const rows = await query("SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, id", [req.user!.id]);
    res.json({ items: rows.map(mapAddress) });
  }),
);

async function saveAddress(userId: number, data: z.infer<typeof addressSchema>, id?: number) {
  await transaction(async (conn) => {
    if (data.isDefault) await conn.execute("UPDATE addresses SET is_default = 0 WHERE user_id = ?", [userId]);
    if (id) {
      const [r] = await conn.execute<import("mysql2").ResultSetHeader>(
        "UPDATE addresses SET label = ?, line1 = ?, city = ?, region = ?, phone = ?, is_default = ? WHERE id = ? AND user_id = ?",
        [data.label, data.line1, data.city, data.region, data.phone ?? "", data.isDefault ? 1 : 0, id, userId],
      );
      if (!r.affectedRows) throw notFound("Dirección no encontrada.");
    } else {
      const [[{ n }]] = (await conn.query("SELECT COUNT(*) AS n FROM addresses WHERE user_id = ?", [userId])) as unknown as [[{ n: number }]];
      if (n >= 10) throw new HttpError(422, "Puedes guardar máximo 10 direcciones.");
      await conn.execute("INSERT INTO addresses (user_id, label, line1, city, region, phone, is_default) VALUES (?, ?, ?, ?, ?, ?, ?)", [
        userId,
        data.label,
        data.line1,
        data.city,
        data.region,
        data.phone ?? "",
        data.isDefault || n === 0 ? 1 : 0,
      ]);
    }
  });
}

accountRouter.post(
  "/addresses",
  ah(async (req, res) => {
    await saveAddress(req.user!.id, parse(addressSchema, req.body));
    res.status(201).json({ ok: true });
  }),
);

accountRouter.put(
  "/addresses/:id",
  ah(async (req, res) => {
    await saveAddress(req.user!.id, parse(addressSchema, req.body), intParam(req.params.id));
    res.json({ ok: true });
  }),
);

accountRouter.delete(
  "/addresses/:id",
  ah(async (req, res) => {
    const r = await execute("DELETE FROM addresses WHERE id = ? AND user_id = ?", [intParam(req.params.id), req.user!.id]);
    if (!r.affectedRows) throw notFound("Dirección no encontrada.");
    res.json({ ok: true });
  }),
);

/* ---------- Cupones disponibles ---------- */

accountRouter.get(
  "/coupons",
  ah(async (_req, res) => {
    const rows = await query<Record<string, unknown>>(
      `SELECT code, description, kind, value, min_subtotal, ends_at FROM coupons
        WHERE is_active = 1 AND (starts_at IS NULL OR starts_at <= UTC_TIMESTAMP())
          AND (ends_at IS NULL OR ends_at >= UTC_TIMESTAMP())
          AND (max_uses IS NULL OR used_count < max_uses)
        ORDER BY created_at DESC LIMIT 20`,
    );
    res.json({
      items: rows.map((r) => ({
        code: r.code,
        description: r.description,
        kind: r.kind,
        value: Number(r.value),
        minSubtotal: Number(r.min_subtotal),
        endsAt: toIso(r.ends_at),
      })),
    });
  }),
);

/* ---------- Soporte ---------- */

accountRouter.get(
  "/tickets",
  ah(async (req, res) => {
    const rows = await query<Record<string, unknown>>("SELECT * FROM support_tickets WHERE user_id = ? ORDER BY created_at DESC LIMIT 50", [req.user!.id]);
    res.json({
      items: rows.map((r) => ({
        id: r.id,
        subject: r.subject,
        message: r.message,
        orderCode: r.order_code,
        status: r.status,
        adminReply: r.admin_reply,
        createdAt: toIso(r.created_at),
      })),
    });
  }),
);

accountRouter.post(
  "/tickets",
  ah(async (req, res) => {
    const data = parse(ticketSchema, req.body);
    if (data.orderCode) {
      const own = await queryOne("SELECT id FROM orders WHERE code = ? AND user_id = ?", [data.orderCode, req.user!.id]);
      if (!own) throw new HttpError(422, "Revisa los datos del formulario.", { orderCode: "No encontramos ese pedido en tu cuenta." });
    }
    const open = await queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM support_tickets WHERE user_id = ? AND status = 'open'", [req.user!.id]);
    if (Number(open?.n) >= 5) throw new HttpError(429, "Tienes 5 solicitudes abiertas. Espera nuestra respuesta antes de crear otra.");
    await execute("INSERT INTO support_tickets (user_id, order_code, subject, message) VALUES (?, ?, ?, ?)", [
      req.user!.id,
      data.orderCode || null,
      data.subject,
      data.message,
    ]);
    res.status(201).json({ ok: true });
  }),
);
