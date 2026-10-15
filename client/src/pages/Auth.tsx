import { useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Icon } from "../components/Icon";
import { Alert, Check, Logo, SubmitButton, TextField } from "../components/ui";
import { api } from "../lib/api";
import { useDocumentTitle, useForm } from "../lib/hooks";
import { useSession, useToast } from "../lib/state";
import { forgotSchema, loginSchema, registerSchema, resetSchema } from "../../../shared/schemas";

const GOOGLE_ERRORS: Record<string, string> = {
  google_no_configurado: "El inicio de sesión con Google está pendiente de configuración.",
  google_estado: "La sesión con Google expiró. Inténtalo de nuevo.",
  google_token: "Google no autorizó el inicio de sesión.",
  google_perfil: "No pudimos leer tu perfil de Google.",
  google_correo: "Tu correo de Google no está verificado.",
  cuenta_inactiva: "Tu cuenta está desactivada. Contacta a soporte.",
};

/** Solo se permiten rutas internas como destino tras iniciar sesión. */
const safeNext = (n: string | null) => (n && n.startsWith("/") && !n.startsWith("//") ? n : "/cuenta");

function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <div className="auth-form">
        <div className="auth-form-inner">{children}</div>
      </div>
      <aside className="auth-aside" aria-hidden="true">
        <div className="snow" />
        <div style={{ position: "absolute", inset: "8% 8% auto auto", width: "46%", transform: "rotate(8deg)" }}>
          <div className="art" style={{ ["--hue" as string]: "#e3122c", borderRadius: 22, boxShadow: "var(--shadow-3)" }}>
            <div className="art-ribbon" />
            <div className="art-glyph"><Icon name="gift" /></div>
          </div>
        </div>
        <h2>¡Forma parte de NexiStore!</h2>
        <ul className="benefits">
          <li><Icon name="percent" /> Acceso a promociones exclusivas</li>
          <li><Icon name="receipt" /> Historial y seguimiento de tus compras</li>
          <li><Icon name="headphones" /> Soporte prioritario</li>
          <li><Icon name="key" /> Tus productos y accesos en un solo lugar</li>
        </ul>
      </aside>
    </div>
  );
}

function GoogleButton() {
  const { googleEnabled } = useSession();
  if (!googleEnabled)
    return (
      <button type="button" className="btn btn-outline btn-block" disabled title="Se activa en Admin → Configuración → Pagos, correo y acceso">
        <GoogleG /> Continuar con Google (pendiente de configuración)
      </button>
    );
  return (
    <a className="btn btn-outline btn-block" href="/api/auth/google">
      <GoogleG /> Continuar con Google
    </a>
  );
}

function GoogleG() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.6 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h6a5.1 5.1 0 0 1-2.2 3.4v2.8h3.6c2.1-1.9 3.2-4.8 3.2-8.2Z" />
      <path fill="#34A853" d="M12 23c3 0 5.5-1 7.4-2.7l-3.6-2.8c-1 .7-2.3 1.1-3.8 1.1-2.9 0-5.4-2-6.3-4.6H2v2.9A11 11 0 0 0 12 23Z" />
      <path fill="#FBBC05" d="M5.7 14a6.6 6.6 0 0 1 0-4.2V7H2a11 11 0 0 0 0 9.9L5.7 14Z" />
      <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.3 1.7l3.2-3.2A11 11 0 0 0 2 7l3.7 2.9C6.6 7.4 9.1 5.4 12 5.4Z" />
    </svg>
  );
}

