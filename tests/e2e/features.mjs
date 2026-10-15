/**
 * E2E de billetera, entrega automática, cuenta caída con reemplazo, soporte e inventario.
 * Requiere la app corriendo con datos de ejemplo (npm run db:seed con INVENTORY_ENCRYPTION_KEY) y un admin.
 * Uso: BASE_URL=http://localhost:3000 ADMIN_EMAIL=... ADMIN_PASSWORD=... node tests/e2e/features.mjs
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@nexistore.local";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "AdminLocal123";
const OUT = process.env.SHOTS_DIR ?? "design/shots/app";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const problems = [];
const step = (s) => console.log(`✔ ${s}`);
const watch = (page, label) => {
  page.on("pageerror", (e) => problems.push(`[${label}] error JS: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && problems.push(`[${label}] consola: ${m.text()}`));
  page.on("response", (r) => r.status() >= 500 && problems.push(`[${label}] ${r.status()} ${r.url()}`));
};
const shot = async (page, name, full = false) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
};
const desktop = { viewport: { width: 1366, height: 860 } };
const mobile = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

async function login(page, email, password, next) {
  await page.goto(`${BASE}/ingresar?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await page.waitForURL((u) => u.pathname === next.split("?")[0]);
}

/* ---------- Cliente: registro y recarga ---------- */
const cctx = await browser.newContext(desktop);
const c = await cctx.newPage();
watch(c, "cliente");
const email = `billetera${Date.now()}@test.co`;
await c.goto(`${BASE}/registro?next=/cuenta/billetera`);
await c.getByLabel("Nombre completo").fill("Laura Pérez");
await c.getByLabel("Correo electrónico").fill(email);
await c.getByLabel("Contraseña", { exact: true }).fill("Segura123");
await c.getByLabel("Confirmar contraseña").fill("Segura123");
await c.locator("label.check input").check();
await c.getByRole("button", { name: "Crear cuenta" }).click();
await c.waitForURL(/cuenta\/billetera/);
await c.getByRole("button", { name: "$100.000" }).click();
await c.locator("label.pay-option", { hasText: "Transferencia" }).click();
await shot(c, "09-billetera-recarga");
await c.getByRole("button", { name: /Recargar \$100\.000/ }).click();
await c.getByRole("heading", { name: "Recarga por transferencia" }).waitFor();
await shot(c, "09b-billetera-instrucciones");
await c.getByRole("button", { name: "Entendido" }).click();
step("Cliente solicita recarga por transferencia (queda pendiente)");

/* ---------- Admin: confirma la recarga ---------- */
const actx = await browser.newContext(desktop);
const a = await actx.newPage();
watch(a, "admin");
await login(a, ADMIN_EMAIL, ADMIN_PASSWORD, "/admin");
await a.goto(`${BASE}/admin/billetera`);
await a.locator("tr", { hasText: email }).getByRole("button", { name: "Confirmar" }).click();
await a.getByRole("button", { name: "Acreditar saldo" }).click();
await a.getByText("Saldo acreditado.").waitFor();
await shot(a, "10-admin-billetera");
step("Admin confirma la transferencia y acredita el saldo");

await c.reload();
await c.getByText("$100.000").first().waitFor();
await c.locator(".ledger-row", { hasText: "Recarga" }).first().waitFor();
await shot(c, "09c-billetera-saldo", true);
step("El cliente ve el saldo y el movimiento");

/* ---------- Compra con billetera de producto automático ---------- */
await c.goto(`${BASE}/producto/cineplus-premium-anual`);
await c.getByText("Entrega automática al confirmarse el pago").waitFor();
await c.getByRole("button", { name: "Agregar al carrito" }).click();
await c.goto(`${BASE}/checkout`);
await c.getByLabel("Celular").fill("3001234567");
await c.getByLabel("Documento de identidad").fill("1020304050");
await c.getByRole("button", { name: /Continuar/ }).click();
await c.locator("label.pay-option", { hasText: "Billetera NexiStore" }).click();
await c.locator("form label.check input").check();
await shot(c, "11-checkout-billetera");
await c.getByRole("button", { name: /Pagar/ }).click();
await c.waitForURL(/\/pedido\/NS-.+\/confirmacion/);
await c.getByRole("heading", { name: "¡Pago confirmado!" }).waitFor();
await c.getByText("Tus datos de acceso ya están disponibles").waitFor();
const code = c.url().match(/pedido\/(NS-[^/]+)/)[1];
await shot(c, "11b-confirmacion-automatica");
step(`Pedido ${code} pagado con billetera y entregado automáticamente`);

await c.goto(`${BASE}/cuenta/pedidos/${code}`);
await c.locator(".delivery-card .delivery-box").first().waitFor();
const firstCreds = await c.locator(".delivery-card .delivery-box").first().innerText();
await shot(c, "12-pedido-credenciales", true);

/* ---------- Reporte de cuenta caída ---------- */
await c.getByRole("button", { name: "Reportar falla" }).first().click();
await c.getByLabel("Detalles (opcional)").fill("Dice que la contraseña es incorrecta.");
await shot(c, "12b-reportar-falla");
await c.getByRole("button", { name: "Enviar reporte" }).click();
await c.waitForURL(/cuenta\/soporte\/\d+/);
const ticketId = c.url().match(/soporte\/(\d+)/)[1];
await c.locator(".bubble.mine").first().waitFor();
step(`Cliente reporta la cuenta caída (solicitud #${ticketId})`);

