import { useEffect, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { Spinner } from "../../components/ui";
import { api, ApiError } from "../../lib/api";
import { applyTheme } from "../../lib/theme";
import { useToast } from "../../lib/state";
import { DEFAULT_THEME, THEME_PALETTES, type ThemeSettings } from "../../../../shared/themes";

/** Apariencia: paleta, color propio, modo claro/oscuro y esquinas, con vista previa en vivo. */
export function ThemeSettingsPanel({ initial, onSaved }: { initial: ThemeSettings; onSaved: () => void }) {
  const toast = useToast();
  const [saved, setSaved] = useState<ThemeSettings>({ ...DEFAULT_THEME, ...initial });
  const [t, setT] = useState<ThemeSettings>({ ...DEFAULT_THEME, ...initial });
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(t) !== JSON.stringify(saved);

  // Vista previa en vivo; si sales sin guardar, vuelve al tema guardado.
  useEffect(() => {
    applyTheme(t);
  }, [t]);
  const savedRef = useRef(saved);
  useEffect(() => () => applyTheme(savedRef.current), []);

  const save = async () => {
    setBusy(true);
    try {
      const r = await api.put<{ theme: ThemeSettings }>("/api/admin/settings/theme", t);
      setSaved(r.theme);
      savedRef.current = r.theme;
      toast("success", "Tema guardado. Tus clientes ya ven el nuevo diseño.");
      onSaved();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Apariencia de la tienda</h3>
        <div style={{ display: "flex", gap: 8 }}>
          {dirty && <button className="btn btn-ghost btn-sm" onClick={() => setT(saved)}>Descartar</button>}
          <button className="btn btn-primary btn-sm" onClick={save} disabled={busy || !dirty}>{busy && <Spinner />} Guardar tema</button>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 14, marginBottom: 16 }}>
        Elige el estilo y míralo al instante en todo el panel. Cuando lo guardes, se aplica en la tienda para todos tus clientes.
      </p>

      <span className="label">Paleta de color</span>
      <div className="theme-grid" role="radiogroup" aria-label="Paleta">
        {THEME_PALETTES.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={t.palette === p.id && !t.customAccent}
            className="theme-card"
            onClick={() => setT({ ...t, palette: p.id, customAccent: "" })}
          >
            <span className="theme-swatch" style={{ background: t.mode === "light" ? "#f4f5f9" : p.bg }}>
              <span className="sw-bar" style={{ background: p.accent }} />
              <span className="sw-line" />
              <span className="sw-line short" />
              <span className="sw-btn" style={{ background: p.accent }} />
            </span>
            <strong>{p.label}</strong>
            {t.palette === p.id && !t.customAccent && <Icon name="check" className="theme-check" />}
          </button>
        ))}
      </div>

      <div className="theme-row">
        <div className="field">
          <span className="label">Color de marca propio (opcional)</span>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="color"
              aria-label="Color propio"
              value={t.customAccent || THEME_PALETTES.find((p) => p.id === t.palette)!.accent}
              onChange={(e) => setT({ ...t, customAccent: e.target.value })}
              style={{ width: 52, height: 44, border: 0, background: "none", cursor: "pointer" }}
            />
            <input className="input" style={{ maxWidth: 140 }} value={t.customAccent} placeholder="#rrggbb" maxLength={7} onChange={(e) => setT({ ...t, customAccent: e.target.value.trim() })} aria-label="Color hexadecimal" />
            {t.customAccent && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setT({ ...t, customAccent: "" })}>Usar el de la paleta</button>}
          </div>
          <span className="hint">Reemplaza el color principal (botones, enlaces, etiquetas) manteniendo los fondos de la paleta.</span>
        </div>

        <div className="field">
          <span className="label">Modo</span>
          <div className="seg" role="radiogroup" aria-label="Modo">
            {(
              [
                ["dark", "Oscuro", "moon"],
                ["light", "Claro", "sun"],
              ] as const
            ).map(([id, label]) => (
              <button key={id} type="button" role="radio" aria-checked={t.mode === id} onClick={() => setT({ ...t, mode: id })}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="label">Esquinas</span>
          <div className="seg" role="radiogroup" aria-label="Esquinas">
            {(
              [
                ["recto", "Rectas"],
                ["suave", "Suaves"],
                ["redondeado", "Redondeadas"],
              ] as const
            ).map(([id, label]) => (
              <button key={id} type="button" role="radio" aria-checked={t.radius === id} onClick={() => setT({ ...t, radius: id })}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
      {dirty && <p className="hint" style={{ marginTop: 12 }}><Icon name="info" size={13} style={{ verticalAlign: -2 }} /> Vista previa: aún no se ha guardado.</p>}
    </div>
  );
}
