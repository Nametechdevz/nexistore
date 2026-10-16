import { themeAttributes, type ThemeSettings } from "../../../shared/themes";

/** Aplica un tema en el navegador (vista previa en el panel y modo desarrollo). */
export function applyTheme(t: ThemeSettings) {
  const root = document.documentElement;
  const { attrs, style, themeColor } = themeAttributes(t);
  for (const [k, v] of Object.entries(attrs)) root.setAttribute(k, v);
  root.removeAttribute("style");
  if (style) root.setAttribute("style", style);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", themeColor);
}
