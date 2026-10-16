/**
 * Prueba de extremo a extremo + capturas responsive.
 * Requiere la app corriendo (npm run build && npm start) con datos de ejemplo y un admin.
 * Uso: BASE_URL=http://localhost:3000 ADMIN_EMAIL=... ADMIN_PASSWORD=... node tests/e2e/run.mjs
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { configureTransfers, sendProof } from "./common.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@nexistore.local";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "AdminLocal123";
const OUT = process.env.SHOTS_DIR ?? "design/shots/app";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const problems = [];
const steps = [];
const step = (s) => {
  steps.push(s);
  console.log(`✔ ${s}`);
};

function watch(page, label) {
  page.on("console", (m) => m.type() === "error" && problems.push(`[${label}] consola: ${m.text()}`));
  page.on("pageerror", (e) => problems.push(`[${label}] error JS: ${e.message}`));
  page.on("response", (r) => {
    if (r.status() >= 500) problems.push(`[${label}] ${r.status()} ${r.url()}`);
  });
}

async function shot(page, name, full = false) {
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
}

const desktop = { viewport: { width: 1366, height: 800 } };
const mobile = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

/* ---------- 0. Admin: cuenta para transferencias ---------- */
{
  const sctx = await browser.newContext(desktop);
  const sp = await sctx.newPage();
  watch(sp, "admin-config");
  await sp.goto(`${BASE}/ingresar?next=/admin`);
  await sp.getByLabel("Correo electrónico").fill(ADMIN_EMAIL);
  await sp.getByLabel("Contraseña", { exact: true }).fill(ADMIN_PASSWORD);
  await sp.getByRole("button", { name: "Iniciar sesión" }).click();
  await sp.waitForURL(/\/admin$/);
  await configureTransfers(sp, BASE);
  await sctx.close();
  step("Admin configura una cuenta Nequi para transferencias desde el panel");
}

/* ---------- 1. Tienda pública (escritorio) ---------- */
const ctx = await browser.newContext(desktop);
const page = await ctx.newPage();
watch(page, "cliente");
await page.goto(BASE);
await page.getByRole("heading", { level: 1 }).waitFor();
await page.locator(".pcard").first().waitFor();
await shot(page, "01-inicio-desktop");
await shot(page, "01-inicio-desktop-full", true);
step("Inicio carga con hero, categorías y productos");

// Búsqueda en vivo
await page.getByLabel("Buscar productos").first().fill("sonora");
await page.locator(".search-hit").first().waitFor();
await shot(page, "01b-busqueda");
await page.keyboard.press("Enter");
await page.waitForURL(/\/productos\?q=sonora/);
await page.locator(".pcard").first().waitFor();
step("Búsqueda en vivo y página de resultados");

await page.goto(`${BASE}/categorias`);
await page.locator(".cat-card").first().waitFor();
await shot(page, "02-categorias-desktop");
await page.locator(".cat-card", { hasText: "Música" }).click();
await page.waitForURL(/categorias\/musica/);
await page.locator(".pcard").first().waitFor();
step("Categorías y filtro por categoría");

await page.goto(`${BASE}/producto/cineplus-premium-anual`);
await page.getByRole("heading", { name: "CinePlus Premium" }).waitFor();
await shot(page, "03-producto-desktop");
await page.getByRole("button", { name: "Agregar al carrito" }).click();
await page.goto(`${BASE}/producto/suite-ofimatica-pro`);
await page.getByRole("button", { name: "Agregar al carrito" }).click();
step("Detalle de producto y agregar al carrito");

await page.goto(`${BASE}/carrito`);
await page.locator(".line-item").nth(1).waitFor();
await page.getByPlaceholder("Cupón de descuento").fill("navidad10");
await page.getByRole("button", { name: "Aplicar" }).click();
await page.locator(".sum-row.discount").waitFor();
await shot(page, "04-carrito-desktop");
step("Carrito con cupón NAVIDAD10 aplicado");

// Persistencia del carrito tras recargar
await page.reload();
await page.locator(".line-item").nth(1).waitFor();
step("El carrito persiste tras recargar");

