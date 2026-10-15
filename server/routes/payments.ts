import { Router } from "express";
import { ah } from "../lib/http.js";
import { adapters } from "../payments/index.js";
import { SignatureError } from "../payments/types.js";
import { applyVerifiedPayment } from "../services/orders.js";
import { PAYMENT_PROVIDERS, type PaymentProvider } from "../../shared/constants.js";

/** Webhooks de pasarelas. Sin CSRF (los llama el proveedor) pero con verificación de firma. */
export const paymentsRouter = Router();

paymentsRouter.post(
  "/webhooks/:provider",
  ah(async (req, res) => {
    const provider = String(req.params.provider) as PaymentProvider;
    if (!PAYMENT_PROVIDERS.includes(provider)) return res.status(404).json({ error: "Proveedor desconocido." });
    const adapter = adapters[provider];
    if (!adapter.isConfigured() || !adapter.handleWebhook) return res.status(404).json({ error: "Proveedor no configurado." });
    try {
      const verified = await adapter.handleWebhook(req);
      if (!verified) return res.status(200).json({ ok: true, ignored: true });
      const result = await applyVerifiedPayment(verified);
      return res.status(200).json({ ok: true, result });
    } catch (err) {
      if (err instanceof SignatureError) {
        console.warn(`[webhook ${provider}] firma inválida`);
        return res.status(401).json({ error: "Firma inválida." });
      }
      console.error(`[webhook ${provider}]`, err);
      // 500 para que el proveedor reintente más tarde.
      return res.status(500).json({ error: "Error procesando el evento." });
    }
  }),
);
