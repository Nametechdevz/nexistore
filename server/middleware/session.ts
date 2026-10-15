import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";
import { execute, queryOne } from "../db.js";
import { forbidden, HttpError, unauthorized } from "../lib/http.js";
import { randomToken, safeEqual, sha256 } from "../lib/security.js";
import type { SessionUser } from "../../shared/types.js";

export const SESSION_COOKIE = "nx_sid";
export const CSRF_COOKIE = "nx_csrf";
export const CSRF_HEADER = "x-csrf-token";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
      sessionId?: string;
      cookies: Record<string, string>;
    }
  }
}

export function parseCookies(req: Request, _res: Response, next: NextFunction) {
  const out: Record<string, string> = {};
  const header = req.headers.cookie;
  if (header) {
    for (const part of header.split(";")) {
      const i = part.indexOf("=");
      if (i < 0) continue;
      const k = part.slice(0, i).trim();
      try {
        out[k] = decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        /* cookie mal formada: se ignora */
      }
    }
  }
  req.cookies = out;
  next();
}

const baseCookie = () => ({
  httpOnly: true,
  secure: config.isProd,
  sameSite: "lax" as const,
  path: "/",
});

interface SessionRow {
  user_id: number;
  email: string;
  name: string;
  phone: string | null;
  document_id: string | null;
  role: "customer" | "admin";
  preferred_payment: string | null;
}

export async function loadSession(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies[SESSION_COOKIE];
    if (token && /^[a-f0-9]{64}$/.test(token)) {
      const id = sha256(token);
      const row = await queryOne<SessionRow>(
        `SELECT s.user_id, u.email, u.name, u.phone, u.document_id, u.role, u.preferred_payment
           FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.id = ? AND s.expires_at > UTC_TIMESTAMP() AND u.is_active = 1`,
        [id],
      );
      if (row) {
        req.sessionId = id;
        req.user = {
          id: row.user_id,
          email: row.email,
          name: row.name,
          phone: row.phone,
          documentId: row.document_id,
          role: row.role,
          preferredPayment: row.preferred_payment,
        };
      }
    }
    next();
  } catch (err) {
    next(err);
  }
}

export async function createSession(req: Request, res: Response, userId: number, remember: boolean) {
  const token = randomToken();
  const days = remember ? config.SESSION_DAYS : 1;
  const expires = new Date(Date.now() + days * 86_400_000);
  await execute("INSERT INTO sessions (id, user_id, user_agent, expires_at) VALUES (?, ?, ?, ?)", [
    sha256(token),
    userId,
    String(req.headers["user-agent"] ?? "").slice(0, 255),
    expires,
  ]);
  res.cookie(SESSION_COOKIE, token, { ...baseCookie(), ...(remember ? { expires } : {}) });
  // Nuevo token CSRF tras iniciar sesión (evita fijación).
  issueCsrf(res);
}

export async function destroySession(req: Request, res: Response) {
  if (req.sessionId) await execute("DELETE FROM sessions WHERE id = ?", [req.sessionId]);
  res.clearCookie(SESSION_COOKIE, baseCookie());
}

function issueCsrf(res: Response): string {
  const token = randomToken();
  res.cookie(CSRF_COOKIE, token, { ...baseCookie(), httpOnly: false });
  return token;
}

/** Asegura que exista la cookie CSRF (doble envío: cookie legible + cabecera). */
export function ensureCsrf(req: Request, res: Response, next: NextFunction) {
  if (!req.cookies[CSRF_COOKIE]) req.cookies[CSRF_COOKIE] = issueCsrf(res);
  next();
}

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

export function verifyCsrf(req: Request, _res: Response, next: NextFunction) {
  if (SAFE.has(req.method)) return next();
  const cookie = req.cookies[CSRF_COOKIE];
  const header = req.get(CSRF_HEADER);
  if (!cookie || !header || !safeEqual(cookie, header)) {
    return next(new HttpError(403, "Token de seguridad inválido. Recarga la página e inténtalo de nuevo.", undefined, "csrf"));
  }
  // Defensa adicional: si el navegador envía Origin, debe ser el de la app.
  const origin = req.get("origin");
  if (origin && origin !== config.appUrl && origin !== `${req.protocol}://${req.get("host")}`) {
    return next(new HttpError(403, "Origen no permitido.", undefined, "origin"));
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== "admin") return next(forbidden());
  next();
}
