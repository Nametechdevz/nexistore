/**
 * Pagos manuales con comprobante (Nequi, Daviplata, llave Bre-B, QR…).
 * El cliente transfiere a una de las cuentas configuradas, sube la imagen del comprobante y la
 * referencia; un administrador lo revisa y acredita o rechaza. Nunca se aprueba solo.
 */
import { randomBytes } from "node:crypto";
import { getSetting, setSetting } from "./settings.js";
import { MANUAL_ACCOUNT_KINDS, type ManualAccount, type PaymentDisplay } from "../../shared/schemas.js";

export async function getManualAccounts(includeDisabled = false): Promise<ManualAccount[]> {
  const { accounts } = await getSetting<{ accounts: ManualAccount[] }>("manualAccounts", { accounts: [] });
  return (accounts ?? []).filter((a) => includeDisabled || a.enabled);
}

export async function saveManualAccounts(list: Omit<ManualAccount, "id">[] & { id?: string }[]): Promise<ManualAccount[]> {
  const accounts = (list as (Omit<ManualAccount, "id"> & { id?: string })[]).map((a) => ({ ...a, id: a.id ?? randomBytes(5).toString("hex") }));
  await setSetting("manualAccounts", { accounts });
  return accounts;
}

export async function findManualAccount(id: string): Promise<ManualAccount | null> {
  return (await getManualAccounts()).find((a) => a.id === id) ?? null;
}

/** Texto que queda guardado en la recarga o pedido (la cuenta puede cambiar después). */
export const accountSnapshot = (a: ManualAccount) =>
  `${MANUAL_ACCOUNT_KINDS[a.kind]} · ${a.label}${a.number ? ` · ${a.number}` : ""}`.slice(0, 120);

/** Vista pública (para el checkout y la billetera). */
export const publicAccount = (a: ManualAccount) => ({
  id: a.id,
  kind: a.kind,
  kindLabel: MANUAL_ACCOUNT_KINDS[a.kind],
  label: a.label,
  holder: a.holder,
  number: a.number,
  qrImage: a.qrImage || null,
  instructions: a.instructions,
});

export async function getPaymentDisplay(): Promise<PaymentDisplay> {
  return getSetting<PaymentDisplay>("paymentDisplay", {});
}
