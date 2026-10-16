import { useRef, useState } from "react";
import { Icon } from "./Icon";
import { uploadImage } from "./ImageUploader";
import { Alert, Spinner, TextField } from "./ui";
import { ApiError } from "../lib/api";
import { formatCOP, formatDateTime } from "../lib/format";
import { useStore, useToast } from "../lib/state";
import type { ManualAccountPublic } from "../../../shared/types";

/**
 * Pago por transferencia con comprobante: el cliente ve las cuentas (Nequi, llave Bre-B, QR…),
 * transfiere el valor exacto y envía la referencia y la imagen del comprobante. Un administrador
 * lo revisa y acredita o rechaza; el cliente recibe la notificación.
 */

const KIND_ICON: Record<string, string> = { nequi: "smartphone", daviplata: "smartphone", breb: "key", bancolombia: "card", qr: "receipt", otro: "wallet" };

function CopyButton({ value, label }: { value: string; label: string }) {
  const toast = useToast();
  return (
    <button
      type="button"
      className="icon-btn"
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        toast("success", `${label} copiado.`);
      }}
      aria-label={`Copiar ${label}`}
    >
      <Icon name="copy" />
    </button>
  );
}

export function ManualAccounts({ accounts, amount, reference }: { accounts: ManualAccountPublic[]; amount: number; reference?: string }) {
  return (
    <div className="mp">
      <div className="mp-amount">
        <span>Transfiere el valor exacto</span>
        <strong className="num">{formatCOP(amount)}</strong>
        {reference && (
          <small>
            Escribe <strong className="num">{reference}</strong> en la descripción si tu banco lo permite.
          </small>
        )}
      </div>
      <div className="mp-accounts">
        {accounts.map((a) => (
          <div key={a.id} className="mp-account">
            <div className="mp-account-head">
              <span className="mp-kind"><Icon name={KIND_ICON[a.kind] ?? "wallet"} /></span>
              <div style={{ minWidth: 0 }}>
                <strong>{a.label}</strong>
                <small>{a.kindLabel}{a.holder ? ` · ${a.holder}` : ""}</small>
              </div>
            </div>
            {a.number && (
              <div className="mp-number">
                <span className="num">{a.number}</span>
                <CopyButton value={a.number} label={a.kind === "breb" ? "Llave" : "Número"} />
              </div>
            )}
            {a.qrImage && (
              <a className="mp-qr" href={a.qrImage} target="_blank" rel="noreferrer" title="Abrir el QR en grande">
                <img src={a.qrImage} alt={`Código QR de ${a.label}`} loading="lazy" />
              </a>
            )}
            {a.instructions && <p className="hint">{a.instructions}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

export interface ProofData {
  accountId: string;
  reference: string;
  proofUrl: string;
}

/** Formulario del comprobante: cuenta usada, referencia e imagen (privada). */
export function ProofForm({ accounts, submitLabel, onSubmit, extraValid = true }: { accounts: ManualAccountPublic[]; submitLabel: string; onSubmit: (d: ProofData) => Promise<void>; extraValid?: boolean }) {
  const toast = useToast();
  const [accountId, setAccountId] = useState(accounts.length === 1 ? accounts[0]!.id : "");
  const [reference, setReference] = useState("");
  const [proofUrl, setProofUrl] = useState("");
  const [preview, setPreview] = useState("");
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const input = useRef<HTMLInputElement>(null);

  const pick = async (file: File) => {
    setUploading(true);
    setErrors((e) => ({ ...e, proofUrl: "" }));
    try {
      const url = await uploadImage(file, 1800, "/api/account/proofs");
      setProofUrl(url);
      setPreview(url);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "No se pudo subir la imagen.");
    } finally {
      setUploading(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!accountId) errs.accountId = "Elige la cuenta a la que transferiste.";
    if (reference.trim().length < 4) errs.reference = "Escribe la referencia o número del comprobante.";
    if (!proofUrl) errs.proofUrl = "Sube la imagen del comprobante.";
    setErrors(errs);
    if (Object.keys(errs).length || !extraValid) return;
    setBusy(true);
    try {
      await onSubmit({ accountId, reference: reference.trim(), proofUrl });
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        toast("error", err.message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="form mp-form" onSubmit={submit} noValidate>
      <div className="field">
        <span className="label">¿A qué cuenta transferiste?</span>
        <div className="mp-pick" role="radiogroup" aria-label="Cuenta usada">
          {accounts.map((a) => (
            <button key={a.id} type="button" role="radio" aria-checked={accountId === a.id} className="variant-opt" onClick={() => setAccountId(a.id)}>
              <strong>{a.label}</strong>
              <small>{a.kindLabel}</small>
            </button>
          ))}
        </div>
        {errors.accountId && <p className="field-error">{errors.accountId}</p>}
      </div>
      <TextField label="Referencia del comprobante" value={reference} onValue={setReference} error={errors.reference} placeholder="Ej.: M12345678" maxLength={80} hint="Aparece en el comprobante de Nequi, Bre-B o de tu banco." />
      <div className="field">
        <span className="label">Imagen del comprobante</span>
        <button type="button" className={`mp-drop${preview ? " has-file" : ""}`} onClick={() => input.current?.click()} disabled={uploading}>
          {preview ? <img src={preview} alt="Comprobante" /> : uploading ? <Spinner /> : <Icon name="upload" size={24} />}
          <span>{uploading ? "Subiendo…" : preview ? "Cambiar imagen" : "Subir captura o foto del comprobante"}</span>
          <small>JPG, PNG o WebP · solo la ve nuestro equipo</small>
        </button>
        {errors.proofUrl && <p className="field-error">{errors.proofUrl}</p>}
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void pick(f);
            e.target.value = "";
          }}
        />
      </div>
      <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={busy || uploading}>
        {busy && <Spinner />} <Icon name="check" /> {submitLabel}
      </button>
    </form>
  );
}

/** Estado del comprobante enviado. */
export function ProofSent({ url, reference, account, submittedAt, note }: { url: string | null; reference: string | null; account: string | null; submittedAt?: string | null; note?: string }) {
  return (
    <div className="mp-sent">
      {url && (
        <a href={url} target="_blank" rel="noreferrer" className="mp-thumb" title="Ver comprobante">
          <img src={url} alt="Comprobante enviado" />
        </a>
      )}
      <div>
        <strong><Icon name="clock" size={15} style={{ verticalAlign: -2 }} /> Comprobante en revisión</strong>
        <p className="hint">
          {account}
          {reference ? ` · ref. ${reference}` : ""}
          {submittedAt ? ` · ${formatDateTime(submittedAt)}` : ""}
        </p>
        <p className="hint">{note ?? "Te avisaremos por aquí y por correo cuando lo confirmemos."}</p>
      </div>
    </div>
  );
}

/** Bloque completo para un pedido pendiente pagado por transferencia. */
export function OrderManualPay({
  code,
  total,
  proof,
  onSubmit,
}: {
  code: string;
  total: number;
  proof?: { url: string | null; reference: string | null; account: string | null; submittedAt: string | null } | null;
  onSubmit: (d: ProofData) => Promise<void>;
}) {
  const store = useStore();
  const accounts = store?.manualAccounts ?? [];
  if (proof?.url) return <ProofSent {...proof} />;
  if (!accounts.length)
    return (
      <Alert kind="info">
        <strong>Pago por transferencia.</strong> {store?.store.manualPaymentInstructions}
        <br />
        Valor exacto: <strong className="num">{formatCOP(total)}</strong> · Referencia: <strong className="num">{code}</strong>
      </Alert>
    );
  return (
    <div className="mp-wrap">
      <ManualAccounts accounts={accounts} amount={total} reference={code} />
      <h3 className="mp-title">Envía tu comprobante</h3>
      <ProofForm accounts={accounts} submitLabel="Enviar comprobante" onSubmit={onSubmit} />
    </div>
  );
}
