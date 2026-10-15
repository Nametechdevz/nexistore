export { formatCOP, discountPercent } from "../../../shared/pricing";
export { ORDER_STATUS_LABEL } from "../../../shared/constants";

const dateFmt = new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

export const formatDate = (iso: string | null | undefined) => (iso ? dateFmt.format(new Date(iso)) : "—");
export const formatDateTime = (iso: string | null | undefined) => (iso ? dateTimeFmt.format(new Date(iso)) : "—");

export const PROVIDER_LABEL: Record<string, string> = {
  mercadopago: "Mercado Pago",
  wompi: "Wompi",
  manual: "Transferencia",
  zenobank: "Zenobank (cripto)",
  wallet: "Billetera",
};

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

export const slugify = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);

/** Ilustración navideña incluida (se usa mientras la campaña esté activa y no haya un fondo propio). */
export const SEASON_ART = "/art/navidad.jpg";

/** Fondo de una zona de la tienda: el subido en el panel o, con campaña activa, la ilustración incluida. */
export function backgroundFor(
  campaign: { enabled: boolean; heroImage?: string; authImage?: string; promoImage?: string } | undefined,
  zone: "hero" | "auth" | "promo",
): string | null {
  if (!campaign) return null;
  const own = zone === "hero" ? campaign.heroImage : zone === "auth" ? campaign.authImage : campaign.promoImage;
  if (own) return own;
  return campaign.enabled ? SEASON_ART : null;
}