export function LoginPage() {
  useDocumentTitle("Iniciar sesión");
  const { user, refresh } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const form = useForm(loginSchema, { email: "", password: "", remember: true });
  const googleError = GOOGLE_ERRORS[params.get("error") ?? ""];

  if (user) return <Navigate to={next} replace />;

  const onSubmit = form.submit(async (data) => {
    await api.post("/api/auth/login", data);
    await refresh();
    navigate(next, { replace: true });
  });

  return (
    <AuthShell>
      <Logo />
      <h1 className="auth-title" style={{ marginTop: 32 }}>Bienvenido de nuevo</h1>
      <p className="muted" style={{ margin: "6px 0 28px" }}>Ingresa a tu cuenta para continuar.</p>
      <form className="form" onSubmit={onSubmit} noValidate>
        {(form.formError || googleError) && <Alert kind="error">{form.formError ?? googleError}</Alert>}
        <TextField label="Correo electrónico" icon="mail" type="email" autoComplete="email" placeholder="tucorreo@ejemplo.com" value={form.values.email} onValue={(v) => form.set("email", v)} error={form.errors.email} />
        <TextField label="Contraseña" icon="lock" type="password" autoComplete="current-password" placeholder="Tu contraseña" value={form.values.password} onValue={(v) => form.set("password", v)} error={form.errors.password} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <Check checked={Boolean(form.values.remember)} onChange={(v) => form.set("remember", v)}>Recordarme</Check>
          <Link to="/recuperar" className="text-accent" style={{ fontSize: 13 }}>¿Olvidaste tu contraseña?</Link>
        </div>
        <SubmitButton loading={form.submitting} className="btn btn-primary btn-lg btn-block">Iniciar sesión</SubmitButton>
        <div className="divider">o</div>
        <GoogleButton />
        <p className="muted" style={{ textAlign: "center", fontSize: 14 }}>
          ¿No tienes una cuenta? <Link className="text-accent" to={`/registro${next !== "/cuenta" ? `?next=${encodeURIComponent(next)}` : ""}`}>Regístrate aquí</Link>
        </p>
      </form>
    </AuthShell>
  );
}

function passwordScore(pw: string) {
  let s = 0;
  if (pw.length >= 8) s++;
  if (/[A-Za-z]/.test(pw) && /\d/.test(pw)) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (pw.length >= 12 || /[^A-Za-z0-9]/.test(pw)) s++;
  return s;
}

function PasswordMeter({ value }: { value: string }) {
  const score = passwordScore(value);
  if (!value) return null;
  return (
    <div className="pw-meter" data-score={score} aria-label={`Seguridad de la contraseña: ${["muy débil", "débil", "media", "buena", "fuerte"][score]}`}>
      {[0, 1, 2, 3].map((i) => <span key={i} className={i < score ? "on" : ""} />)}
    </div>
  );
}

export function RegisterPage() {
  useDocumentTitle("Crear cuenta");
  const { user, refresh } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const form = useForm(registerSchema, { name: "", email: "", password: "", confirmPassword: "", acceptTerms: false as unknown as true });
  if (user) return <Navigate to={next} replace />;

  const onSubmit = form.submit(async (data) => {
    await api.post("/api/auth/register", data);
    await refresh();
    navigate(next, { replace: true });
  });

  return (
    <AuthShell>
      <Logo />
      <h1 className="auth-title" style={{ marginTop: 32 }}>Crea tu cuenta</h1>
      <p className="muted" style={{ margin: "6px 0 28px" }}>Compra más rápido y sigue tus pedidos.</p>
      <form className="form" onSubmit={onSubmit} noValidate>
        {form.formError && <Alert kind="error">{form.formError}</Alert>}
        <TextField label="Nombre completo" icon="user" autoComplete="name" value={form.values.name} onValue={(v) => form.set("name", v)} error={form.errors.name} />
        <TextField label="Correo electrónico" icon="mail" type="email" autoComplete="email" value={form.values.email} onValue={(v) => form.set("email", v)} error={form.errors.email} />
        <div className="field" style={{ gap: 8 }}>
          <TextField label="Contraseña" icon="lock" type="password" autoComplete="new-password" value={form.values.password} onValue={(v) => form.set("password", v)} error={form.errors.password} hint="Mínimo 8 caracteres, con letras y números." />
          <PasswordMeter value={form.values.password} />
        </div>
        <TextField label="Confirmar contraseña" icon="lock" type="password" autoComplete="new-password" value={form.values.confirmPassword} onValue={(v) => form.set("confirmPassword", v)} error={form.errors.confirmPassword} />
        <Check checked={Boolean(form.values.acceptTerms)} onChange={(v) => form.set("acceptTerms", v as true)} error={form.errors.acceptTerms}>
          Acepto los <Link to="/terminos" className="text-accent" target="_blank">términos</Link> y la <Link to="/privacidad" className="text-accent" target="_blank">política de privacidad</Link>.
        </Check>
        <SubmitButton loading={form.submitting} className="btn btn-primary btn-lg btn-block">Crear cuenta</SubmitButton>
        <div className="divider">o</div>
        <GoogleButton />
        <p className="muted" style={{ textAlign: "center", fontSize: 14 }}>
          ¿Ya tienes cuenta? <Link className="text-accent" to="/ingresar">Inicia sesión</Link>
        </p>
      </form>
    </AuthShell>
  );
}

