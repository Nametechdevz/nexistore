import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./config.js";
import { HttpError } from "./lib/http.js";
import { appRoot } from "./lib/paths.js";
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
  if (config.TRUST_PROXY) app.set("trust proxy", 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "default-src": ["'self'"],
          "script-src": ["'self'"],
          "style-src": ["'self'", "'unsafe-inline'"],
          "img-src": ["'self'", "data:", "https:"],
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
