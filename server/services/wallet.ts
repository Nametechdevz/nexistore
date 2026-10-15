import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { query, queryOne, toIso, transaction } from "../db.js";
import { conflict, notFound } from "../lib/http.js";
import { randomToken } from "../lib/security.js";
import { notify } from "./notifications.js";
import { formatCOP } from "../../shared/pricing.js";

export type WalletTxKind = "topup" | "purchase" | "refund" | "adjustment";

/**
 * Mueve saldo dentro de una transacción. Bloquea la fila del usuario (FOR UPDATE) para que dos
 * operaciones simultáneas no dejen el saldo inconsistente. Lanza 409 si el saldo no alcanza.
 */
export async function moveWallet(
  conn: PoolConnection,
  userId: number,
  amount: number,
  kind: WalletTxKind,
  opts: { reference?: string | null; note?: string; actor?: string } = {},
): Promise<{ balance: number; txId: number }> {
  if (!Number.isInteger(amount) || amount === 0) throw conflict("Monto inválido.");
  const [rows] = await conn.query<RowDataPacket[]>("SELECT wallet_balance FROM users WHERE id = ? FOR UPDATE", [userId]);
  if (!rows[0]) throw notFound("Usuario no encontrado.");
  const balance = Number(rows[0].wallet_balance) + amount;
  if (balance < 0) throw conflict(`Saldo insuficiente en la billetera. Disponible: ${formatCOP(Number(rows[0].wallet_balance))}.`);
  await conn.execute("UPDATE users SET wallet_balance = ? WHERE id = ?", [balance, userId]);
  const [res] = await conn.execute<ResultSetHeader>(
    "INSERT INTO wallet_transactions (user_id, kind, amount, balance_after, reference, note, actor) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [userId, kind, amount, balance, opts.reference ?? null, (opts.note ?? "").slice(0, 255), opts.actor ?? "system"],
  );
  return { balance, txId: res.insertId };
}

export async function walletSummary(userId: number) {
  const u = await queryOne<{ wallet_balance: number }>("SELECT wallet_balance FROM users WHERE id = ?", [userId]);
  const txs = await query<Record<string, unknown>>(
    "SELECT id, kind, amount, balance_after, reference, note, created_at FROM wallet_transactions WHERE user_id = ? ORDER BY id DESC LIMIT 50",
    [userId],
  );
  const topups = await query<Record<string, unknown>>(
    "SELECT code, amount, provider, status, payment_currency, payment_amount_foreign, payment_ref, created_at, paid_at FROM wallet_topups WHERE user_id = ? ORDER BY id DESC LIMIT 20",
    [userId],
  );
  return {
    balance: Number(u?.wallet_balance ?? 0),
    transactions: txs.map((t) => ({
      id: t.id,
      kind: t.kind,
      amount: Number(t.amount),
      balanceAfter: Number(t.balance_after),
      reference: t.reference,
      note: t.note,
      createdAt: toIso(t.created_at),
    })),
    topups: topups.map(mapTopup),
  };
}

export const mapTopup = (t: Record<string, unknown>) => ({
  code: t.code as string,
  amount: Number(t.amount),
  provider: t.provider as string,
  status: t.status as string,
  paymentCurrency: (t.payment_currency as string | null) ?? null,
  paymentAmountForeign: t.payment_amount_foreign ? String(Number(t.payment_amount_foreign)) : null,
  paymentRef: (t.payment_ref as string | null) ?? null,
  createdAt: toIso(t.created_at),
  paidAt: toIso(t.paid_at),
  customer: t.email ? { id: t.user_id, name: t.name, email: t.email } : undefined,
});

export function newTopupCode(): string {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `WT-${d}-${randomToken(3).toUpperCase()}`;
}

/** Acredita una recarga pagada. Idempotente: solo actúa si la recarga sigue pendiente. */
export async function creditTopup(code: string, opts: { actor: string; paymentRef?: string | null }): Promise<boolean> {
  const credited = await transaction(async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>("SELECT id, user_id, amount, status FROM wallet_topups WHERE code = ? FOR UPDATE", [code]);
    const t = rows[0];
    if (!t || t.status !== "pending") return null;
    await conn.execute("UPDATE wallet_topups SET status = 'paid', paid_at = UTC_TIMESTAMP(), payment_ref = COALESCE(?, payment_ref) WHERE id = ?", [
      opts.paymentRef ?? null,
      t.id,
    ]);
    const { balance } = await moveWallet(conn, t.user_id, Number(t.amount), "topup", { reference: code, note: "Recarga de billetera", actor: opts.actor });
    return { userId: t.user_id as number, amount: Number(t.amount), balance };
  });
  if (!credited) return false;
  await notify({
    audience: "user",
    userId: credited.userId,
    kind: "wallet",
    title: `Recarga de ${formatCOP(credited.amount)} acreditada`,
    body: `Tu saldo disponible es ${formatCOP(credited.balance)}.`,
    link: "/cuenta/billetera",
    email: true,
  });
  return true;
}
