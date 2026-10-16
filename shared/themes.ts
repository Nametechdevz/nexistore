/** Temas de la tienda: paleta, color propio, modo claro/oscuro y estilo de esquinas. */
import { z } from "zod";

export const THEME_PALETTES = [
  { id: "rojo", label: "Rojo NexiStore", accent: "#e3122c", bg: "#08090c" },
  { id: "azul", label: "Azul eléctrico", accent: "#2f7bff", bg: "#070a12" },
  { id: "morado", label: "Morado neón", accent: "#8b5cf6", bg: "#09070f" },
  { id: "verde", label: "Verde esmeralda", accent: "#10b981", bg: "#060c0a" },
  { id: "dorado", label: "Negro y dorado", accent: "#d4a73a", bg: "#0a0908" },
  { id: "naranja", label: "Naranja atardecer", accent: "#f2711c", bg: "#0b0807" },
  { id: "rosa", label: "Rosa fucsia", accent: "#e83e8c", bg: "#0b070a" },
] as const;
export type ThemePalette = (typeof THEME_PALETTES)[number]["id"];

export const themeSchema = z.object({
  palette: z.enum(THEME_PALETTES.map((p) => p.id) as [ThemePalette, ...ThemePalette[]]).default("rojo"),
  /** Color de marca propio (#rrggbb). Vacío = el de la paleta. */
  customAccent: z
    .string()
    .trim()
    .regex(/^(#[0-9a-fA-F]{6})?$/, "Usa un color en formato #rrggbb.")
    .default(""),
  mode: z.enum(["dark", "light"]).default("dark"),
  radius: z.enum(["suave", "redondeado", "recto"]).default("suave"),
  /** Estilo de diseño: «clasico» (campaña de temporada) o «premium» (portada aurora y animaciones al hacer scroll). */
  style: z.enum(["clasico", "premium"]).default("clasico"),
  /** Textos de la portada premium. */
  heroTitle: z.string().trim().max(80).default("Todo lo digital que amas,"),
  heroAccent: z.string().trim().max(60).default("en un solo lugar."),
  heroSubtitle: z.string().trim().max(220).default("Streaming, música, software, juegos e IA con entrega inmediata, pagos verificados y garantía durante todo tu servicio."),
});
export type ThemeSettings = z.infer<typeof themeSchema>;
export const DEFAULT_THEME: ThemeSettings = themeSchema.parse({});

/** true si el color es claro (necesita texto oscuro encima). */
export function isLightColor(hex: string): boolean {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return false;
  const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.3;
}

/** Atributos y estilo en línea para <html> (los usan el servidor y el navegador). */
export function themeAttributes(t: ThemeSettings): { attrs: Record<string, string>; style: string; themeColor: string } {
  const palette = THEME_PALETTES.find((p) => p.id === t.palette) ?? THEME_PALETTES[0];
  const accent = t.customAccent || palette.accent;
  const vars: string[] = [];
  if (t.customAccent) vars.push(`--accent:${t.customAccent}`);
  // Color de texto sobre el acento: oscuro si el acento es claro (dorado, amarillo…).
  vars.push(`--text-on-accent:${isLightColor(accent) ? "#141008" : "#ffffff"}`);
  return {
    attrs: { "data-accent": palette.id, "data-mode": t.mode, "data-radius": t.radius, "data-style": t.style ?? "clasico" },
    style: vars.join(";"),
    themeColor: t.mode === "light" ? "#f4f5f9" : palette.bg,
  };
}