await page.getByRole("button", { name: /Continuar al pago/ }).click();
await page.waitForURL(/ingresar\?next=/);
await shot(page, "05-login-desktop");
await page.getByRole("button", { name: "Iniciar sesión" }).click();
await page.locator(".field-error").first().waitFor();
await shot(page, "05b-login-errores");
step("Validación en cliente del formulario de inicio de sesión");

await page.getByRole("link", { name: "Regístrate aquí" }).click();
const email = `cliente${Date.now()}@test.co`;
await page.getByLabel("Nombre completo").fill("Marlys Muñoz");
await page.getByLabel("Correo electrónico").fill(email);
await page.getByLabel("Contraseña", { exact: true }).fill("Segura123");
await page.getByLabel("Confirmar contraseña").fill("Segura123");
await page.locator("label.check input").check();
await shot(page, "05c-registro");
await page.getByRole("button", { name: "Crear cuenta" }).click();
await page.waitForURL(/\/checkout/);
step("Registro y regreso al checkout");

await page.getByLabel("Celular").fill("3001234567");
await shot(page, "04b-checkout-datos");
await page.getByRole("button", { name: /Continuar/ }).click();
await page.getByRole("heading", { name: "Método de pago" }).waitFor();
await page.locator("label.pay-option", { hasText: "Transferencia" }).click();
await page.locator("form label.check input").check();
await shot(page, "04c-checkout-pago");
await page.getByRole("button", { name: /Pagar/ }).click();
await page.waitForURL(/\/pedido\/NS-.+\/confirmacion/);
await page.getByRole("heading", { name: "Pedido recibido" }).waitFor();
const orderCode = page.url().match(/pedido\/(NS-[^/]+)/)[1];
await page.locator(".mp-account").first().waitFor();
await shot(page, "04d-confirmacion");
step(`Pedido ${orderCode} creado (pendiente de pago, sin simular pago)`);
await sendProof(page, "M98765432", "Enviar comprobante");
await page.getByText("Comprobante en revisión").waitFor();
await shot(page, "04e-comprobante-enviado");
step("El cliente envía el comprobante de la transferencia");

await page.goto(`${BASE}/cuenta/pedidos`);
await page.locator(".order-card").first().waitFor();
await shot(page, "06-mis-pedidos-desktop");
await page.goto(`${BASE}/cuenta`);
await page.locator(".stat").first().waitFor();
await shot(page, "07-panel-usuario-desktop");
step("Mis pedidos y panel de usuario");

/* ---------- 2. Administración ---------- */
const actx = await browser.newContext(desktop);
const admin = await actx.newPage();
watch(admin, "admin");
await admin.goto(`${BASE}/ingresar?next=/admin`);
await admin.getByLabel("Correo electrónico").fill(ADMIN_EMAIL);
await admin.getByLabel("Contraseña", { exact: true }).fill(ADMIN_PASSWORD);
await admin.getByRole("button", { name: "Iniciar sesión" }).click();
await admin.waitForURL(/\/admin$/);
await admin.locator(".chart").waitFor();
await shot(admin, "08-admin-dashboard");
await admin.goto(`${BASE}/admin/productos`);
await admin.locator("table tbody tr").first().waitFor();
await shot(admin, "08b-admin-productos");
await admin.getByRole("button", { name: "Nuevo producto" }).click();
await admin.getByRole("button", { name: "Guardar" }).click();
await admin.locator(".modal .field-error").first().waitFor();
await shot(admin, "08c-admin-producto-validacion");
await admin.keyboard.press("Escape");
step("Admin: dashboard, productos y validación del formulario");

