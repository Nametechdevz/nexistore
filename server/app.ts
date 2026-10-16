import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./config.js";
import { HttpError } from "./lib/http.js";
import { appRoot } from "./lib/paths.js";
import { rememberOrigin } from "./services/integrations.js";
import { getMedia, getPrivateMedia, MEDIA_URL_RE, PRIVATE_URL_RE } from "./services/media.js";
import { ensureCsrf, loadSession, parseCookies, verifyCsrf } from "./middleware/session.js";
import { accountRouter } from "./routes/account.js";
import { adminRouter } from "./routes/admin.js";
import { adminOpsRouter } from "./routes/admin-ops.js";
import { authRouter } from "./routes/auth.js";
import { catalogRouter } from "./routes/catalog.js";
import { paymentsRouter } from "./routes/payments.js";
import { shopRouter } from "./routes/shop.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  if (config.trustProxy) app.set("trust proxy", 1);
  // Recuerda la URL con la que entran los visitantes (para enlaces de correos y pasarelas).
  app.use((req, _res, next) => {
    const host = req.get("host");
    if (host && !req.path.startsWith("/api/payments/")) rememberOrigin(`${req.protocol}://${host}`);
    next();
  });

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "default-src": ["'self'"],
          "script-src": ["'self'"],
          "style-src": ["'self'", "'unsafe-inline'"],
          "img-src": ["'self'", "data:", "blob:", "https:"],
          "font-src": ["'self'", "data:"],
          "connect-src": ["'self'"],
          "form-action": ["'self'", "https://checkout.wompi.co", "https://www.mercadopago.com.co", "https://pay.zenobank.io", "https://accounts.google.com"],
          "frame-ancestors": ["'none'"],
          "upgrade-insecure-requests": config.isProd ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  // Webhooks: cuerpo JSON propio, sin CSRF.
  // Se guarda el cuerpo original: Zenobank firma los bytes exactos del webhook.
  app.use(
    "/api/payments",
    express.json({
      limit: "200kb",
      verify: (req, _res, buf) => {
        (req as unknown as { rawBody: Buffer }).rawBody = buf;
      },
    }),
    paymentsRouter,
  );

  app.use("/api", express.json({ limit: "200kb" }), parseCookies, loadSession, ensureCsrf, verifyCsrf);
  // Comprobantes de pago: solo el dueño o un administrador.
  app.get(/^\/api\/files\//, async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Inicia sesión para ver este archivo." });
      const m = PRIVATE_URL_RE.exec(req.path);
      const media = m ? await getPrivateMedia(Number(m[1]), m[2]!) : null;
      if (!media || (req.user.role !== "admin" && media.owner_id !== req.user.id)) return res.status(404).json({ error: "Archivo no encontrado." });
      res.setHeader("content-type", media.mime);
      res.setHeader("cache-control", "private, max-age=3600");
      res.setHeader("content-disposition", "inline");
      res.send(media.data);
    } catch (err) {
      next(err);
    }
  });
  app.use("/api/auth", authRouter);
  app.use("/api/catalog", catalogRouter);
  app.use("/api/account", accountRouter);
  app.use("/api/admin", adminOpsRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api", shopRouter);
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Ruta no encontrada." });
  });

  // Imágenes subidas desde el panel. La URL lleva un token aleatorio, así que se cachean un año.
  app.get(/^\/media\//, async (req, res, next) => {
    try {
      const m = MEDIA_URL_RE.exec(req.path);
      const media = m ? await getMedia(Number(m[1]), m[2]!) : null;
      if (!media) return res.status(404).type("text/plain").send("No encontrada");
      res.setHeader("content-type", media.mime);
      res.setHeader("cache-control", "public, max-age=31536000, immutable");
      res.setHeader("content-disposition", "inline");
      res.send(media.data);
    } catch (err) {
      next(err);
    }
  });

  // Frontend compilado (producción). Rutas del SPA → index.html.
  const clientDir = resolve(appRoot(), "dist/client");
  if (existsSync(clientDir)) {
    app.use(express.static(clientDir, { index: false, maxAge: "1y", immutable: true, setHeaders: noCacheHtml }));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.setHeader("cache-control", "no-cache");
      res.sendFile(resolve(clientDir, "index.html"));
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message, fields: err.fields, code: err.code });
    }
    if (err && typeof err === "object" && "type" in err && (err as { type: string }).type === "entity.parse.failed") {
      return res.status(400).json({ error: "JSON inválido." });
    }
    if (err && typeof err === "object" && "type" in err && (err as { type: string }).type === "entity.too.large") {
      return res.status(413).json({ error: "La solicitud es demasiado grande." });
    }
    console.error(err);
    res.status(500).json({ error: "Ocurrió un error inesperado. Inténtalo de nuevo." });
  });

  return app;
}

function noCacheHtml(res: Response, path: string) {
  if (path.endsWith(".html")) res.setHeader("cache-control", "no-cache");
}
