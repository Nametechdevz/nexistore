/** Utilidades compartidas por las pruebas de extremo a extremo. */

// Imagen PNG pequeña válida (sirve como comprobante de prueba).
export const PROOF_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

/**
 * Deja lista una cuenta Nequi para pagos por transferencia y activa el método, usando el panel
 * (así también se prueba la pantalla de configuración).
 */
export async function configureTransfers(page, BASE) {
  await page.goto(`${BASE}/admin/configuracion`);
  await page.getByRole("heading", { name: "Cuentas para transferencias" }).waitFor();
  if ((await page.locator(".acct-row").count()) === 0) {
    await page.getByRole("button", { name: "Agregar cuenta" }).click();
    const row = page.locator(".acct-row").first();
    await row.getByLabel("Nombre visible").fill("Nequi tienda");
    await row.getByLabel("Número Nequi").fill("3001112233");
    await row.getByLabel("Titular (opcional)").fill("Tienda Demo SAS");
    await page.getByRole("button", { name: "Guardar cuentas" }).click();
    await page.getByText("Cuentas guardadas").waitFor();
  }
  await page.locator("summary", { hasText: "Transferencias" }).click();
  const toggle = page.getByLabel(/Aceptar pagos por transferencia/);
  if (!(await toggle.isChecked())) {
    await toggle.check();
    await page.getByRole("button", { name: "Guardar cambios" }).first().click();
    await page.getByText("Configuración guardada").waitFor();
  }
}

/** El cliente completa el formulario del comprobante (cuenta, referencia e imagen). */
export async function sendProof(page, reference, submit) {
  const form = page.locator(".mp-form");
  await form.waitFor();
  const first = form.getByRole("radio").first();
  if ((await first.getAttribute("aria-checked")) !== "true") await first.click();
  await form.getByLabel("Referencia del comprobante").fill(reference);
  await form.locator('input[type="file"]').setInputFiles({ name: "comprobante.png", mimeType: "image/png", buffer: PROOF_PNG });
  await form.locator(".mp-drop img").waitFor();
  await form.getByRole("button", { name: submit }).click();
}
