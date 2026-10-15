import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "../../components/Icon";
import { Alert, Check, Skeleton, Spinner, TextField } from "../../components/ui";
import { api, ApiError } from "../../lib/api";
import { useQuery } from "../../lib/hooks";
import { useToast } from "../../lib/state";
import type { PaymentMethodInfo } from "../../../../shared/types";

/** Configuración de pasarelas, correo SMTP, Google y URL pública: todo desde el panel. */

interface View {
  values: Record<string, string | number | boolean>;
  detectedUrl: string | null;
  publicUrl: string;
  webhooks: { wompi: string; mercadopago: string; zenobank: string; googleRedirect: string };
  envOverrides: { encryptionKeyFromEnv: boolean };
}

type Draft = Record<string, string | number | boolean | undefined>;

function CopyField({ label, value }: { label: string; value: string }) {
  const toast = useToast();
  return (
    <div className="field">
      <span className="label">{label}</span>
      <div style={{ display: "flex", gap: 8 }}>
        <input className="input num" readOnly value={value} aria-label={label} style={{ fontSize: 13 }} onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="btn btn-soft" onClick={() => { void navigator.clipboard?.writeText(value); toast("success", "Copiado."); }} aria-label={`Copiar ${label}`}>
          <Icon name="copy" />
        </button>
      </div>
    </div>
  );
}

/** Campo secreto: vacío = conservar el guardado; «Quitar» lo borra. Nunca muestra el valor guardado. */
function SecretField({ name, label, view, draft, setDraft, error, hint }: { name: string; label: string; view: View; draft: Draft; setDraft: (d: Draft) => void; error?: string; hint?: string }) {
  const isSet = Boolean(view.values[`${name}Set`]);
  const cleared = draft[name] === "";
  return (
    <div className="field">
      <TextField
        label={label}
        type="password"
        autoComplete="new-password"
        value={typeof draft[name] === "string" ? (draft[name] as string) : ""}
        onValue={(v) => setDraft({ ...draft, [name]: v === "" ? undefined : v })}
        placeholder={cleared ? "Se borrará al guardar" : isSet ? `Guardado ${view.values[`${name}Hint`]} · escribe para cambiarlo` : "Sin configurar"}
        error={error}
        hint={hint}
      />
      {isSet && (
        <button type="button" className="text-accent" style={{ fontSize: 12, justifySelf: "start", padding: 0 }} onClick={() => setDraft({ ...draft, [name]: cleared ? undefined : "" })}>
          {cleared ? "Deshacer" : "Quitar valor guardado"}
        </button>
      )}
    </div>
  );
}

function Section({ title, status, children, defaultOpen }: { title: string; status?: { ok: boolean; text: string }; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="acc" open={defaultOpen}>
      <summary>
        <span style={{ flex: 1 }}>{title}</span>
        {status && <span className={`status ${status.ok ? "status-completed" : "status-pending_payment"}`}>{status.text}</span>}
        <Icon name="chevron-down" className="chev" />
      </summary>
      <div className="form" style={{ padding: "4px 0 20px" }}>{children}</div>
    </details>
  );
}