/* ---------- Admin: notificación, chat y reemplazo ---------- */
await a.goto(`${BASE}/admin`);
await a.getByRole("button", { name: /Notificaciones, \d+ sin leer/ }).click();
await a.locator(".notif-item", { hasText: "Cuenta reportada con falla" }).first().waitFor();
await shot(a, "13-admin-notificaciones");
await a.locator(".notif-item", { hasText: "Cuenta reportada con falla" }).first().click();
await a.waitForURL(/admin\/soporte\/\d+/);
await a.getByLabel("Mensaje").fill("Hola Laura, ya revisamos tu cuenta. Te asignamos una nueva.");
await a.getByRole("button", { name: "Enviar" }).click();
await a.locator(".bubble.mine").first().waitFor();
await a.getByRole("button", { name: /Reemplazar cuenta/ }).click();
await a.getByText("Resuelto: cuenta reemplazada").waitFor();
await shot(a, "13b-admin-soporte-reemplazo", true);
step("Admin responde por chat y reemplaza la cuenta desde el inventario");

await c.goto(`${BASE}/cuenta/pedidos/${code}`);
await c.getByText("Cuenta anterior dada de baja por falla.").waitFor();
const newCreds = await c.locator(".delivery-card:not(.is-fallen) .delivery-box").first().innerText();
if (newCreds === firstCreds) problems.push("La cuenta reemplazada muestra las mismas credenciales");
await c.getByText("Cuenta de CinePlus Premium reemplazada").waitFor();
await shot(c, "14-pedido-reemplazado", true);
await c.getByRole("button", { name: /Notificaciones/ }).click();
await c.locator(".notif-item", { hasText: "Reemplazamos tu cuenta de" }).first().waitFor();
await shot(c, "14b-cliente-notificaciones");
await c.keyboard.press("Escape");
await c.goto(`${BASE}/cuenta/soporte/${ticketId}`);
await c.locator(".bubble.theirs").first().waitFor();
await shot(c, "15-cliente-chat");
step("El pedido muestra la nueva cuenta, la novedad y la notificación al cliente");

/* ---------- Inventario ---------- */
await a.goto(`${BASE}/admin/inventario`);
await a.locator(".inv-card").first().waitFor();
await shot(a, "16-admin-inventario", true);
await a.getByRole("tab", { name: "Por vencer (proveedor)" }).click();
await a.locator("tbody tr").first().waitFor();
await shot(a, "16b-inventario-por-vencer");
await a.getByRole("button", { name: "Agregar cuentas" }).click();
await a.getByLabel("Cuentas (una por línea)").fill("nueva1@cineplus.test:Clave111 | Perfil A | 2027-06-30\nnueva2@cineplus.test:Clave222 | Perfil B");
await shot(a, "16c-inventario-carga");
await a.getByRole("button", { name: /^Agregar 2$/ }).click();
await a.getByText("2 cuenta(s) agregada(s)").waitFor();
await a.getByRole("button", { name: "Revisar alertas ahora" }).click();
await a.getByText(/Revisión hecha/).waitFor();
step("Inventario: resumen, filtro por vencer, carga masiva y revisión de alertas");

await a.goto(`${BASE}/admin/productos`);
await a.getByLabel("Buscar productos").fill("CinePlus Premium");
await a.locator("tr", { hasText: "CinePlus Premium" }).getByRole("button", { name: /Editar/ }).click();
await a.getByLabel("Entrega", { exact: true }).waitFor();
await shot(a, "17-admin-producto-entrega");
await a.keyboard.press("Escape");

/* ---------- Móvil ---------- */
const m = await (await browser.newContext(mobile)).newPage();
watch(m, "móvil");
await login(m, email, "Segura123", "/cuenta/billetera");
for (const [path, name] of [
  ["/cuenta/billetera", "18-billetera-mobile"],
  [`/cuenta/pedidos/${code}`, "18b-pedido-mobile"],
  [`/cuenta/soporte/${ticketId}`, "18c-chat-mobile"],
]) {
  await m.goto(`${BASE}${path}`);
  await m.waitForLoadState("networkidle");
  await shot(m, name, true);
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) problems.push(`[móvil] desbordamiento de ${overflow}px en ${path}`);
}
const am = await (await browser.newContext(mobile)).newPage();
await login(am, ADMIN_EMAIL, ADMIN_PASSWORD, "/admin/inventario");
await am.locator(".inv-card").first().waitFor();
await shot(am, "18d-inventario-mobile", true);
const o2 = await am.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
if (o2 > 1) problems.push(`[móvil] desbordamiento de ${o2}px en /admin/inventario`);
step("Capturas móviles sin desbordamiento");

await browser.close();
if (problems.length) {
  console.log("\nProblemas detectados:");
  for (const p of problems) console.log(` - ${p}`);
  process.exit(1);
}
console.log("\nSin errores de consola, sin respuestas 5xx y sin desbordamiento horizontal.");
