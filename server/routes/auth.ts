import { Router } from "express";
import rateLimit from "express-rate-limit";
import { config } from "../config.js";
import { execute, queryOne, transaction } from "../db.js";
import { ah, badRequest, conflict, HttpError, parse } from "../lib/http.js";
import { burnPasswordCheck, hashPassword, randomToken, sha256, verifyPassword } from "../lib/security.js";
import { createSession, destroySession, CSRF_COOKIE } from "../middleware/session.js";
import { sendMail } from "../services/mailer.js";
import { forgotSchema, loginSchema, registerSchema, resetSchema } from "../../shared/schemas.js";
import { integ, publicUrl } from "../services/integrations.js";

export const authRouter = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.NODE_ENV === "test" ? 1000 : 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Demasiados intentos. Espera unos minutos e inténtalo de nuevo." },
});

authRouter.get(
  "/me",
  ah(async (req, res) => {
    res.json({
      user: req.user ?? null,
      csrfToken: req.cookies[CSRF_COOKIE],
      googleEnabled: Boolean(integ().googleClientId && integ().googleClientSecret),
    });
  }),
);

authRouter.post(
  "/register",
  authLimiter,
  ah(async (req, res) => {
    const data = parse(registerSchema, req.body);
    const exists = await queryOne("SELECT id FROM users WHERE email = ?", [data.email]);
    if (exists) throw conflict("Ya existe una cuenta con este correo.", { email: "Ya existe una cuenta con este correo." });
    const hash = await hashPassword(data.password);
    const r = await execute("INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)", [data.email, hash, data.name]);
    await createSession(req, res, r.insertId, true);
    res.status(201).json({ ok: true });
  }),
);

authRouter.post(
  "/login",
  authLimiter,
  ah(async (req, res) => {
    const data = parse(loginSchema, req.body);
    const user = await queryOne<{ id: number; password_hash: string | null; is_active: number }>(
      "SELECT id, password_hash, is_active FROM users WHERE email = ?",
      [data.email],
    );
    if (!user) {
      await burnPasswordCheck(data.password);
      throw new HttpError(401, "Correo o contraseña incorrectos.");
    }
    const ok = await verifyPassword(data.password, user.password_hash);
    if (!ok) throw new HttpError(401, "Correo o contraseña incorrectos.");
    if (!user.is_active) throw new HttpError(403, "Tu cuenta está desactivada. Contacta a soporte.");
    await createSession(req, res, user.id, data.remember);
    res.json({ ok: true });
  }),
);

authRouter.post(
  "/logout",
  ah(async (req, res) => {
    await destroySession(req, res);
    res.json({ ok: true });
  }),
);

authRouter.post(
  "/forgot",
  authLimiter,
  ah(async (req, res) => {
    const { email } = parse(forgotSchema, req.body);
    const user = await queryOne<{ id: number; name: string }>("SELECT id, name FROM users WHERE email = ? AND is_active = 1", [email]);
    if (user) {
      const token = randomToken();
      await execute("INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)", [
        sha256(token),
        user.id,
        new Date(Date.now() + 60 * 60 * 1000),
      ]);
      const link = `${publicUrl()}/restablecer/${token}`;
      await sendMail(
        email,
        "Restablece tu contraseña de NexiStore",
        `Hola ${user.name},\n\nPara crear una nueva contraseña abre este enlace (válido por 1 hora):\n${link}\n\nSi no lo solicitaste, ignora este mensaje.`,
      );
    }
    // Misma respuesta exista o no la cuenta (no revela correos registrados).
    res.json({ ok: true });
  }),
);

authRouter.post(
  "/reset",
  authLimiter,
  ah(async (req, res) => {
    const data = parse(resetSchema, req.body);
    const hash = await hashPassword(data.password);
    await transaction(async (conn) => {
      const [rows] = await conn.query<import("mysql2").RowDataPacket[]>(
        "SELECT user_id FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > UTC_TIMESTAMP() FOR UPDATE",
        [sha256(data.token)],
      );
      const row = rows[0];
      if (!row) throw badRequest("El enlace no es válido o ya expiró. Solicita uno nuevo.");
      await conn.execute("UPDATE password_resets SET used_at = UTC_TIMESTAMP() WHERE token_hash = ?", [sha256(data.token)]);
      await conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", [hash, row.user_id]);
      // Cierra todas las sesiones abiertas de esa cuenta.
      await conn.execute("DELETE FROM sessions WHERE user_id = ?", [row.user_id]);
    });
    res.json({ ok: true });
  }),
);

/* ---------- Google OAuth 2.0 (código de autorización) ---------- */

const GOOGLE_STATE = "nx_gstate";

authRouter.get(
  "/google",
  ah(async (req, res) => {
    if (!integ().googleClientId || !integ().googleClientSecret) {
      return res.redirect("/ingresar?error=google_no_configurado");
    }
    const state = randomToken(16);
    res.cookie(GOOGLE_STATE, state, { httpOnly: true, secure: config.isProd, sameSite: "lax", maxAge: 10 * 60 * 1000, path: "/" });
    const params = new URLSearchParams({
      client_id: integ().googleClientId,
      redirect_uri: `${publicUrl()}/api/auth/google/callback`,
      response_type: "code",
      scope: "openid email profile",
      state,
      prompt: "select_account",
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  }),
);

authRouter.get(
  "/google/callback",
  ah(async (req, res) => {
    const { code, state } = req.query;
    const expected = req.cookies[GOOGLE_STATE];
    res.clearCookie(GOOGLE_STATE, { path: "/" });
    if (!integ().googleClientId || !integ().googleClientSecret) return res.redirect("/ingresar?error=google_no_configurado");
    if (typeof code !== "string" || typeof state !== "string" || !expected || state !== expected) {
      return res.redirect("/ingresar?error=google_estado");
    }
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: integ().googleClientId,
        client_secret: integ().googleClientSecret,
        redirect_uri: `${publicUrl()}/api/auth/google/callback`,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) return res.redirect("/ingresar?error=google_token");
    const tokens = (await tokenRes.json()) as { access_token?: string };
    const infoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    if (!infoRes.ok) return res.redirect("/ingresar?error=google_perfil");
    const info = (await infoRes.json()) as { sub: string; email?: string; email_verified?: boolean; name?: string };
    if (!info.email || !info.email_verified) return res.redirect("/ingresar?error=google_correo");
    const email = info.email.toLowerCase();

    let user = await queryOne<{ id: number; is_active: number }>("SELECT id, is_active FROM users WHERE google_sub = ? OR email = ? ORDER BY google_sub = ? DESC LIMIT 1", [
      info.sub,
      email,
      info.sub,
    ]);
    if (!user) {
      const r = await execute("INSERT INTO users (email, name, google_sub) VALUES (?, ?, ?)", [email, (info.name ?? email).slice(0, 120), info.sub]);
      user = { id: r.insertId, is_active: 1 };
    } else {
      await execute("UPDATE users SET google_sub = ? WHERE id = ? AND google_sub IS NULL", [info.sub, user.id]);
    }
    if (!user.is_active) return res.redirect("/ingresar?error=cuenta_inactiva");
    await createSession(req, res, user.id, true);
    res.redirect("/cuenta");
  }),
);