await admin.goto(`${BASE}/admin/pedidos/${orderCode}`);
await admin.locator(".proof-review img").waitFor();
await shot(admin, "08e-admin-comprobante");
await admin.locator(".proof-panel").getByRole("button", { name: "Confirmar pago" }).click();
await admin.locator(".modal").getByRole("button", { name: "Confirmar" }).click();
await admin.getByRole("button", { name: "Entregar y completar" }).waitFor();
const boxes = admin.locator("textarea[aria-label^='Entrega de']");
for (let i = 0; i < (await boxes.count()); i++) await boxes.nth(i).fill(`Usuario: demo${i}@cineplus.test\nClave: Temporal-${i}23`);
await admin.getByRole("button", { name: "Entregar y completar" }).click();
await admin.locator(".status-completed").first().waitFor();
await shot(admin, "08d-admin-pedido");
step("Admin: confirmar transferencia, entregar y completar");

await page.goto(`${BASE}/cuenta/pedidos/${orderCode}`);
await page.locator(".delivery-box").first().waitFor();
await shot(page, "06b-detalle-pedido-entregado", true);
step("El cliente ve los datos de entrega y el seguimiento completo");

// Un cliente no puede entrar al panel admin
await page.goto(`${BASE}/admin`);
await page.getByText("Acceso restringido").waitFor();
step("Cliente bloqueado en /admin");

/* ---------- 3. Móvil ---------- */
const mctx = await browser.newContext(mobile);
const m = await mctx.newPage();
watch(m, "móvil");
const mobilePages = [
  ["/", "01-inicio-mobile"],
  ["/categorias", "02-categorias-mobile"],
  ["/producto/cineplus-premium-anual", "03-producto-mobile"],
  ["/carrito", "04-carrito-vacio-mobile"],
  ["/ingresar", "05-login-mobile"],
  ["/productos", "02b-catalogo-mobile"],
];
for (const [path, name] of mobilePages) {
  await m.goto(`${BASE}${path}`);
  await m.waitForLoadState("networkidle");
  await shot(m, name);
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) problems.push(`[móvil] desbordamiento horizontal de ${overflow}px en ${path}`);
}
await m.goto(`${BASE}/producto/cineplus-premium-anual`);
await m.getByRole("button", { name: "Agregar al carrito" }).click();
await m.goto(`${BASE}/carrito`);
await m.locator(".line-item").first().waitFor();
await shot(m, "04-carrito-mobile", true);
// Sesión de cliente en móvil para paneles
await m.goto(`${BASE}/ingresar?next=/cuenta/pedidos`);
await m.getByLabel("Correo electrónico").fill(email);
await m.getByLabel("Contraseña", { exact: true }).fill("Segura123");
await m.getByRole("button", { name: "Iniciar sesión" }).click();
await m.waitForURL(/cuenta\/pedidos/);
await m.locator(".order-card").first().waitFor();
await shot(m, "06-mis-pedidos-mobile");
await m.goto(`${BASE}/cuenta`);
await m.locator(".stat").first().waitFor();
await shot(m, "07-panel-usuario-mobile", true);
const tablet = await browser.newContext({ viewport: { width: 820, height: 1180 } });
const t = await tablet.newPage();
await t.goto(BASE);
await t.locator(".pcard").first().waitFor();
await shot(t, "01-inicio-tablet");
step("Capturas móvil (390px) y tablet (820px)");

const am = await browser.newContext(mobile);
const amp = await am.newPage();
await amp.goto(`${BASE}/ingresar?next=/admin`);
await amp.getByLabel("Correo electrónico").fill(ADMIN_EMAIL);
await amp.getByLabel("Contraseña", { exact: true }).fill(ADMIN_PASSWORD);
await amp.getByRole("button", { name: "Iniciar sesión" }).click();
await amp.waitForURL(/\/admin$/);
await amp.locator(".chart").waitFor();
await shot(amp, "08-admin-mobile", true);
const overflowAdmin = await amp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
if (overflowAdmin > 1) problems.push(`[móvil] desbordamiento horizontal de ${overflowAdmin}px en /admin`);

await browser.close();
console.log(`\n${steps.length} pasos completados.`);
if (problems.length) {
  console.log("\nProblemas detectados:");
  for (const p of problems) console.log(` - ${p}`);
  process.exit(1);
}
console.log("Sin errores de consola, sin respuestas 5xx y sin desbordamiento horizontal.");
