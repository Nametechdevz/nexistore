import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Icon } from "../../components/Icon";
import { Alert, Check, ConfirmModal, Empty, ErrorState, Modal, Pagination, ProductArt, SelectField, Skeleton, Spinner, StatusBadge, SubmitButton, TextArea, TextField } from "../../components/ui";
import { api, ApiError, qs } from "../../lib/api";
import { formatCOP, formatDate, formatDateTime, ORDER_STATUS_LABEL, PROVIDER_LABEL, slugify } from "../../lib/format";
import { useDebounced, useDocumentTitle, useForm, useQuery } from "../../lib/hooks";
import { useSession, useToast } from "../../lib/state";
import { OrdersTable } from "./AdminCatalog";
import { CustomerWalletModal } from "./AdminExtra";
import { IntegrationsSettings, ManualAccountsSettings, PaymentDisplaySettings } from "./AdminIntegrations";
import { ImageUploader } from "../../components/ImageUploader";
import { ThemeSettingsPanel } from "./AdminTheme";
import type { ThemeSettings } from "../../../../shared/themes";
import { RejectProofModal } from "./AdminExtra";
import { ORDER_STATUSES, ORDER_TRANSITIONS, type OrderStatus } from "../../../../shared/constants";
import { campaignSchema, couponInputSchema, postInputSchema, storeSettingsSchema } from "../../../../shared/schemas";
import type { Order, PaymentMethodInfo } from "../../../../shared/types";

/* ================= Pedidos ================= */

export function AdminOrders() {
  useDocumentTitle("Pedidos");
  const [params, setParams] = useSearchParams();
  const status = params.get("estado") ?? "";
  const page = Number(params.get("pagina") ?? 1) || 1;
  const [search, setSearch] = useState("");
  const q = useDebounced(search, 300);
  const list = useQuery(() => api.get<{ items: Order[]; total: number; pageSize: number }>(`/api/admin/orders${qs({ status, q, page })}`), [status, q, page]);

  return (
    <>
      <div className="dash-head"><div><h1 className="dash-title">Pedidos</h1><p className="eyebrow num">{list.data?.total ?? "…"} pedidos</p></div></div>
      <div className="tabs" style={{ marginBottom: 16 }}>
        <button className="tab" aria-selected={!status} onClick={() => setParams({})}>Todos</button>
        {ORDER_STATUSES.map((s) => (
          <button key={s} className="tab" aria-selected={status === s} onClick={() => setParams({ estado: s })}>{ORDER_STATUS_LABEL[s]}</button>
        ))}
      </div>
      <div className="toolbar">
        <div className="input-wrap" style={{ flex: 1, maxWidth: 380 }}>
          <Icon name="search" />
          <input className="input" placeholder="Código, nombre o correo…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar pedidos" />
        </div>
      </div>
      <div className="panel" style={{ padding: 8 }}>
        {list.error ? <ErrorState message={list.error.message} onRetry={list.reload} /> : list.loading && !list.data ? <Skeleton h={300} /> : <OrdersTable orders={list.data?.items ?? []} />}
      </div>
      {list.data && <Pagination page={page} pageSize={list.data.pageSize} total={list.data.total} onPage={(p) => setParams(status ? { estado: status, pagina: String(p) } : { pagina: String(p) })} />}
    </>
  );
}

interface AdminOrderDetail {
  order: Order;
  customer: { id: number; name: string; email: string } | null;
  payments: { provider: string; externalId: string; status: string; amount: number; createdAt: string }[];
}

