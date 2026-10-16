export const PAY_COLORS: Record<string, string> = {
  wallet: "#e3122c",
  mercadopago: "#00a6e0",
  wompi: "#1f1f6b",
  manual: "#7c3aed",
  paypal: "#1d4ed8",
  zenobank: "#7c5cff",
};
export const PAY_SHORT: Record<string, string> = { wallet: "$", mercadopago: "MP", wompi: "W", manual: "TR", paypal: "PP", zenobank: "₿" };

/** Logo del método de pago: el subido en el panel o un distintivo por defecto. */
export function PayLogo({ id, logo, label }: { id: string; logo?: string | null; label: string }) {
  if (logo)
    return (
      <span className="pay-logo has-img" title={label}>
        <img src={logo} alt={label} />
      </span>
    );
  return (
    <span className="pay-logo" style={{ background: PAY_COLORS[id] }} title={label}>
      {PAY_SHORT[id]}
    </span>
  );
}

