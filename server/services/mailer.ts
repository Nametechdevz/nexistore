import nodemailer, { type Transporter } from "nodemailer";
import { config } from "../config.js";

let transport: Transporter | null = null;

export const mailConfigured = () => Boolean(config.SMTP_HOST && config.SMTP_USER && config.SMTP_PASSWORD);

/** Bandeja en memoria para pruebas automatizadas. */
export const testOutbox: { to: string; subject: string; text: string }[] = [];

export async function sendMail(to: string, subject: string, text: string): Promise<{ delivered: boolean }> {
  if (config.NODE_ENV === "test") {
    testOutbox.push({ to, subject, text });
    return { delivered: true };
  }
  if (!mailConfigured()) {
    // Sin SMTP no se envía nada. En desarrollo se muestra en consola para poder probar el flujo.
    if (!config.isProd) console.info(`[correo NO enviado — SMTP pendiente de configuración]\nPara: ${to}\nAsunto: ${subject}\n${text}\n`);
    else console.warn(`[correo NO enviado — SMTP pendiente de configuración] ${subject} → ${to}`);
    return { delivered: false };
  }
  transport ??= nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_PORT === 465,
    auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD },
  });
  await transport.sendMail({ from: config.SMTP_FROM ?? config.SMTP_USER, to, subject, text });
  return { delivered: true };
}