export function AdminOrderDetail() {
  const { code = "" } = useParams();
  useDocumentTitle(`Pedido ${code}`);
  const toast = useToast();
  const q = useQuery(() => api.get<AdminOrderDetail>(`/api/admin/orders/${encodeURIComponent(code)}`), [code]);
  const [target, setTarget] = useState<OrderStatus | null>(null);
  const [note, setNote] = useState("");
  const [refundToWallet, setRefundToWallet] = useState(true);
  const [busy, setBusy] = useState(false);
  const [delivery, setDelivery] = useState<Record<number, string>>({});
  const [rejectingProof, setRejectingProof] = useState(false);

  useEffect(() => {
    if (q.data) setDelivery(Object.fromEntries(q.data.order.items.filter((i) => i.deliveryMode !== "auto").map((i) => [i.id, i.deliveryContent ?? ""])));
  }, [q.data]);

  if (q.error) return <ErrorState message={q.error.message} onRetry={q.reload} />;
  if (!q.data) return <div style={{ display: "grid", placeItems: "center", minHeight: 300 }}><Spinner /></div>;
  const o = q.data.order;
  const allowed = ORDER_TRANSITIONS[o.status].filter((s) => !(s === "paid" && o.paymentProvider !== "manual"));
  const canDeliver = ["paid", "processing", "completed"].includes(o.status);

  const changeStatus = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await api.post(`/api/admin/orders/${o.code}/status`, { status: target, note, refundToWallet: target === "refunded" && refundToWallet });
      toast("success", `Pedido actualizado a «${ORDER_STATUS_LABEL[target]}».`);
      setTarget(null);
      setNote("");
      await q.reload();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  };

  const saveDelivery = async (complete: boolean) => {
    setBusy(true);
    try {
      await api.post(`/api/admin/orders/${o.code}/delivery`, { items: Object.entries(delivery).map(([itemId, content]) => ({ itemId: Number(itemId), content })), complete });
      toast("success", complete ? "Entrega completada. El cliente ya puede ver sus datos." : "Entrega guardada.");
      await q.reload();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="dash-head">
        <div>
          <Link to="/admin/pedidos" className="faint" style={{ fontSize: 13 }}>← Pedidos</Link>
          <h1 className="dash-title num" style={{ marginTop: 6 }}>Pedido #{o.code}</h1>
          <p className="eyebrow">{formatDateTime(o.createdAt)} · {PROVIDER_LABEL[o.paymentProvider]} {o.paymentRef && `· Ref. ${o.paymentRef}`}</p>
        </div>
        <StatusBadge status={o.status} />
      </div>
      {o.paymentProvider === "manual" && o.status === "pending_payment" && (
        <div className="panel proof-panel" style={{ marginBottom: 20 }}>
          <div className="panel-head"><h3>Comprobante de transferencia</h3></div>
          {o.proof?.url ? (
            <div className="proof-review">
              <a href={o.proof.url} target="_blank" rel="noreferrer" className="proof-big" title="Abrir en grande">
                <img src={o.proof.url} alt="Comprobante del cliente" />
              </a>
              <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
                <p><span className="faint">Cuenta:</span> <strong>{o.proof.account}</strong></p>
                <p><span className="faint">Referencia:</span> <strong className="num">{o.proof.reference}</strong></p>
                <p><span className="faint">Valor del pedido:</span> <strong className="num">{formatCOP(o.total)}</strong></p>
                <p className="hint">Enviado {formatDateTime(o.proof.submittedAt)}. Verifica en tu cuenta que el dinero llegó por el valor exacto antes de confirmar.</p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="btn btn-primary" onClick={() => setTarget("paid")}><Icon name="check" /> Confirmar pago</button>
                  <button className="btn btn-outline" onClick={() => setRejectingProof(true)}><Icon name="x" /> Rechazar comprobante</button>
                </div>
              </div>
            </div>
          ) : (
            <p className="muted" style={{ fontSize: 14 }}>El cliente aún no ha enviado el comprobante. Puedes confirmar el pago igualmente si ya verificaste la transferencia.</p>
          )}
        </div>
      )}
      {rejectingProof && (
        <RejectProofModal
          title="Rechazar comprobante"
          onClose={() => setRejectingProof(false)}
          onReject={async (reason) => {
            try {
              await api.post(`/api/admin/orders/${o.code}/reject-proof`, { reason });
              toast("success", "Comprobante rechazado. El cliente fue notificado y puede enviar otro.");
              setRejectingProof(false);
              await q.reload();
            } catch (e) {
              toast("error", e instanceof ApiError ? e.message : "Error");
            }
          }}
        />
      )}
      {allowed.length > 0 && (
        <div className="panel" style={{ marginBottom: 20 }}>
          <div className="panel-head"><h3>Cambiar estado</h3></div>
          {o.status === "pending_payment" && o.paymentProvider !== "manual" && (
            <div style={{ marginBottom: 12 }}><Alert kind="info">Este pedido se pagará por {PROVIDER_LABEL[o.paymentProvider]}: se marcará como pagado automáticamente cuando la pasarela envíe la confirmación verificada.</Alert></div>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {allowed.map((s) => (
              <button key={s} className={s === "cancelled" || s === "refunded" ? "btn btn-outline btn-sm" : "btn btn-soft btn-sm"} onClick={() => setTarget(s)}>
                {s === "paid" ? "Confirmar pago recibido" : `Marcar como ${ORDER_STATUS_LABEL[s].toLowerCase()}`}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="split">
        <div className="panel">
          <div className="panel-head"><h3>Productos y entrega</h3></div>
          {!canDeliver && <p className="hint" style={{ marginBottom: 12 }}>La entrega se habilita cuando el pedido está pagado.</p>}
          {o.items.map((it) => (
            <div key={it.id} style={{ display: "grid", gap: 10, padding: "14px 0", borderBottom: "1px solid var(--line)" }}>
              <div className="cell-product">
                <ProductArt glyph={it.artGlyph} color={it.artColor ?? "#e3122c"} showName={false} />
                <div style={{ flex: 1 }}><strong>{it.productName}</strong>{it.variantName && <span className="variant-tag" style={{ marginLeft: 8 }}>{it.variantName}</span>}<div className="faint" style={{ fontSize: 12 }}>{it.quantity} × {formatCOP(it.unitPrice)}</div></div>
                <strong className="num">{formatCOP(it.unitPrice * it.quantity)}</strong>
              </div>
              {it.deliveryMode === "auto" ? (
                <div style={{ display: "grid", gap: 6 }}>
                  <span className="hint"><Icon name="key" size={12} style={{ display: "inline", verticalAlign: -1 }} /> Entrega automática desde inventario.</span>
                  {it.deliveries.length === 0 && <span className="faint" style={{ fontSize: 13 }}>{o.status === "pending_payment" ? "Cuenta reservada: se entrega al confirmarse el pago." : "Sin cuentas entregadas."}</span>}
                  {it.deliveries.map((d) => (
                    <div key={d.id} className={`delivery-card${d.status === "fallen" ? " is-fallen" : ""}`}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                        <span className={`status status-${d.status}`}>{d.status === "sold" ? "Entregada" : d.status === "fallen" ? "Caída" : "Vencida"}</span>
                        <span className="faint" style={{ fontSize: 12 }}>Servicio hasta {formatDate(d.serviceEndsAt)}</span>
                      </div>
                      {d.content && <div className="delivery-box">{d.content}</div>}
                    </div>
                  ))}
                  <Link className="btn btn-ghost btn-sm" style={{ justifySelf: "start" }} to={`/admin/inventario?q=${o.code}`}>Ver en inventario</Link>
                </div>
              ) : (
                <textarea className="textarea" rows={3} placeholder="Credenciales, códigos o instrucciones de entrega (solo visibles para el cliente cuando el pedido esté completado)" disabled={!canDeliver}
                  value={delivery[it.id] ?? ""} onChange={(e) => setDelivery((d) => ({ ...d, [it.id]: e.target.value }))} maxLength={4000} aria-label={`Entrega de ${it.productName}`} />
              )}
            </div>
          ))}
          <div style={{ marginTop: 12 }}>
            <div className="sum-row"><span>Subtotal</span><span>{formatCOP(o.subtotal)}</span></div>
            {o.discount > 0 && <div className="sum-row discount"><span>Descuento {o.couponCode && `(${o.couponCode})`}</span><span>-{formatCOP(o.discount)}</span></div>}
            <div className="sum-total"><span>Total</span><span>{formatCOP(o.total)}</span></div>
          </div>
          {canDeliver && (
            <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
              <button className="btn btn-outline" disabled={busy} onClick={() => saveDelivery(false)}>Guardar borrador</button>
              {o.status !== "completed" && <button className="btn btn-primary" disabled={busy} onClick={() => saveDelivery(true)}>{busy && <Spinner />} Entregar y completar</button>}
            </div>
          )}
        </div>
        <div>
          <div className="panel">
            <div className="panel-head"><h3>Cliente</h3></div>
            <p><strong>{o.buyerName}</strong></p>
            <p className="muted" style={{ fontSize: 14 }}>{o.buyerEmail} · {o.buyerPhone}</p>
            {o.buyerDocument && <p className="muted" style={{ fontSize: 14 }}>Documento {o.buyerDocument}</p>}
            {q.data.customer && <p className="hint" style={{ marginTop: 8 }}>Cuenta: {q.data.customer.email}</p>}
          </div>
          <div className="panel">
            <div className="panel-head"><h3>Historial</h3></div>
            <div className="timeline">
              {o.events?.map((e, i) => (
                <div key={i} className="tl-item is-on">
                  <span className="tl-dot"><Icon name="check" /></span>
                  <div><strong>{ORDER_STATUS_LABEL[e.status as OrderStatus] ?? e.status}</strong><span>{e.note} · {formatDateTime(e.createdAt)}</span></div>
                </div>
              ))}
            </div>
          </div>
          <div className="panel">
            <div className="panel-head"><h3>Eventos de pago</h3></div>
            {q.data.payments.length === 0 ? <p className="muted" style={{ fontSize: 14 }}>Sin eventos de la pasarela.</p> : (
              <ul style={{ display: "grid", gap: 8, fontSize: 13 }}>
                {q.data.payments.map((p, i) => (
                  <li key={i} className="muted">{formatDateTime(p.createdAt)} · {PROVIDER_LABEL[p.provider]} #{p.externalId} · {p.status} · {formatCOP(p.amount)}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
      <Modal open={target !== null} title={target ? `Cambiar a «${ORDER_STATUS_LABEL[target]}»` : ""} onClose={() => setTarget(null)}
        footer={<><button className="btn btn-ghost" onClick={() => setTarget(null)}>Volver</button><button className="btn btn-primary" onClick={changeStatus} disabled={busy}>{busy && <Spinner />} Confirmar</button></>}>
        {target === "paid" && <div style={{ marginBottom: 12 }}><Alert kind="warning">Confirma solo si verificaste que el dinero llegó a tu cuenta por el valor exacto: {formatCOP(o.total)}.</Alert></div>}
        {target === "cancelled" && <div style={{ marginBottom: 12 }}><Alert kind="info">El inventario reservado volverá a estar disponible.</Alert></div>}
        {target === "refunded" && (
          <div style={{ marginBottom: 12 }}>
            <Check checked={refundToWallet} onChange={setRefundToWallet}>Reembolsar {formatCOP(o.total)} a la billetera del cliente</Check>
            {!refundToWallet && <p className="hint" style={{ marginTop: 6 }}>Solo se registra el estado: devuelve el dinero por fuera de la tienda (pasarela o transferencia).</p>}
          </div>
        )}
        <TextArea label="Nota para el historial (visible para el cliente)" value={note} onValue={setNote} rows={3} maxLength={500} />
      </Modal>
    </>
  );
}

/* ================= Clientes ================= */

interface Customer { id: number; name: string; email: string; phone: string | null; role: "customer" | "admin"; isActive: boolean; createdAt: string; orders: number; spent: number; walletBalance: number }

export function AdminCustomers() {
  useDocumentTitle("Clientes");
  const toast = useToast();
  const { user } = useSession();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const q = useDebounced(search, 300);
  const list = useQuery(() => api.get<{ items: Customer[]; total: number; pageSize: number }>(`/api/admin/customers${qs({ q, page })}`), [q, page]);
  const [confirm, setConfirm] = useState<{ c: Customer; patch: Partial<Customer>; text: string } | null>(null);
  const [walletOf, setWalletOf] = useState<Customer | null>(null);

  return (
    <>
      <div className="dash-head"><div><h1 className="dash-title">Clientes</h1><p className="eyebrow num">{list.data?.total ?? "…"} cuentas</p></div></div>
      <div className="toolbar">
        <div className="input-wrap" style={{ flex: 1, maxWidth: 380 }}>
          <Icon name="search" />
          <input className="input" placeholder="Nombre o correo…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Buscar clientes" />
        </div>
      </div>
      <div className="panel" style={{ padding: 8 }}>
        {list.error ? <ErrorState message={list.error.message} onRetry={list.reload} /> : list.loading && !list.data ? <Skeleton h={300} /> : !list.data?.items.length ? <Empty icon="users" title="Sin resultados" /> : (
          <div className="table-wrap">
            <table className="table responsive">
              <thead><tr><th>Cliente</th><th>Registro</th><th>Pedidos</th><th className="t-right">Compras</th><th className="t-right">Billetera</th><th>Rol</th><th>Estado</th></tr></thead>
              <tbody>
                {list.data.items.map((c) => (
                  <tr key={c.id}>
                    <td><strong>{c.name}</strong><div className="faint" style={{ fontSize: 12 }}>{c.email}</div></td>
                    <td className="muted">{formatDate(c.createdAt)}</td>
                    <td className="num">{c.orders}</td>
                    <td className="t-right num t-strong">{formatCOP(c.spent)}</td>
                    <td className="t-right"><button className="btn btn-ghost btn-sm num" onClick={() => setWalletOf(c)}><Icon name="wallet" /> {formatCOP(c.walletBalance)}</button></td>
                    <td>
                      <select className="select" style={{ height: 34, width: "auto" }} value={c.role} disabled={c.id === user?.id} aria-label={`Rol de ${c.name}`}
                        onChange={(e) => setConfirm({ c, patch: { role: e.target.value as Customer["role"] }, text: e.target.value === "admin" ? `${c.name} tendrá acceso total al panel administrativo.` : `${c.name} perderá el acceso al panel.` })}>
                        <option value="customer">Cliente</option>
                        <option value="admin">Administrador</option>
                      </select>
                    </td>
                    <td>
                      <button className={`status ${c.isActive ? "status-completed" : "status-cancelled"}`} disabled={c.id === user?.id}
                        onClick={() => setConfirm({ c, patch: { isActive: !c.isActive }, text: c.isActive ? `Se cerrarán las sesiones de ${c.name} y no podrá ingresar.` : `${c.name} podrá volver a ingresar.` })}>
                        {c.isActive ? "Activa" : "Desactivada"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {list.data && <Pagination page={page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />}
      {walletOf && <CustomerWalletModal customer={walletOf} onClose={() => { setWalletOf(null); void list.reload(); }} />}
      <ConfirmModal open={confirm !== null} title="Confirmar cambio" text={confirm?.text ?? ""} onClose={() => setConfirm(null)}
        onConfirm={async () => {
          try {
            await api.patch(`/api/admin/customers/${confirm!.c.id}`, confirm!.patch);
            toast("success", "Cuenta actualizada.");
            void list.reload();
          } catch (e) {
            toast("error", e instanceof ApiError ? e.message : "Error");
          }
          setConfirm(null);
        }} />
    </>
  );
}

/* ================= Cupones ================= */

interface Coupon { id: number; code: string; description: string; kind: "percent" | "fixed"; value: number; minSubtotal: number; maxUses: number | null; usedCount: number; startsAt: string | null; endsAt: string | null; isActive: boolean }

const toLocalInput = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 16) : "");

export function AdminCoupons() {
  useDocumentTitle("Cupones");
  const toast = useToast();
  const list = useQuery(() => api.get<{ items: Coupon[] }>("/api/admin/coupons"));
  const [editing, setEditing] = useState<Coupon | "new" | null>(null);
  const [deleting, setDeleting] = useState<Coupon | null>(null);
  const blank = { code: "", description: "", kind: "percent" as const, value: 10, minSubtotal: 0, maxUses: null, startsAt: null, endsAt: null, isActive: true };
  const form = useForm(couponInputSchema, blank);
  const v = form.values;
  const open = (c: Coupon | "new") => {
    setEditing(c);
    form.setErrors({});
    form.setFormError(null);
    form.setValues(c === "new" ? blank : { code: c.code, description: c.description, kind: c.kind, value: c.value, minSubtotal: c.minSubtotal, maxUses: c.maxUses, startsAt: c.startsAt, endsAt: c.endsAt, isActive: c.isActive });
  };
  const save = form.submit(async (d) => {
    if (editing === "new") await api.post("/api/admin/coupons", d);
    else if (editing) await api.put(`/api/admin/coupons/${editing.id}`, d);
    toast("success", "Cupón guardado.");
    setEditing(null);
    await list.reload();
  });
  const n = (s: string) => (s === "" ? 0 : Number(s.replace(/\D/g, "")));

  return (
    <>
      <div className="dash-head">
        <div><h1 className="dash-title">Cupones</h1><p className="eyebrow">Descuentos aplicables en el carrito.</p></div>
        <button className="btn btn-primary btn-sm" onClick={() => open("new")}><Icon name="plus" /> Nuevo cupón</button>
      </div>
      <div className="panel" style={{ padding: 8 }}>
        {list.error ? <ErrorState message={list.error.message} onRetry={list.reload} /> : list.loading ? <Skeleton h={200} /> : !list.data?.items.length ? <Empty icon="ticket" title="No hay cupones" /> : (
          <div className="table-wrap">
            <table className="table responsive">
              <thead><tr><th>Código</th><th>Descuento</th><th>Mínimo</th><th>Usos</th><th>Vigencia</th><th>Estado</th><th /></tr></thead>
              <tbody>
                {list.data.items.map((c) => (
                  <tr key={c.id}>
                    <td><strong className="num">{c.code}</strong><div className="faint" style={{ fontSize: 12 }}>{c.description}</div></td>
                    <td className="num t-strong">{c.kind === "percent" ? `${c.value}%` : formatCOP(c.value)}</td>
                    <td className="num">{c.minSubtotal ? formatCOP(c.minSubtotal) : "—"}</td>
                    <td className="num">{c.usedCount}{c.maxUses ? ` / ${c.maxUses}` : ""}</td>
                    <td className="muted" style={{ fontSize: 12 }}>{c.startsAt ? formatDate(c.startsAt) : "Desde ya"} → {c.endsAt ? formatDate(c.endsAt) : "Sin fin"}</td>
                    <td><span className={`status ${c.isActive ? "status-completed" : "status-neutral"}`}>{c.isActive ? "Activo" : "Inactivo"}</span></td>
                    <td className="t-right"><div className="row-actions">
                      <button className="icon-btn" onClick={() => open(c)} aria-label={`Editar ${c.code}`}><Icon name="pencil" /></button>
                      <button className="icon-btn btn-danger" onClick={() => setDeleting(c)} aria-label={`Eliminar ${c.code}`}><Icon name="trash" /></button>
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Modal open={editing !== null} title={editing === "new" ? "Nuevo cupón" : "Editar cupón"} onClose={() => setEditing(null)}
        footer={<><button className="btn btn-ghost" onClick={() => setEditing(null)}>Cancelar</button><button className="btn btn-primary" onClick={() => void save()} disabled={form.submitting}>{form.submitting && <Spinner />} Guardar</button></>}>
        <form className="form" onSubmit={save} noValidate>
          {form.formError && <Alert kind="error">{form.formError}</Alert>}
          <div className="form-row">
            <TextField label="Código" value={v.code} error={form.errors.code} onValue={(val) => form.set("code", val.toUpperCase())} />
            <SelectField label="Tipo" value={v.kind} onValue={(val) => form.set("kind", val as "percent")} options={[{ value: "percent", label: "Porcentaje" }, { value: "fixed", label: "Valor fijo (COP)" }]} />
            <TextField label={v.kind === "percent" ? "Porcentaje" : "Valor (COP)"} inputMode="numeric" value={v.value} error={form.errors.value} onValue={(val) => form.set("value", n(val))} />
          </div>
          <TextField label="Descripción" value={v.description ?? ""} onValue={(val) => form.set("description", val)} maxLength={160} />
          <div className="form-row">
            <TextField label="Compra mínima (COP)" inputMode="numeric" value={v.minSubtotal ?? 0} onValue={(val) => form.set("minSubtotal", n(val))} />
            <TextField label="Usos máximos (vacío = ilimitado)" inputMode="numeric" value={v.maxUses ?? ""} onValue={(val) => form.set("maxUses", val === "" ? null : n(val))} />
          </div>
          <div className="form-row">
            <TextField label="Inicio (UTC, opcional)" type="datetime-local" value={toLocalInput(v.startsAt ?? null)} onValue={(val) => form.set("startsAt", val ? new Date(`${val}Z`).toISOString() : null)} />
            <TextField label="Fin (UTC, opcional)" type="datetime-local" value={toLocalInput(v.endsAt ?? null)} onValue={(val) => form.set("endsAt", val ? new Date(`${val}Z`).toISOString() : null)} />
          </div>
          <Check checked={Boolean(v.isActive)} onChange={(val) => form.set("isActive", val)}>Cupón activo</Check>
        </form>
      </Modal>
      <ConfirmModal open={deleting !== null} title="Eliminar cupón" text={`¿Eliminar el cupón ${deleting?.code}? Los pedidos que ya lo usaron no se modifican.`} confirmLabel="Eliminar" danger onClose={() => setDeleting(null)}
        onConfirm={async () => {
          try {
            await api.del(`/api/admin/coupons/${deleting!.id}`);
            toast("success", "Cupón eliminado.");
            void list.reload();
          } catch (e) {
            toast("error", e instanceof ApiError ? e.message : "Error");
          }
          setDeleting(null);
        }} />
    </>
  );
}

/* ================= Contenido (blog) ================= */

interface Post { id: number; slug: string; title: string; excerpt: string; body: string; isPublished: boolean; publishedAt: string | null; updatedAt: string }

export function AdminContent() {
  useDocumentTitle("Contenido");
  const toast = useToast();
  const list = useQuery(() => api.get<{ items: Post[] }>("/api/admin/posts"));
  const [editing, setEditing] = useState<Post | "new" | null>(null);
  const [deleting, setDeleting] = useState<Post | null>(null);
  const blank = { title: "", slug: "", excerpt: "", body: "", isPublished: false };
  const form = useForm(postInputSchema, blank);
  const v = form.values;
  const open = (p: Post | "new") => {
    setEditing(p);
    form.setErrors({});
    form.setFormError(null);
    form.setValues(p === "new" ? blank : { title: p.title, slug: p.slug, excerpt: p.excerpt, body: p.body, isPublished: p.isPublished });
  };
  const save = form.submit(async (d) => {
    if (editing === "new") await api.post("/api/admin/posts", d);
    else if (editing) await api.put(`/api/admin/posts/${editing.id}`, d);
    toast("success", "Artículo guardado.");
    setEditing(null);
    await list.reload();
  });

  return (
    <>
      <div className="dash-head">
        <div><h1 className="dash-title">Blog / Contenido</h1><p className="eyebrow">Artículos y guías para tus clientes.</p></div>
        <button className="btn btn-primary btn-sm" onClick={() => open("new")}><Icon name="plus" /> Nuevo artículo</button>
      </div>
      <div className="panel" style={{ padding: 8 }}>
        {list.error ? <ErrorState message={list.error.message} onRetry={list.reload} /> : list.loading ? <Skeleton h={200} /> : !list.data?.items.length ? <Empty icon="book" title="Sin artículos" /> : (
          <div className="table-wrap">
            <table className="table responsive">
              <thead><tr><th>Título</th><th>Estado</th><th>Actualizado</th><th /></tr></thead>
              <tbody>
                {list.data.items.map((p) => (
                  <tr key={p.id}>
                    <td><strong>{p.title}</strong><div className="faint" style={{ fontSize: 12 }}>/blog/{p.slug}</div></td>
                    <td><span className={`status ${p.isPublished ? "status-completed" : "status-neutral"}`}>{p.isPublished ? "Publicado" : "Borrador"}</span></td>
                    <td className="muted">{formatDate(p.updatedAt)}</td>
                    <td className="t-right"><div className="row-actions">
                      {p.isPublished && <Link className="icon-btn" to={`/blog/${p.slug}`} target="_blank" aria-label="Ver"><Icon name="eye" /></Link>}
                      <button className="icon-btn" onClick={() => open(p)} aria-label={`Editar ${p.title}`}><Icon name="pencil" /></button>
                      <button className="icon-btn btn-danger" onClick={() => setDeleting(p)} aria-label={`Eliminar ${p.title}`}><Icon name="trash" /></button>
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Modal wide open={editing !== null} title={editing === "new" ? "Nuevo artículo" : "Editar artículo"} onClose={() => setEditing(null)}
        footer={<><button className="btn btn-ghost" onClick={() => setEditing(null)}>Cancelar</button><button className="btn btn-primary" onClick={() => void save()} disabled={form.submitting}>{form.submitting && <Spinner />} Guardar</button></>}>
        <form className="form" onSubmit={save} noValidate>
          {form.formError && <Alert kind="error">{form.formError}</Alert>}
          <div className="form-row">
            <TextField label="Título" value={v.title} error={form.errors.title} onValue={(val) => { form.set("title", val); if (editing === "new") form.set("slug", slugify(val)); }} />
            <TextField label="Slug" value={v.slug} error={form.errors.slug} onValue={(val) => form.set("slug", val)} />
          </div>
          <TextField label="Resumen" value={v.excerpt ?? ""} onValue={(val) => form.set("excerpt", val)} maxLength={300} />
          <TextArea label="Contenido (texto plano; usa líneas en blanco para separar párrafos)" value={v.body} error={form.errors.body} onValue={(val) => form.set("body", val)} rows={12} />
          <Check checked={Boolean(v.isPublished)} onChange={(val) => form.set("isPublished", val)}>Publicado</Check>
        </form>
      </Modal>
      <ConfirmModal open={deleting !== null} title="Eliminar artículo" text={`¿Eliminar «${deleting?.title}»?`} confirmLabel="Eliminar" danger onClose={() => setDeleting(null)}
        onConfirm={async () => {
          try {
            await api.del(`/api/admin/posts/${deleting!.id}`);
            toast("success", "Artículo eliminado.");
            void list.reload();
          } catch (e) {
            toast("error", e instanceof ApiError ? e.message : "Error");
          }
          setDeleting(null);
        }} />
    </>
  );
}

/* ================= Reportes ================= */

interface Report {
  totals: { orders: number; revenue: number; discounts: number; avgTicket: number };
  byCategory: { name: string; units: number; revenue: number }[];
  byProvider: { provider: string; orders: number; revenue: number }[];
  topProducts: { name: string; units: number; revenue: number }[];
}

export function AdminReports() {
  useDocumentTitle("Reportes");
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const r = useQuery(() => api.get<Report>(`/api/admin/reports${qs({ from, to })}`), [from, to]);
  const maxCat = Math.max(1, ...(r.data?.byCategory.map((c) => c.revenue) ?? [1]));

  return (
    <>
      <div className="dash-head">
        <div><h1 className="dash-title">Reportes</h1><p className="eyebrow">Ventas confirmadas (pagadas) en el periodo.</p></div>
        <a className="btn btn-outline btn-sm" href={`/api/admin/reports/orders.csv${qs({ from, to })}`}><Icon name="download" /> Exportar CSV</a>
      </div>
      <div className="toolbar" style={{ justifyContent: "flex-start" }}>
        <label className="label" htmlFor="from">Desde</label>
        <input id="from" className="input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} style={{ width: "auto", height: 40 }} />
        <label className="label" htmlFor="to">Hasta</label>
        <input id="to" className="input" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} style={{ width: "auto", height: 40 }} />
      </div>
      {r.error ? <ErrorState message={r.error.message} onRetry={r.reload} /> : !r.data ? <Skeleton h={300} /> : (
        <>
          <div className="stats">
            <div className="stat"><span className="stat-icon"><Icon name="wallet" /></span><div><strong className="num">{formatCOP(r.data.totals.revenue)}</strong><span>Ingresos</span></div></div>
            <div className="stat"><span className="stat-icon" style={{ ["--hue" as string]: "var(--info)" }}><Icon name="package" /></span><div><strong>{r.data.totals.orders}</strong><span>Pedidos pagados</span></div></div>
            <div className="stat"><span className="stat-icon" style={{ ["--hue" as string]: "var(--success)" }}><Icon name="receipt" /></span><div><strong className="num">{formatCOP(r.data.totals.avgTicket)}</strong><span>Ticket promedio</span></div></div>
            <div className="stat"><span className="stat-icon" style={{ ["--hue" as string]: "var(--warning)" }}><Icon name="percent" /></span><div><strong className="num">{formatCOP(r.data.totals.discounts)}</strong><span>Descuentos</span></div></div>
          </div>
          <div className="split">
            <div className="panel">
              <div className="panel-head"><h3>Ventas por categoría</h3></div>
              {!r.data.byCategory.length ? <p className="muted" style={{ fontSize: 14 }}>Sin ventas en el periodo.</p> : (
                <div className="bars">
                  {r.data.byCategory.map((c) => (
                    <div key={c.name} className="bar-row"><span>{c.name}</span><span className="num faint">{formatCOP(c.revenue)}</span><div className="bar-track"><div className="bar-fill" style={{ width: `${(c.revenue / maxCat) * 100}%` }} /></div></div>
                  ))}
                </div>
              )}
            </div>
            <div className="panel">
              <div className="panel-head"><h3>Por método de pago</h3></div>
              {!r.data.byProvider.length ? <p className="muted" style={{ fontSize: 14 }}>Sin ventas en el periodo.</p> : (
                <ul style={{ display: "grid", gap: 10 }}>
                  {r.data.byProvider.map((p) => <li key={p.provider} style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}><span>{PROVIDER_LABEL[p.provider] ?? p.provider} · {p.orders}</span><strong className="num">{formatCOP(p.revenue)}</strong></li>)}
                </ul>
              )}
            </div>
          </div>
          <div className="panel" style={{ marginTop: 20 }}>
            <div className="panel-head"><h3>Productos más vendidos</h3></div>
            {!r.data.topProducts.length ? <p className="muted" style={{ fontSize: 14 }}>Sin ventas en el periodo.</p> : (
              <table className="table responsive">
                <thead><tr><th>Producto</th><th>Unidades</th><th className="t-right">Ingresos</th></tr></thead>
                <tbody>{r.data.topProducts.map((p) => <tr key={p.name}><td>{p.name}</td><td className="num">{p.units}</td><td className="t-right num t-strong">{formatCOP(p.revenue)}</td></tr>)}</tbody>
              </table>
            )}
          </div>
        </>
      )}
    </>
  );
}

/* ================= Configuración ================= */

export function AdminSettings() {
  useDocumentTitle("Configuración");
  const toast = useToast();
  const s = useQuery(() =>
    api.get<{
      campaign: Record<string, unknown>;
      store: Record<string, unknown>;
      crypto: { copPerUnit: number | null };
      paymentMethods: PaymentMethodInfo[];
      manualAccounts: { id: string; kind: string; label: string; holder: string; number: string; qrImage: string; instructions: string; enabled: boolean }[];
      paymentDisplay: Record<string, { logo: string; label: string }>;
      theme: ThemeSettings;
    }>("/api/admin/settings"),
  );
  const [rate, setRate] = useState("");
  const zenoCurrency = s.data?.paymentMethods.find((m) => m.id === "zenobank")?.currency ?? "USD";
  const [savingRate, setSavingRate] = useState(false);
  useEffect(() => {
    if (s.data) setRate(s.data.crypto.copPerUnit ? String(s.data.crypto.copPerUnit) : "");
  }, [s.data]);
  const campaign = useForm(campaignSchema, { enabled: true, titleLead: "", titleAccent: "", subtitle: "", ctaLabel: "", ctaHref: "/promociones", sealTop: "", sealValue: "", sealBottom: "", promoTitle: "", promoText: "", snow: true, heroImage: "", authImage: "", promoImage: "", heroProducts: true });
  const store = useForm(storeSettingsSchema, { storeName: "", supportEmail: "", supportWhatsapp: "", manualPaymentInstructions: "", legalName: "", legalId: "", legalAddress: "", legalCity: "" });
  useEffect(() => {
    if (s.data) {
      campaign.setValues({ heroImage: "", authImage: "", promoImage: "", heroProducts: true, ...s.data.campaign } as never);
      store.setValues({ legalName: "", legalId: "", legalAddress: "", legalCity: "", ...s.data.store } as never);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.data]);
  const c = campaign.values;
  const st = store.values;

  if (s.error) return <ErrorState message={s.error.message} onRetry={s.reload} />;
  if (!s.data) return <Skeleton h={400} />;

  return (
    <>
      <div className="dash-head"><div><h1 className="dash-title">Configuración</h1><p className="eyebrow">Pagos, correo, tienda y campaña: todo se ajusta aquí.</p></div></div>
      <ThemeSettingsPanel initial={s.data.theme} onSaved={() => undefined} />
      <IntegrationsSettings methods={s.data.paymentMethods} onSaved={() => void s.reload()} />
      <ManualAccountsSettings initial={s.data.manualAccounts ?? []} onSaved={() => void s.reload()} />
      <PaymentDisplaySettings methods={s.data.paymentMethods} initial={s.data.paymentDisplay ?? {}} onSaved={() => void s.reload()} />
      <div className="panel">
        <div className="panel-head"><h3>Criptomonedas (Zenobank)</h3></div>
        <p className="muted" style={{ fontSize: 14, marginBottom: 12 }}>
          Zenobank cotiza en {zenoCurrency}: cada pedido o recarga se convierte con esta tasa y la cotización queda guardada. El cliente paga el equivalente con USDT, USDC, BTC u otras criptomonedas. Actualízala cuando quieras; lo ya creado conserva su cotización.
        </p>
        <div className="form-row" style={{ alignItems: "end" }}>
          <TextField label={`Pesos colombianos por 1 ${zenoCurrency}`} inputMode="decimal" value={rate} onValue={(v) => setRate(v.replace(/[^\d.]/g, ""))} placeholder="Ej.: 4100" hint="Vacío = cripto deshabilitado." />
          <div>
            <button className="btn btn-primary" disabled={savingRate} onClick={async () => {
              setSavingRate(true);
              try {
                await api.put("/api/admin/settings/crypto", { copPerUnit: rate ? Number(rate) : null });
                toast("success", "Tasa guardada.");
                void s.reload();
              } catch (e) {
                toast("error", e instanceof ApiError ? e.message : "Error");
              } finally {
                setSavingRate(false);
              }
            }}>{savingRate && <Spinner />} Guardar tasa</button>
          </div>
        </div>
      </div>
      <div className="panel">
        <div className="panel-head"><h3>Campaña de temporada (inicio)</h3></div>
        <form className="form" noValidate onSubmit={campaign.submit(async (d) => { await api.put("/api/admin/settings/campaign", d); toast("success", "Campaña guardada. Recarga la tienda para verla."); })}>
          {campaign.formError && <Alert kind="error">{campaign.formError}</Alert>}
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            <Check checked={c.enabled} onChange={(v) => campaign.set("enabled", v)}>Campaña activa</Check>
            <Check checked={c.snow} onChange={(v) => campaign.set("snow", v)}>Efecto de nieve</Check>
          </div>
          <div className="form-row">
            <TextField label="Titular (parte 1)" value={c.titleLead} error={campaign.errors.titleLead} onValue={(v) => campaign.set("titleLead", v)} maxLength={80} />
            <TextField label="Titular (parte en rojo)" value={c.titleAccent} error={campaign.errors.titleAccent} onValue={(v) => campaign.set("titleAccent", v)} maxLength={60} />
          </div>
          <TextField label="Subtítulo" value={c.subtitle} onValue={(v) => campaign.set("subtitle", v)} maxLength={200} />
          <div className="form-row">
            <TextField label="Texto del botón" value={c.ctaLabel} onValue={(v) => campaign.set("ctaLabel", v)} maxLength={40} />
            <TextField label="Enlace del botón" value={c.ctaHref} error={campaign.errors.ctaHref} onValue={(v) => campaign.set("ctaHref", v)} />
          </div>
          <div className="form-row">
            <TextField label="Sello: arriba" value={c.sealTop} onValue={(v) => campaign.set("sealTop", v)} maxLength={20} />
            <TextField label="Sello: valor" value={c.sealValue} onValue={(v) => campaign.set("sealValue", v)} maxLength={8} />
            <TextField label="Sello: abajo" value={c.sealBottom} onValue={(v) => campaign.set("sealBottom", v)} maxLength={20} />
          </div>
          <div className="form-row">
            <TextField label="Banner: título" value={c.promoTitle} onValue={(v) => campaign.set("promoTitle", v)} maxLength={80} />
            <TextField label="Banner: texto" value={c.promoText} onValue={(v) => campaign.set("promoText", v)} maxLength={200} />
          </div>
          <div className="form-sep">
            <h4>Imágenes de fondo</h4>
            <p className="hint">Sube tus propias imágenes (por ejemplo, una foto navideña). Si las dejas vacías se usa la ilustración navideña incluida mientras la campaña esté activa. Se reducen y optimizan automáticamente.</p>
          </div>
          <ImageUploader label="Portada (inicio)" max={1} maxSide={2400} aspect="16 / 7" value={c.heroImage ? [c.heroImage] : []} onChange={(u) => campaign.set("heroImage", u[0] ?? "")} hint="Horizontal, ideal 1920 × 840 px. Deja el lado izquierdo despejado: ahí va el texto." />
          <Check checked={c.heroProducts !== false} onChange={(v) => campaign.set("heroProducts", v)}>Mostrar tarjetas de productos sobre la portada</Check>
          <div className="form-row">
            <ImageUploader label="Inicio de sesión y registro" max={1} maxSide={1600} aspect="3 / 4" value={c.authImage ? [c.authImage] : []} onChange={(u) => campaign.set("authImage", u[0] ?? "")} hint="Vertical, ideal 900 × 1200 px." />
            <ImageUploader label="Banner de ofertas" max={1} maxSide={2000} aspect="21 / 9" value={c.promoImage ? [c.promoImage] : []} onChange={(u) => campaign.set("promoImage", u[0] ?? "")} hint="Horizontal, ideal 1600 × 680 px." />
          </div>
          <div><SubmitButton loading={campaign.submitting}>Guardar campaña</SubmitButton></div>
        </form>
      </div>
      <div className="panel">
        <div className="panel-head"><h3>Datos de la tienda</h3></div>
        <form className="form" noValidate onSubmit={store.submit(async (d) => { await api.put("/api/admin/settings/store", d); toast("success", "Datos guardados."); })}>
          {store.formError && <Alert kind="error">{store.formError}</Alert>}
          <div className="form-row">
            <TextField label="Nombre de la tienda" value={st.storeName} error={store.errors.storeName} onValue={(v) => store.set("storeName", v)} />
            <TextField label="Correo de soporte" type="email" value={st.supportEmail} error={store.errors.supportEmail} onValue={(v) => store.set("supportEmail", v)} />
            <TextField label="WhatsApp de soporte" value={st.supportWhatsapp ?? ""} onValue={(v) => store.set("supportWhatsapp", v)} />
          </div>
          <div className="form-sep">
            <h4>Datos legales</h4>
            <p className="hint">Aparecen en <a className="text-accent" href="/terminos" target="_blank" rel="noreferrer">Términos y condiciones</a> y en la <a className="text-accent" href="/privacidad" target="_blank" rel="noreferrer">Política de privacidad</a> como responsable de la tienda y del tratamiento de datos (Ley 1581 de 2012).</p>
          </div>
          <div className="form-row">
            <TextField label="Razón social o nombre del titular" value={st.legalName ?? ""} error={store.errors.legalName} onValue={(v) => store.set("legalName", v)} placeholder="Ej.: Entretenimiento Online S.A.S." />
            <TextField label="NIT o cédula" value={st.legalId ?? ""} error={store.errors.legalId} onValue={(v) => store.set("legalId", v)} placeholder="Ej.: 901.234.567-8" />
          </div>
          <div className="form-row">
            <TextField label="Dirección" value={st.legalAddress ?? ""} error={store.errors.legalAddress} onValue={(v) => store.set("legalAddress", v)} placeholder="Calle 00 # 00-00" />
            <TextField label="Ciudad" value={st.legalCity ?? ""} error={store.errors.legalCity} onValue={(v) => store.set("legalCity", v)} placeholder="Bogotá D.C." />
          </div>
          <TextArea label="Instrucciones de pago por transferencia" value={st.manualPaymentInstructions ?? ""} onValue={(v) => store.set("manualPaymentInstructions", v)} rows={4} maxLength={2000} hint="Incluye número de cuenta / Nequi / Daviplata y a dónde enviar el comprobante." />
          <div><SubmitButton loading={store.submitting}>Guardar</SubmitButton></div>
        </form>
      </div>
    </>
  );
}
