import { getSetting, setSetting } from "./settings.js";
import { DEFAULT_THEME, themeAttributes, themeSchema, type ThemeSettings } from "../../shared/themes.js";

let cache: ThemeSettings = DEFAULT_THEME;

export const theme = () => cache;

export async function loadTheme(): Promise<ThemeSettings> {
  const raw = await getSetting<ThemeSettings>("theme", DEFAULT_THEME);
  const parsed = themeSchema.safeParse(raw);
  cache = parsed.success ? parsed.data : DEFAULT_THEME;
  return cache;
}

export async function saveTheme(t: ThemeSettings): Promise<ThemeSettings> {
  await setSetting("theme", t);
  cache = t;
  return t;
}

const esc = (v: string) => v.replace(/[&"<>]/g, (c) => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[c]!);

/** Aplica el tema al HTML antes de enviarlo: la página carga ya con los colores correctos. */
export function injectTheme(html: string): string {
  const { attrs, style, themeColor } = themeAttributes(cache);
  const attrText = Object.entries(attrs).map(([k, v]) => ` ${k}="${esc(v)}"`).join("") + (style ? ` style="${esc(style)}"` : "");
  return html
    .replace(/<html lang="es"[^>]*>/, `<html lang="es"${attrText}>`)
    .replace(/<meta name="theme-color" content="[^"]*"/, `<meta name="theme-color" content="${esc(themeColor)}"`);
}
