import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { Icon } from "./Icon";
import { discountPercent, formatCOP, ORDER_STATUS_LABEL } from "../lib/format";

/* ---------- Marca ---------- */

export function LogoMark({ className = "logo-mark" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 40 40" aria-hidden="true">
      <path d="M20 2 36 11v18L20 38 4 29V11z" fill="#e3122c" />
      <path d="M14 27V13h3l7 9v-9h3v14h-3l-7-9v9z" fill="#fff" />
    </svg>
  );
}

export function Logo({ to = "/", sub = "PRODUCTOS DIGITALES" }: { to?: string; sub?: string }) {
  return (
    <Link className="logo" to={to} aria-label="NexiStore, ir al inicio">
      <LogoMark />
      <span className="logo-word">
        <strong>NexiStore</strong>
        <small>{sub}</small>
      </span>
    </Link>
  );
}

/* ---------- Arte de producto (propio, sin logotipos de terceros) ---------- */

export function ProductArt({
  glyph,
  color,
  name,
  imageUrl,
  ribbon,
  showName = true,
  icon,
}: {
  glyph: string;
  color: string;
  name?: string;
  imageUrl?: string | null;
  ribbon?: boolean;
  showName?: boolean;
  icon?: string;
}) {
  return (
    <div className="art" style={{ ["--hue" as string]: color }}>
      {imageUrl ? (
        <img src={imageUrl} alt="" loading="lazy" />
      ) : (
        <>
          {ribbon && <div className="art-ribbon" />}
          <div className="art-glyph">{icon ? <Icon name={icon} /> : glyph}</div>
          {showName && name && <div className="art-name">{name}</div>}
        </>
      )}
    </div>
  );
}

/* ---------- Precio y estados ---------- */

export function Price({ price, compareAt, size }: { price: number; compareAt?: number | null; size?: "lg" }) {
  return (
    <div className={size === "lg" ? "pdp-price" : "price-line"}>
      <span className="price">{formatCOP(price)}</span>
      {compareAt && compareAt > price ? <span className="price-old">{formatCOP(compareAt)}</span> : null}
      {size === "lg" && discountPercent(price, compareAt) > 0 && <span className="badge-off">-{discountPercent(price, compareAt)}%</span>}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const label = ORDER_STATUS_LABEL[status as keyof typeof ORDER_STATUS_LABEL] ?? status;
  return <span className={`status status-${status}`}>{label}</span>;
}

export function Stars({ value }: { value: number }) {
  return (
    <span className="stars" aria-label={`${value} de 5 estrellas`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Icon key={i} name="star" fill={i <= Math.round(value) ? "currentColor" : "none"} />
      ))}
    </span>
  );
}

/* ---------- Estados de carga, vacío y error ---------- */

export function Empty({ icon = "box", title, text, action }: { icon?: string; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} />
      </div>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Empty
      icon="alert"
      title="No pudimos cargar esta información"
      text={message}
      action={
        onRetry && (
          <button className="btn btn-outline" onClick={onRetry}>
            <Icon name="refresh" /> Reintentar
          </button>
        )
      }
    />
  );
}

export function Skeleton({ h = 16, w = "100%", r }: { h?: number | string; w?: number | string; r?: number }) {
  return <div className="skel" style={{ height: h, width: w, borderRadius: r }} aria-hidden="true" />;
}

export function CardSkeletons({ n = 6 }: { n?: number }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="pcard" aria-hidden="true">
          <div className="skel" style={{ aspectRatio: "1", borderRadius: 0 }} />
          <div className="pcard-body" style={{ gap: 8 }}>
            <Skeleton h={16} w="70%" />
            <Skeleton h={12} w="50%" />
            <Skeleton h={22} w="60%" />
            <Skeleton h={34} />
          </div>
        </div>
      ))}
    </>
  );
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

export function Alert({ kind = "info", children }: { kind?: "info" | "error" | "success" | "warning"; children: ReactNode }) {
  const icon = kind === "success" ? "check" : kind === "info" ? "info" : "alert";
  return (
    <div className={`alert alert-${kind}`} role={kind === "error" ? "alert" : undefined}>
      <Icon name={icon} />
      <div>{children}</div>
    </div>
  );
}

/* ---------- Formularios ---------- */

interface FieldProps {
  label: string;
  error?: string;
  hint?: string;
  children: (id: string, describedBy?: string) => ReactNode;
}

export function Field({ label, error, hint, children }: FieldProps) {
  const id = useId();
  const errId = `${id}-err`;
  return (
    <div className={`field${error ? " has-error" : ""}`}>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      {children(id, error ? errId : undefined)}
      {error ? (
        <p className="field-error" id={errId}>
          <Icon name="alert" size={13} /> {error}
        </p>
      ) : hint ? (
        <p className="hint">{hint}</p>
      ) : null}
    </div>
  );
}

type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> & {
  label: string;
  value: string | number;
  onValue: (v: string) => void;
  error?: string;
  hint?: string;
  icon?: string;
};