export function IntegrationsSettings({ methods, onSaved }: { methods: PaymentMethodInfo[]; onSaved: () => void }) {
  const toast = useToast();
  const q = useQuery(() => api.get<View>("/api/admin/settings/integrations"));
  const [draft, setDraft] = useState<Draft>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  // Campos no secretos: se cargan con el valor guardado para editarlos.
  useEffect(() => {
    if (!q.data) return;
    const v = q.data.values;
    setDraft({
      siteUrl: v.siteUrl as string,
      smtpHost: v.smtpHost as string,
      smtpPort: v.smtpPort as number,
      smtpUser: v.smtpUser as string,
      smtpFrom: v.smtpFrom as string,
      wompiPublicKey: v.wompiPublicKey as string,
      zenoCurrency: v.zenoCurrency as string,
      manualEnabled: v.manualEnabled as boolean,
      googleClientId: v.googleClientId as string,
    });
  }, [q.data]);

  if (q.error) return <Alert kind="error">{q.error.message}</Alert>;
  if (!q.data) return <Skeleton h={300} />;
  const view = q.data;
  const st = (id: string) => {
    const m = methods.find((x) => x.id === id);
    return m ? { ok: m.configured, text: m.configured ? "Activo" : "Pendiente" } : undefined;
  };
  const text = (name: string, label: string, extra: Partial<Parameters<typeof TextField>[0]> = {}) => (
    <TextField label={label} value={(draft[name] as string | number | undefined) ?? ""} onValue={(v) => setDraft({ ...draft, [name]: v })} error={errors[name]} {...extra} />
  );
  const secret = (name: string, label: string, hint?: string) => <SecretField name={name} label={label} view={view} draft={draft} setDraft={setDraft} error={errors[name]} hint={hint} />;

  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      const body: Draft = { ...draft, smtpPort: draft.smtpPort === "" || draft.smtpPort === undefined ? undefined : Number(draft.smtpPort) };
      await api.put("/api/admin/settings/integrations", body);
      toast("success", "Configuración guardada. Ya está activa.");
      await q.reload();
      onSaved();
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fields);
        toast("error", e.message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Pagos, correo y acceso</h3>
        <button className="btn btn-primary btn-sm" onClick={save} disabled={busy}>{busy && <Spinner />} Guardar cambios</button>
      </div>
      <p className="muted" style={{ fontSize: 14, marginBottom: 8 }}>
        Todo se configura aquí, sin tocar el servidor. Las claves secretas se guardan y nunca se vuelven a mostrar completas; deja un campo vacío para conservar lo guardado.
      </p>

      <Section title="Wompi · Nequi, Bancolombia, PSE y tarjetas" status={st("wompi")} defaultOpen>
        <p className="hint">En el dashboard de Wompi → Desarrolladores. Usa llaves de pruebas (pub_test_…) para ensayar.</p>
        {text("wompiPublicKey", "Llave pública", { placeholder: "pub_prod_…" })}
        <div className="form-row">
          {secret("wompiIntegritySecret", "Secreto de integridad")}
          {secret("wompiEventsSecret", "Secreto de eventos")}
        </div>
        <CopyField label="URL de eventos (pégala en Wompi)" value={view.webhooks.wompi} />
      </Section>

      <Section title="Mercado Pago" status={st("mercadopago")}>
        <p className="hint">En Mercado Pago → Tus integraciones → Credenciales de producción.</p>
        <div className="form-row">
          {secret("mpAccessToken", "Access token")}
          {secret("mpWebhookSecret", "Clave secreta del webhook (opcional)")}
        </div>
        <CopyField label="URL de notificaciones (evento «Pagos»)" value={view.webhooks.mercadopago} />
      </Section>

      <Section title="Zenobank · Criptomonedas" status={st("zenobank")}>
        <p className="hint">En el dashboard de Zenobank → Developers: API key (sk_…) y webhook (secreto whsec_…). Define la tasa en «Criptomonedas» más abajo.</p>
        <div className="form-row">
          {secret("zenoApiKey", "API key", "Empieza por sk_")}
          {secret("zenoWebhookSecret", "Secreto del webhook", "Empieza por whsec_")}
          {text("zenoCurrency", "Moneda de cotización", { placeholder: "USD", hint: "USD por defecto; COP si tu cuenta lo admite." })}
        </div>
        <CopyField label="URL del webhook (eventos checkout.*)" value={view.webhooks.zenobank} />
      </Section>

      <Section title="Transferencias (Nequi, Daviplata, Bancolombia)" status={st("manual")}>
        <Check checked={Boolean(draft.manualEnabled)} onChange={(v) => setDraft({ ...draft, manualEnabled: v })}>
          Aceptar pagos por transferencia (los confirmas tú desde Pedidos o Billetera)
        </Check>
        <p className="hint">Las instrucciones para el cliente (números de cuenta) se editan en «Datos de la tienda», más abajo.</p>
      </Section>

      <Section title="Correo (SMTP)" status={{ ok: Boolean(view.values.smtpHost && view.values.smtpUser && view.values.smtpPasswordSet), text: view.values.smtpHost && view.values.smtpPasswordSet ? "Configurado" : "Pendiente" }}>
        <p className="hint">Para recuperar contraseñas, avisos de pedidos y alertas. En Hostinger: smtp.hostinger.com, puerto 465, y un buzón de tu dominio.</p>
        <div className="form-row">
          {text("smtpHost", "Servidor", { placeholder: "smtp.hostinger.com" })}
          {text("smtpPort", "Puerto", { inputMode: "numeric", placeholder: "465" })}
        </div>
        <div className="form-row">
          {text("smtpUser", "Usuario (correo)", { placeholder: "no-reply@tu-dominio.com" })}
          {secret("smtpPassword", "Contraseña del buzón")}
        </div>
        {text("smtpFrom", "Remitente (opcional)", { placeholder: "NexiStore <no-reply@tu-dominio.com>" })}
        <div>
          <button type="button" className="btn btn-outline btn-sm" disabled={testing} onClick={async () => {
            setTesting(true);
            try {
              const r = await api.post<{ to: string }>("/api/admin/settings/integrations/test-email");
              toast("success", `Correo de prueba enviado a ${r.to}.`);
            } catch (e) {
              toast("error", e instanceof ApiError ? e.message : "No se pudo enviar.");
            } finally {
              setTesting(false);
            }
          }}>{testing && <Spinner />} <Icon name="mail" /> Enviar correo de prueba (guarda primero)</button>
        </div>
      </Section>

      <Section title="Iniciar sesión con Google" status={{ ok: Boolean(view.values.googleClientId && view.values.googleClientSecretSet), text: view.values.googleClientId && view.values.googleClientSecretSet ? "Activo" : "Opcional" }}>
        <p className="hint">En Google Cloud → APIs y servicios → Credenciales → ID de cliente de OAuth (aplicación web).</p>
        <div className="form-row">
          {text("googleClientId", "Client ID")}
          {secret("googleClientSecret", "Client secret")}
        </div>
        <CopyField label="URI de redirección autorizada" value={view.webhooks.googleRedirect} />
      </Section>

      <Section title="Dirección de la tienda">
        <p className="hint">
          Se usa en los enlaces de los correos y en el regreso desde las pasarelas. Si la dejas vacía se usa la dirección con la que entras
          {view.detectedUrl ? <> (ahora: <strong>{view.detectedUrl}</strong>)</> : null}.
        </p>
        {text("siteUrl", "URL pública", { placeholder: "https://tu-dominio.com" })}
        <p className="hint">
          <Icon name="lock" size={12} style={{ display: "inline", verticalAlign: -1 }} /> Llave de cifrado del inventario:{" "}
          {view.envOverrides.encryptionKeyFromEnv ? "definida en el servidor (variable de entorno)." : "generada automáticamente y guardada en la base de datos. Haz copias de seguridad de la base de datos."}
        </p>
      </Section>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy && <Spinner />} Guardar cambios</button>
      </div>
    </div>
  );
}
