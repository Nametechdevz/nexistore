import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Icon } from "../../components/Icon";
import { Alert, Empty, ErrorState, Modal, SelectField, Skeleton, Spinner, SubmitButton, TextArea, TextField } from "../../components/ui";
import { api, ApiError } from "../../lib/api";
import { formatCOP, formatDate, formatDateTime, PROVIDER_LABEL } from "../../lib/format";
import { useDocumentTitle, useForm, useQuery } from "../../lib/hooks";
import { useStore, useToast } from "../../lib/state";
import { TOPUP_PROVIDERS, WALLET_MIN_TOPUP, WALLET_TX_LABEL } from "../../../../shared/constants";
import { ISSUE_REASONS, ticketSchema, topupSchema } from "../../../../shared/schemas";

/* ================= Billetera ================= */

interface WalletData {
  balance: number;
  transactions: { id: number; kind: keyof typeof WALLET_TX_LABEL; amount: number; balanceAfter: number; reference: string | null; note: string; createdAt: string }[];
  topups: { code: string; amount: number; provider: string; status: string; paymentCurrency: string | null; paymentAmountForeign: string | null; createdAt: string }[];
}

const PRESETS = [20000, 50000, 100000, 200000];
const TX_ICON = { topup: "plus", purchase: "bag", refund: "refresh", adjustment: "pencil" } as const;
const TOPUP_STATUS: Record<string, string> = { pending: "Pendiente", paid: "Acreditada", cancelled: "Cancelada" };

