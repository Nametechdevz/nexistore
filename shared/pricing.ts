/** Lógica de precios compartida por cliente y servidor. El servidor siempre recalcula. */

export interface PricedLine {
  unitPrice: number;
  quantity: number;
}

export interface CouponRule {
  code: string;
  kind: "percent" | "fixed";
  value: number;
  minSubtotal: number;
}

export interface Totals {
  subtotal: number;
  discount: number;
  total: number;
}

export function computeTotals(lines: PricedLine[], coupon?: CouponRule | null): Totals {
  const subtotal = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  let discount = 0;
  if (coupon && subtotal >= coupon.minSubtotal) {
    discount =
      coupon.kind === "percent"
        ? Math.round((subtotal * Math.min(coupon.value, 100)) / 100)
        : coupon.value;
  }
  discount = Math.max(0, Math.min(discount, subtotal));
  return { subtotal, discount, total: subtotal - discount };
}

export function discountPercent(price: number, compareAt?: number | null): number {
  if (!compareAt || compareAt <= price) return 0;
  return Math.round(((compareAt - price) / compareAt) * 100);
}

const copFormatter = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
});

/** $29.900 */
export function formatCOP(value: number): string {
  return copFormatter.format(value).replace(/\s/g, "");
}
