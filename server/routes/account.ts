import express, { Router } from "express";
import { z } from "zod";
import { execute, query, queryOne, toBool, toIso, transaction } from "../db.js";
import { ah, badRequest, HttpError, intParam, notFound, parse } from "../lib/http.js";
import { hashPassword, verifyPassword } from "../lib/security.js";
import { requireAuth } from "../middleware/session.js";
import { PAYMENT_PROVIDERS } from "../../shared/constants.js";
import { addressSchema, changePasswordSchema, profileSchema, ticketMessageSchema, ticketSchema, topupSchema } from "../../shared/schemas.js";
import { adapters, foreignQuoteFor, isProviderReady } from "../payments/index.js";
import { listNotifications, markRead, notify } from "../services/notifications.js";
import { applyVerifiedPayment } from "../services/orders.js";
import { addMessage, createTicket, getTicket, listTickets } from "../services/support.js";
import { newTopupCode, walletSummary } from "../services/wallet.js";
import { MAX_MEDIA_BYTES, ownedProofId, saveMedia, sniffImage } from "../services/media.js";
import { accountSnapshot, findManualAccount } from "../services/manual-pay.js";
import { formatCOP } from "../../shared/pricing.js";

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
    const counts = await queryOne<{ total: number; completed: number; pending: number; spent: number; wallet: number }>(
      `SELECT COUNT(*) AS total, SUM(status = 'completed') AS completed,
              SUM(status IN ('pending_payment','paid','processing')) AS pending,
              COALESCE(SUM(CASE WHEN status IN ('paid','processing','completed') THEN total END), 0) AS spent,
              (SELECT wallet_balance FROM users WHERE id = ?) AS wallet
         FROM orders WHERE user_id = ?`,
      [req.user!.id, req.user!.id],
    );
    res.json({
      wallet: Number(counts?.wallet ?? 0),
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

/* ---------- Soporte (conversación) ---------- */

accountRouter.get(
  "/tickets",
  ah(async (req, res) => {
    res.json({ items: await listTickets({ userId: req.user!.id }) });
  }),
);

accountRouter.get(
  "/tickets/:id",
  ah(async (req, res) => {
    res.json({ ticket: await getTicket(intParam(req.params.id), req.user!.id) });
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
    const id = await createTicket(req.user!.id, { subject: data.subject, message: data.message, orderCode: data.orderCode || null });
    res.status(201).json({ id });
  }),
);

accountRouter.post(
  "/tickets/:id/messages",
  ah(async (req, res) => {
    const { body } = parse(ticketMessageSchema, req.body);
    await addMessage(intParam(req.params.id), { role: "customer", id: req.user!.id }, body);
    res.status(201).json({ ticket: await getTicket(intParam(req.params.id), req.user!.id) });
  }),
);

/* ---------- Notificaciones ---------- */

accountRouter.get(
  "/notifications",
  ah(async (req, res) => {
    res.json(await listNotifications("user", req.user!.id));
  }),
);

accountRouter.post(
  "/notifications/read",
  ah(async (req, res) => {
    const { ids } = parse(z.object({ ids: z.union([z.literal("all"), z.array(z.number().int().positive()).max(100)]) }), req.body);
    await markRead("user", req.user!.id, ids);
    res.json({ ok: true });
  }),
);

/* ---------- Comprobantes ---------- */

/** Sube la imagen de un comprobante (privada: solo la ve el cliente y los administradores). */
accountRouter.post(
  "/proofs",
  express.raw({ type: () => true, limit: MAX_MEDIA_BYTES }),
  ah(async (req, res) => {
    const buf = Buffer.isBuffer(req.body) ? req.body : null;
    if (!buf?.length) throw badRequest("No llegó ninguna imagen.");
    if (!sniffImage(buf)) throw badRequest("Formato no admitido. Usa una imagen JPG, PNG o WebP.");
    const recent = await queryOne<{ n: number }>(
      "SELECT COUNT(*) AS n FROM media WHERE owner_id = ? AND is_private = 1 AND created_at > (UTC_TIMESTAMP() - INTERVAL 1 HOUR)",
      [req.user!.id],
    );
    if (Number(recent?.n) >= 15) throw new HttpError(429, "Subiste muchos comprobantes en poco tiempo. Inténtalo más tarde.");
    res.status(201).json(await saveMedia(buf, req.user!.id, { private: true }));
  }),
);

/* ---------- Billetera ---------- */

accountRouter.get(
  "/wallet",
  ah(async (req, res) => {
    res.json(await walletSummary(req.user!.id));
  }),
);

accountRouter.post(
  "/wallet/topups",
  ah(async (req, res) => {
    const data = parse(topupSchema, req.body);
    const ready = await isProviderReady(data.provider);
    const adapter = adapters[data.provider];
    if (!ready.ok) throw new HttpError(422, `${adapter.label} no está disponible.`, { provider: ready.reason ?? "" });
    // Transferencia: exige la cuenta usada, la referencia y la imagen del comprobante.
    let manual: { mediaId: number; reference: string; account: string } | null = null;
    if (data.provider === "manual") {
      const fields: Record<string, string> = {};
      const account = data.accountId ? await findManualAccount(data.accountId) : null;
      if (!account) fields.accountId = "Elige la cuenta a la que transferiste.";
      const reference = (data.reference ?? "").trim();
      if (reference.length < 4) fields.reference = "Escribe la referencia o número del comprobante.";
      const mediaId = data.proofUrl ? await ownedProofId(data.proofUrl, req.user!.id) : null;
      if (!mediaId) fields.proofUrl = "Sube la imagen del comprobante.";
      if (Object.keys(fields).length) throw new HttpError(422, "Completa los datos del comprobante.", fields);
      manual = { mediaId: mediaId!, reference, account: accountSnapshot(account!) };
    }
    const pending = await queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM wallet_topups WHERE user_id = ? AND status = 'pending'", [req.user!.id]);
    if (Number(pending?.n) >= 3) throw new HttpError(429, "Tienes 3 recargas pendientes. Complétalas o espera a que venzan.");
    const quote = await foreignQuoteFor(data.provider);
    const foreign = quote ? quote(data.amount) : null;
    const code = newTopupCode();
    await execute(
      `INSERT INTO wallet_topups (code, user_id, amount, provider, payment_currency, payment_amount_foreign, proof_media_id, proof_reference, manual_account)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [code, req.user!.id, data.amount, data.provider, foreign?.currency ?? null, foreign?.amount ?? null, manual?.mediaId ?? null, manual?.reference ?? null, manual?.account ?? null],
    );
    const u = req.user!;
    let action;
    try {
      action = await adapter.createCheckout({
        code,
        total: data.amount,
        buyerName: u.name,
        buyerEmail: u.email,
        buyerPhone: u.phone ?? "",
        buyerDocument: u.documentId ?? "",
        foreign,
        description: `Recarga de billetera NexiStore ${code}`,
      });
    } catch (err) {
      console.error("Error creando recarga:", err);
      await execute("UPDATE wallet_topups SET status = 'cancelled' WHERE code = ?", [code]);
      throw new HttpError(502, "No pudimos conectar con la pasarela de pago. Inténtalo más tarde.");
    }
    if (action.type === "redirect" && action.externalRef) {
      await execute("UPDATE wallet_topups SET payment_ref = ? WHERE code = ?", [action.externalRef, code]);
    }
    if (data.provider === "manual") {
      await notify({
        audience: "admin",
        kind: "topup",
        title: `Recarga por revisar: ${formatCOP(data.amount)}`,
        body: `${u.name} · ${manual?.account ?? ""} · ref. ${manual?.reference ?? ""}`,
        link: "/admin/billetera",
        email: true,
      });
    }
    res.status(201).json({ code, action, foreign });
  }),
);

/** Consulta activa del pago de una recarga al volver de la pasarela. */
accountRouter.post(
  "/wallet/topups/:code/verify",
  ah(async (req, res) => {
    const t = await queryOne<{ code: string; provider: string; status: string; payment_ref: string | null }>("SELECT code, provider, status, payment_ref FROM wallet_topups WHERE code = ? AND user_id = ?", [
      String(req.params.code),
      req.user!.id,
    ]);
    if (!t) throw notFound("Recarga no encontrada.");
    let result = "skipped";
    const adapter = adapters[t.provider as keyof typeof adapters];
    if (t.status === "pending" && adapter?.verify && adapter.isConfigured()) {
      const params = z.record(z.string(), z.string().max(100)).catch({}).parse(req.body?.params ?? {});
      try {
        const v = await adapter.verify(t.code, params, t.payment_ref);
        result = v && v.orderCode === t.code ? await applyVerifiedPayment(v) : "not_found";
      } catch (err) {
        console.error("Error verificando recarga:", err);
        result = "error";
      }
    }
    res.json({ result, wallet: await walletSummary(req.user!.id) });
  }),
);