export function WalletPage() {
  useDocumentTitle("Billetera");
  const toast = useToast();
  const store = useStore();
  const [params, setParams] = useSearchParams();
  const w = useQuery(() => api.get<WalletData>("/api/account/wallet"));
  const methods = (store?.paymentMethods ?? []).filter((m) => (TOPUP_PROVIDERS as readonly string[]).includes(m.id));
  const firstReady = methods.find((m) => m.configured)?.id ?? "wompi";
  const form = useForm(topupSchema, { amount: 50000, provider: firstReady as "wompi" });
  const [instructions, setInstructions] = useState<{ code: string; text: string } | null>(null);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    if (store) form.set("provider", firstReady as "wompi");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  // Al volver de la pasarela: el servidor consulta el estado real del pago.
  useEffect(() => {
    const code = params.get("recarga");
    if (!code) return;
    setVerifying(true);
    api
      .post<{ result: string; wallet: WalletData }>(`/api/account/wallet/topups/${encodeURIComponent(code)}/verify`, { params: Object.fromEntries(params.entries()) })
      .then((r) => {
        w.setData(r.wallet);
        const t = r.wallet.topups.find((x) => x.code === code);
        if (t?.status === "paid") toast("success", `Recarga de ${formatCOP(t.amount)} acreditada.`);
        else toast("info", "Aún no recibimos la confirmación de la pasarela. Se acreditará automáticamente al confirmarse.");
      })
      .catch(() => undefined)
      .finally(() => {
        setVerifying(false);
        setParams({}, { replace: true });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = methods.find((m) => m.id === form.values.provider);
  const foreign = selected?.id === "zenobank" && selected.rate ? (Math.ceil((Number(form.values.amount) / selected.rate) * 100) / 100).toFixed(2) : null;

  const submit = form.submit(async (d) => {
    const r = await api.post<{ code: string; action: { type: "redirect"; url: string } | { type: "instructions"; text: string } }>("/api/account/wallet/topups", d);
    if (r.action.type === "redirect") {
      window.location.assign(r.action.url);
      return;
    }
    setInstructions({ code: r.code, text: r.action.text });
    void w.reload();
  });

  if (w.error) return <ErrorState message={w.error.message} onRetry={w.reload} />;
  return (
    <>
      <div className="dash-head"><div><h1 className="dash-title">Billetera</h1><p className="eyebrow">Recarga saldo y paga tus compras al instante.</p></div></div>
      <div className="wallet-hero">
        <div>
          <p className="muted" style={{ fontSize: 14 }}>Saldo disponible</p>
          <p className="balance">{w.data ? formatCOP(w.data.balance) : "…"}</p>
          <p className="hint" style={{ marginTop: 6 }}>Los reembolsos por fallas también llegan aquí.</p>
        </div>
        {verifying && <span className="muted" style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}><Spinner /> Verificando recarga…</span>}
      </div>

      <div className="split">
        <div className="panel">
          <div className="panel-head"><h3>Recargar saldo</h3></div>
          <form className="form" onSubmit={submit} noValidate>
            {form.formError && <Alert kind="error">{form.formError}</Alert>}
            <div className="amount-presets" role="group" aria-label="Montos sugeridos">
              {PRESETS.map((a) => (
                <button key={a} type="button" aria-pressed={form.values.amount === a} onClick={() => form.set("amount", a)}>
                  {formatCOP(a)}
                </button>
              ))}
            </div>
            <TextField
              label="Monto (COP)"
              inputMode="numeric"
              value={form.values.amount || ""}
              onValue={(v) => form.set("amount", Number(v.replace(/\D/g, "")) || 0)}
              error={form.errors.amount}
              hint={`Mínimo ${formatCOP(WALLET_MIN_TOPUP)}.`}
            />
            <div className="pay-options" role="radiogroup" aria-label="Método de recarga">
              {methods.map((m) => (
                <label key={m.id} className={`pay-option${m.configured ? "" : " is-disabled"}`} style={{ gridTemplateColumns: "auto minmax(0,1fr) auto" }}>
                  <input type="radio" name="topup" disabled={!m.configured} checked={form.values.provider === m.id} onChange={() => form.set("provider", m.id as "wompi")} />
                  <span>
                    <strong style={{ display: "block" }}>{m.label}</strong>
                    <span className="faint" style={{ fontSize: 13 }}>{m.configured ? m.description : m.pendingReason}</span>
                  </span>
                  {!m.configured && <span className="status status-neutral">Pendiente</span>}
                </label>
              ))}
            </div>
            {form.errors.provider && <p className="field-error">{form.errors.provider}</p>}
            {foreign && <Alert kind="info">Pagarás el equivalente a <strong className="num">{foreign} {selected!.currency}</strong> en cripto (tasa {formatCOP(selected!.rate!)} por {selected!.currency}).</Alert>}
            <div>
              <SubmitButton loading={form.submitting} disabled={!methods.some((m) => m.configured)}>
                <Icon name="wallet" /> Recargar {formatCOP(Number(form.values.amount) || 0)}
              </SubmitButton>
            </div>
          </form>
        </div>
        <div className="panel">
          <div className="panel-head"><h3>Recargas recientes</h3></div>
          {!w.data ? <Skeleton h={100} /> : !w.data.topups.length ? <p className="muted" style={{ fontSize: 14 }}>Aún no has hecho recargas.</p> : (
            <ul className="ledger">
              {w.data.topups.map((t) => (
                <li key={t.code} className="ledger-row" style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}>
                  <span>
                    <strong className="num">{formatCOP(t.amount)}</strong> · {PROVIDER_LABEL[t.provider] ?? t.provider}
                    {t.paymentAmountForeign && <span className="faint"> ({t.paymentAmountForeign} {t.paymentCurrency})</span>}
                    <span className="faint" style={{ display: "block", fontSize: 12 }}>{t.code} · {formatDateTime(t.createdAt)}</span>
                  </span>
                  <span className={`status ${t.status === "paid" ? "status-completed" : t.status === "pending" ? "status-pending_payment" : "status-neutral"}`}>{TOPUP_STATUS[t.status]}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="panel" style={{ marginTop: 20 }}>
        <div className="panel-head"><h3>Movimientos</h3></div>
        {!w.data ? <Skeleton h={120} /> : !w.data.transactions.length ? (
          <Empty icon="wallet" title="Sin movimientos" text="Tus recargas, compras y reembolsos aparecerán aquí." />
        ) : (
          <ul className="ledger">
            {w.data.transactions.map((t) => (
              <li key={t.id} className="ledger-row">
                <span className="notif-icon"><Icon name={TX_ICON[t.kind]} /></span>
                <span style={{ minWidth: 0 }}>
                  <strong>{WALLET_TX_LABEL[t.kind]}</strong> <span className="muted">{t.note}</span>
                  <span className="faint" style={{ display: "block", fontSize: 12 }}>
                    {formatDateTime(t.createdAt)}
                    {t.reference?.startsWith("NS-") && <> · <Link className="text-accent" to={`/cuenta/pedidos/${t.reference}`}>{t.reference}</Link></>}
                  </span>
                </span>
                <span style={{ textAlign: "right" }}>
                  <strong className={`num ${t.amount > 0 ? "amount-pos" : "amount-neg"}`}>{t.amount > 0 ? "+" : "−"}{formatCOP(Math.abs(t.amount))}</strong>
                  <span className="faint num" style={{ display: "block", fontSize: 12 }}>Saldo {formatCOP(t.balanceAfter)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal open={instructions !== null} title="Recarga por transferencia" onClose={() => setInstructions(null)} footer={<button className="btn btn-primary" onClick={() => setInstructions(null)}>Entendido</button>}>
        <p className="prose">{instructions?.text}</p>
        <p style={{ marginTop: 12 }}>Referencia: <strong className="num">{instructions?.code}</strong></p>
        <p className="hint" style={{ marginTop: 8 }}>El saldo se acredita cuando verifiquemos la transferencia. Te avisaremos con una notificación.</p>
      </Modal>
    </>
  );
}

/* ================= Soporte ================= */

interface TicketSummary {
  id: number;
  subject: string;
  kind: "general" | "account_issue";
  status: "open" | "answered" | "closed";
  orderCode: string | null;
  resolution: string | null;
  createdAt: string;
  lastMessageAt: string;
  lastMessage: { body: string; authorRole: string } | null;
}

export const TICKET_STATUS = { open: "Abierta", answered: "Respondida", closed: "Cerrada" } as const;

export function SupportPage() {
  useDocumentTitle("Soporte");
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const tickets = useQuery(() => api.get<{ items: TicketSummary[] }>("/api/account/tickets"));
  const form = useForm(ticketSchema, { subject: params.get("pedido") ? `Ayuda con el pedido ${params.get("pedido")}` : "", message: "", orderCode: params.get("pedido") ?? "" });

  return (
    <>
      <div className="dash-head"><div><h1 className="dash-title">Soporte</h1><p className="eyebrow">Conversa con nuestro equipo sin salir de la tienda.</p></div></div>
      <div className="split">
        <div className="panel">
          <div className="panel-head"><h3>Mis solicitudes</h3></div>
          {tickets.error ? <ErrorState message={tickets.error.message} onRetry={tickets.reload} /> : tickets.loading ? <Skeleton h={80} /> : !tickets.data?.items.length ? (
            <p className="muted" style={{ fontSize: 14 }}>Aún no has creado solicitudes. Si una cuenta dejó de funcionar, repórtala desde el detalle de tu pedido.</p>
          ) : (
            <div className="order-list">
              {tickets.data.items.map((t) => (
                <Link key={t.id} to={`/cuenta/soporte/${t.id}`} className="order-card" style={{ background: "var(--bg-elev)" }}>
                  <div className="order-card-head">
                    <strong>{t.kind === "account_issue" && <Icon name="alert" size={15} style={{ display: "inline", verticalAlign: -2, marginRight: 6, color: "var(--warning)" }} />}{t.subject}</strong>
                    <span className={`status status-${t.status}`}>{TICKET_STATUS[t.status]}</span>
                  </div>
                  {t.lastMessage && <p className="muted" style={{ fontSize: 13 }}>{t.lastMessage.authorRole === "admin" ? "Soporte: " : ""}{t.lastMessage.body}</p>}
                  <span className="faint" style={{ fontSize: 12 }}>#{t.id} · {formatDateTime(t.lastMessageAt)}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
        <div className="panel">
          <div className="panel-head"><h3>Nueva solicitud</h3></div>
          <form
            className="form"
            noValidate
            onSubmit={form.submit(async (d) => {
              const r = await api.post<{ id: number }>("/api/account/tickets", d);
              toast("success", "Solicitud enviada. Te responderemos aquí mismo.");
              navigate(`/cuenta/soporte/${r.id}`);
            })}
          >
            {form.formError && <Alert kind="error">{form.formError}</Alert>}
            <TextField label="Asunto" value={form.values.subject} onValue={(v) => form.set("subject", v)} error={form.errors.subject} maxLength={140} />
            <TextField label="Código del pedido (opcional)" value={form.values.orderCode ?? ""} onValue={(v) => form.set("orderCode", v.toUpperCase())} error={form.errors.orderCode} placeholder="NS-20261015-ABC123" />
            <TextArea label="Mensaje" value={form.values.message} onValue={(v) => form.set("message", v)} error={form.errors.message} rows={5} maxLength={4000} />
            <div><SubmitButton loading={form.submitting}>Enviar solicitud</SubmitButton></div>
          </form>
        </div>
      </div>
    </>
  );
}

export interface TicketDetail extends TicketSummary {
  messages: { id: number; authorRole: "customer" | "admin" | "system"; authorName: string; body: string; createdAt: string }[];
  item: { orderItemId: number; productId: number; productName: string; inventoryStatus: string | null; serviceEndsAt: string | null; label?: string; availableReplacements?: number; inventoryItemId: number | null; unitPrice: number } | null;
  customer?: { id: number; name: string; email: string };
}

/** Conversación (cliente o admin). Se actualiza sola cada 15 s. */
export function Chat({ ticket, me, onSend, disabled }: { ticket: TicketDetail; me: "customer" | "admin"; onSend: (body: string) => Promise<void>; disabled?: boolean }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [ticket.messages.length]);
  return (
    <>
      <div className="chat" aria-live="polite">
        {ticket.messages.map((m) => (
          <div key={m.id} className={`bubble ${m.authorRole === "system" ? "system" : m.authorRole === me ? "mine" : "theirs"}`}>
            {m.body}
            <span className="bubble-meta">{m.authorRole === me ? "Tú" : m.authorName} · {formatDateTime(m.createdAt)}</span>
          </div>
        ))}
        <div ref={end} />
      </div>
      {!disabled && (
        <form
          className="chat-compose"
          onSubmit={async (e) => {
            e.preventDefault();
            if (body.trim().length < 2) return;
            setBusy(true);
            try {
              await onSend(body.trim());
              setBody("");
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="sr-only" htmlFor="chat-input">Mensaje</label>
          <textarea
            id="chat-input"
            className="textarea"
            placeholder="Escribe tu mensaje…"
            value={body}
            maxLength={4000}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                (e.currentTarget.form as HTMLFormElement).requestSubmit();
              }
            }}
          />
          <button className="btn btn-primary" disabled={busy || body.trim().length < 2} aria-label="Enviar">
            {busy ? <Spinner /> : <Icon name="arrow-right" />}
          </button>
        </form>
      )}
    </>
  );
}

export function TicketPage() {
  const { id = "" } = useParams();
  const toast = useToast();
  const q = useQuery(() => api.get<{ ticket: TicketDetail }>(`/api/account/tickets/${encodeURIComponent(id)}`), [id]);
  useDocumentTitle(q.data?.ticket.subject ?? "Soporte");
  useEffect(() => {
    const t = setInterval(() => {
      api.get<{ ticket: TicketDetail }>(`/api/account/tickets/${encodeURIComponent(id)}`).then((r) => q.setData(r)).catch(() => undefined);
    }, 15_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (q.error?.status === 404) return <Empty icon="search" title="Solicitud no encontrada" action={<Link className="btn btn-primary" to="/cuenta/soporte">Ver mis solicitudes</Link>} />;
  if (q.error) return <ErrorState message={q.error.message} onRetry={q.reload} />;
  if (!q.data) return <div style={{ display: "grid", placeItems: "center", minHeight: 300 }}><Spinner /></div>;
  const t = q.data.ticket;
  return (
    <>
      <div className="dash-head">
        <div>
          <Link to="/cuenta/soporte" className="faint" style={{ fontSize: 13 }}>← Soporte</Link>
          <h1 className="dash-title" style={{ marginTop: 6 }}>{t.subject}</h1>
          <p className="eyebrow">
            Solicitud #{t.id}
            {t.orderCode && <> · <Link className="text-accent" to={`/cuenta/pedidos/${t.orderCode}`}>Pedido {t.orderCode}</Link></>}
          </p>
        </div>
        <span className={`status status-${t.status}`}>{TICKET_STATUS[t.status]}</span>
      </div>
      {t.resolution && (
        <div style={{ marginBottom: 16 }}>
          <Alert kind="success">{t.resolution === "replaced" ? "Tu cuenta fue reemplazada. Revisa los nuevos datos en el pedido." : "Te reembolsamos a la billetera."}</Alert>
        </div>
      )}
      <div className="panel">
        <Chat
          ticket={t}
          me="customer"
          onSend={async (body) => {
            try {
              const r = await api.post<{ ticket: TicketDetail }>(`/api/account/tickets/${t.id}/messages`, { body });
              q.setData(r);
            } catch (e) {
              toast("error", e instanceof ApiError ? e.message : "No se pudo enviar.");
              throw e;
            }
          }}
        />
      </div>
    </>
  );
}

/* ================= Reportar falla ================= */

export function ReportIssueModal({
  open,
  onClose,
  orderCode,
  orderItemId,
  inventoryItemId,
  productName,
}: {
  open: boolean;
  onClose: () => void;
  orderCode: string;
  orderItemId: number;
  inventoryItemId?: number;
  productName: string;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const [reason, setReason] = useState<keyof typeof ISSUE_REASONS>("caida");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      open={open}
      title={`Reportar falla · ${productName}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const r = await api.post<{ ticketId: number }>(`/api/orders/${orderCode}/items/${orderItemId}/report`, { inventoryItemId, reason, message });
                toast("success", "Reporte enviado. Te responderemos en la conversación.");
                navigate(`/cuenta/soporte/${r.ticketId}`);
              } catch (e) {
                setError(e instanceof ApiError ? e.message : "No se pudo enviar el reporte.");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Spinner />} Enviar reporte
          </button>
        </>
      }
    >
      <div className="form">
        {error && <Alert kind="error">{error}</Alert>}
        <SelectField label="¿Qué ocurre?" value={reason} onValue={(v) => setReason(v as keyof typeof ISSUE_REASONS)} options={Object.entries(ISSUE_REASONS).map(([value, label]) => ({ value, label }))} />
        <TextArea label="Detalles (opcional)" value={message} onValue={setMessage} rows={4} maxLength={2000} hint="Ej.: mensaje de error que ves al iniciar sesión." />
        <p className="hint">Revisaremos la cuenta y la reemplazaremos o te reembolsaremos a la billetera. Tu pedido se actualizará automáticamente.</p>
      </div>
    </Modal>
  );
}

/** Días restantes del servicio, con aviso cuando faltan pocos. */
export function ServiceEnds({ iso }: { iso: string | null }) {
  if (!iso) return null;
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return <span className="chip-warn" style={{ color: "#ff6b6b" }}>Servicio vencido el {formatDate(iso)}</span>;
  return days <= 7 ? <span className="chip-warn">Vence en {days} día{days === 1 ? "" : "s"} ({formatDate(iso)})</span> : <span className="faint" style={{ fontSize: 12 }}>Activo hasta el {formatDate(iso)}</span>;
}