export function TextField({ label, value, onValue, error, hint, icon, type = "text", ...rest }: InputProps) {
  const [show, setShow] = useState(false);
  const isPw = type === "password";
  return (
    <Field label={label} error={error} hint={hint}>
      {(id, describedBy) => (
        <div className="input-wrap">
          {icon && <Icon name={icon} />}
          <input
            id={id}
            className="input"
            type={isPw && show ? "text" : type}
            value={value}
            onChange={(e) => onValue(e.target.value)}
            aria-invalid={Boolean(error)}
            aria-describedby={describedBy}
            style={isPw ? { paddingRight: 48 } : undefined}
            {...rest}
          />
          {isPw && (
            <button type="button" className="icon-btn input-action" onClick={() => setShow((s) => !s)} aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"}>
              <Icon name={show ? "eye-off" : "eye"} />
            </button>
          )}
        </div>
      )}
    </Field>
  );
}

export function TextArea({
  label,
  value,
  onValue,
  error,
  hint,
  rows = 4,
  ...rest
}: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value"> & { label: string; value: string; onValue: (v: string) => void; error?: string; hint?: string }) {
  return (
    <Field label={label} error={error} hint={hint}>
      {(id, describedBy) => (
        <textarea id={id} className="textarea" rows={rows} value={value} onChange={(e) => onValue(e.target.value)} aria-invalid={Boolean(error)} aria-describedby={describedBy} {...rest} />
      )}
    </Field>
  );
}

export function SelectField({
  label,
  value,
  onValue,
  error,
  options,
  hint,
}: {
  label: string;
  value: string | number;
  onValue: (v: string) => void;
  error?: string;
  hint?: string;
  options: { value: string | number; label: string }[];
}) {
  return (
    <Field label={label} error={error} hint={hint}>
      {(id, describedBy) => (
        <select id={id} className="select" value={value} onChange={(e) => onValue(e.target.value)} aria-invalid={Boolean(error)} aria-describedby={describedBy}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

export function Check({ checked, onChange, children, error }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; error?: string }) {
  return (
    <div className={`field${error ? " has-error" : ""}`}>
      <label className="check">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-invalid={Boolean(error)} />
        <span>{children}</span>
      </label>
      {error && (
        <p className="field-error">
          <Icon name="alert" size={13} /> {error}
        </p>
      )}
    </div>
  );
}

export function SubmitButton({ loading, children, className = "btn btn-primary", disabled }: { loading: boolean; children: ReactNode; className?: string; disabled?: boolean }) {
  return (
    <button type="submit" className={className} disabled={loading || disabled} aria-busy={loading}>
      {loading && <Spinner />}
      {children}
    </button>
  );
}

/* ---------- Modal (dialog nativo) ---------- */

export function Modal({ open, title, onClose, children, footer, wide }: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="modal" onClose={onClose} onCancel={onClose} style={wide ? { width: "min(860px, calc(100vw - 32px))" } : undefined}>
      {open && (
        <>
          <div className="modal-head">
            <h3>{title}</h3>
            <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
              <Icon name="x" />
            </button>
          </div>
          <div className="modal-body">{children}</div>
          {footer && <div className="modal-foot">{footer}</div>}
        </>
      )}
    </dialog>
  );
}

export function ConfirmModal({
  open,
  title,
  text,
  confirmLabel = "Confirmar",
  danger,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  text: string;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Volver
          </button>
          <button className={danger ? "btn btn-primary" : "btn btn-primary"} onClick={onConfirm} disabled={busy}>
            {busy && <Spinner />} {confirmLabel}
          </button>
        </>
      }
    >
      <p className="muted">{text}</p>
    </Modal>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav className="row-actions" style={{ justifyContent: "center", marginTop: 24, alignItems: "center", gap: 12 }} aria-label="Paginación">
      <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        <Icon name="chevron-left" /> Anterior
      </button>
      <span className="faint num" style={{ fontSize: 13 }}>
        Página {page} de {pages}
      </span>
      <button className="btn btn-outline btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Siguiente <Icon name="chevron-right" />
      </button>
    </nav>
  );
}

export function QtyStepper({ value, onChange, max, min = 1, label }: { value: number; onChange: (v: number) => void; max: number; min?: number; label: string }) {
  return (
    <div className="qty" role="group" aria-label={`Cantidad de ${label}`}>
      <button type="button" onClick={() => onChange(value - 1)} disabled={value <= min} aria-label="Disminuir cantidad">
        <Icon name="minus" />
      </button>
      <output aria-live="polite">{value}</output>
      <button type="button" onClick={() => onChange(value + 1)} disabled={value >= max} aria-label="Aumentar cantidad">
        <Icon name="plus" />
      </button>
    </div>
  );
}

/**
 * Menú lateral (móvil/tablet). Se monta en <body> con un portal: si quedara dentro de la cabecera,
 * su `backdrop-filter` encierra los elementos `position: fixed` y el menú se cortaría.
 */
export function Drawer({ open, onClose, label, children }: { open: boolean; onClose: () => void; label: string; children: ReactNode }) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside ref={panel} className="drawer" aria-label={label} aria-modal="true" role="dialog" tabIndex={-1}>
        {children}
      </aside>
    </>,
    document.body,
  );
}
