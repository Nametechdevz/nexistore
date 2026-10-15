import nodemailer, { type Transporter } from "nodemailer";
import { config } from "../config.js";
import { integ } from "./integrations.js";

let transport: Transporter | null = null;
let transportKey = "";

export const mailConfigured = () => {
  const c = integ();
  return Boolean(c.smtpHost && c.smtpUser && c.smtpPassword);
};

/** Bandeja en memoria para pruebas automatizadas. */
export const testOutbox: { to: string; subject: string; text: string }[] = [];

function getTransport(): Transporter {
  const c = integ();
  const key = [c.smtpHost, c.smtpPort, c.smtpUser, c.smtpPassword].join("|");
  // Si el admin cambió la configuración SMTP en el panel, se crea un transporte nuevo.
  if (!transport || key !== transportKey) {
    transport = nodemailer.createTransport({
      host: c.smtpHost,
      port: c.smtpPort,
      secure: c.smtpPort === 465,
      auth: { user: c.smtpUser, pass: c.smtpPassword },
    });
    transportKey = key;
  }
  return transport;
}

export async function sendMail(to: string, subject: string, text: string, opts: { force?: boolean } = {}): Promise<{ delivered: boolean }> {
  if (config.NODE_ENV === "test" && !opts.force) {
    testOutbox.push({ to, subject, text });
    return { delivered: true };
  }
  if (!mailConfigured()) {
    // Sin SMTP no se envía nada. En desarrollo se muestra en consola para poder probar el flujo.
    if (!config.isProd) console.info(`[correo NO enviado — SMTP pendiente de configuración]\nPara: ${to}\nAsunto: ${subject}\n${text}\n`);
    else console.warn(`[correo NO enviado — SMTP pendiente de configuración] ${subject} → ${to}`);
    return { delivered: false };
  }
  const c = integ();
  await getTransport().sendMail({ from: c.smtpFrom || c.smtpUser, to, subject, text });
  return { delivered: true };
}

/** Prueba de conexión y envío real (botón «Enviar correo de prueba» del panel). */
export async function testMail(to: string): Promise<void> {
  if (!mailConfigured()) throw new Error("Completa servidor, usuario y contraseña SMTP.");
  await getTransport().verify();
  await sendMail(to, "Correo de prueba de NexiStore", "Si recibes este mensaje, el correo SMTP de tu tienda está bien configurado.", { force: true });
}