export function ForgotPage() {
  useDocumentTitle("Recuperar contraseña");
  const [sent, setSent] = useState(false);
  const form = useForm(forgotSchema, { email: "" });
  const onSubmit = form.submit(async (data) => {
    await api.post("/api/auth/forgot", data);
    setSent(true);
  });
  return (
    <AuthShell>
      <Logo />
      <h1 className="auth-title" style={{ marginTop: 32 }}>Recupera tu contraseña</h1>
      <p className="muted" style={{ margin: "6px 0 28px" }}>Te enviaremos un enlace para crear una nueva.</p>
      {sent ? (
        <div className="form">
          <Alert kind="success">Si existe una cuenta con <strong>{form.values.email}</strong>, recibirás un correo con el enlace en unos minutos. Revisa también tu carpeta de spam.</Alert>
          <Link className="btn btn-outline btn-block" to="/ingresar">Volver a iniciar sesión</Link>
        </div>
      ) : (
        <form className="form" onSubmit={onSubmit} noValidate>
          {form.formError && <Alert kind="error">{form.formError}</Alert>}
          <TextField label="Correo electrónico" icon="mail" type="email" autoComplete="email" value={form.values.email} onValue={(v) => form.set("email", v)} error={form.errors.email} />
          <SubmitButton loading={form.submitting} className="btn btn-primary btn-lg btn-block">Enviar enlace</SubmitButton>
          <Link className="btn btn-ghost btn-block" to="/ingresar"><Icon name="arrow-left" /> Volver</Link>
        </form>
      )}
    </AuthShell>
  );
}

export function ResetPage() {
  useDocumentTitle("Nueva contraseña");
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const form = useForm(resetSchema, { token, password: "", confirmPassword: "" });
  useEffect(() => form.set("token", token), [token]); // eslint-disable-line react-hooks/exhaustive-deps
  const onSubmit = form.submit(async (data) => {
    await api.post("/api/auth/reset", data);
    toast("success", "Contraseña actualizada. Ya puedes iniciar sesión.");
    navigate("/ingresar", { replace: true });
  });
  return (
    <AuthShell>
      <Logo />
      <h1 className="auth-title" style={{ marginTop: 32 }}>Crea una nueva contraseña</h1>
      <p className="muted" style={{ margin: "6px 0 28px" }}>Por seguridad cerraremos las sesiones abiertas en otros dispositivos.</p>
      <form className="form" onSubmit={onSubmit} noValidate>
        {(form.formError || form.errors.token) && <Alert kind="error">{form.formError ?? form.errors.token} <Link to="/recuperar" className="text-accent">Solicitar otro enlace</Link></Alert>}
        <div className="field" style={{ gap: 8 }}>
          <TextField label="Nueva contraseña" icon="lock" type="password" autoComplete="new-password" value={form.values.password} onValue={(v) => form.set("password", v)} error={form.errors.password} />
          <PasswordMeter value={form.values.password} />
        </div>
        <TextField label="Confirmar contraseña" icon="lock" type="password" autoComplete="new-password" value={form.values.confirmPassword} onValue={(v) => form.set("confirmPassword", v)} error={form.errors.confirmPassword} />
        <SubmitButton loading={form.submitting} className="btn btn-primary btn-lg btn-block">Guardar contraseña</SubmitButton>
      </form>
    </AuthShell>
  );
}
