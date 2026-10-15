import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Icon } from "../../components/Icon";
import {
  Alert, Check, ConfirmModal, Empty, ErrorState, Modal, Pagination, ProductArt, Skeleton, Spinner, StatusBadge, Stars, SubmitButton, TextField,
} from "../../components/ui";
import { api, ApiError } from "../../lib/api";
import { formatCOP, formatDate, formatDateTime, ORDER_STATUS_LABEL, PROVIDER_LABEL } from "../../lib/format";
import { useDocumentTitle, useForm, useQuery } from "../../lib/hooks";
import { useSession, useStore, useToast } from "../../lib/state";
import { addressSchema, changePasswordSchema, profileSchema } from "../../../../shared/schemas";
import { ReportIssueModal, ServiceEnds } from "./AccountExtra";
import type { Order } from "../../../../shared/types";

interface OrdersResponse {
  items: Order[];
  total: number;
  page: number;
  pageSize: number;
  counts: { total: number; completed: number; pending: number };
}

function OrdersTable({ orders }: { orders: Order[] }) {
  return (
    <div className="table-wrap">
      <table className="table responsive">
        <thead>
          <tr>
            <th>Pedido</th>
            <th>Fecha</th>
            <th>Estado</th>
            <th className="t-right">Total</th>
            <th className="t-right">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td className="t-strong num">{o.code}</td>
              <td data-label="" className="muted">{formatDate(o.createdAt)}</td>
              <td><StatusBadge status={o.status} /></td>
              <td className="t-right t-strong num">{formatCOP(o.total)}</td>
              <td className="t-right">
                <Link className="btn btn-light btn-sm" to={`/cuenta/pedidos/${o.code}`}>Ver</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AccountOverview() {
  useDocumentTitle("Mi cuenta");
  const { user } = useSession();
  const orders = useQuery(() => api.get<OrdersResponse>("/api/orders?filter=todos"));
  const summary = useQuery(() => api.get<{ wallet: number }>("/api/account/summary"));
  const c = orders.data?.counts;
  return (
    <>
      <div className="dash-head">
        <div>
          <h1 className="dash-title">Hola, {user?.name.split(" ")[0]}</h1>
          <p className="eyebrow">Resumen de tus compras.</p>
        </div>
        <Link className="btn btn-primary btn-sm" to="/productos">
          <Icon name="bag" /> Explorar tienda
        </Link>
      </div>
      <div className="stats">
        <div className="stat"><span className="stat-icon"><Icon name="package" /></span><div><strong>{c?.total ?? "–"}</strong><span>Pedidos totales</span></div></div>
        <div className="stat"><span className="stat-icon" style={{ ["--hue" as string]: "var(--success)" }}><Icon name="check" /></span><div><strong>{c?.completed ?? "–"}</strong><span>Completados</span></div></div>
        <div className="stat"><span className="stat-icon" style={{ ["--hue" as string]: "var(--warning)" }}><Icon name="clock" /></span><div><strong>{c?.pending ?? "–"}</strong><span>En curso</span></div></div>
        <Link to="/cuenta/billetera" className="stat"><span className="stat-icon" style={{ ["--hue" as string]: "var(--info)" }}><Icon name="wallet" /></span><div><strong className="num">{summary.data ? formatCOP(summary.data.wallet) : "–"}</strong><span>Saldo en billetera</span></div></Link>
      </div>
      <div className="panel">
        <div className="panel-head">
          <h3>Pedidos recientes</h3>
          <Link to="/cuenta/pedidos" className="btn btn-ghost btn-sm">Ver todos <Icon name="arrow-right" /></Link>
        </div>
        {orders.error ? (
          <ErrorState message={orders.error.message} onRetry={orders.reload} />
        ) : orders.loading ? (
          <div style={{ display: "grid", gap: 10 }}><Skeleton h={44} /><Skeleton h={44} /><Skeleton h={44} /></div>
        ) : orders.data?.items.length ? (
          <OrdersTable orders={orders.data.items.slice(0, 5)} />
        ) : (
          <Empty icon="package" title="Aún no tienes pedidos" text="Cuando compres, verás aquí el estado de cada pedido." action={<Link className="btn btn-primary" to="/productos">Ir a la tienda</Link>} />
        )}
      </div>
    </>
  );
}

const FILTERS = [
  { id: "todos", label: "Todos" },
  { id: "completados", label: "Completados" },
  { id: "pendientes", label: "Pendientes" },
  { id: "cancelados", label: "Cancelados" },
];

export function OrdersPage() {
  useDocumentTitle("Mis pedidos");
  const [params, setParams] = useSearchParams();
  const filter = params.get("filtro") ?? "todos";
  const page = Number(params.get("pagina") ?? 1) || 1;
  const orders = useQuery(() => api.get<OrdersResponse>(`/api/orders?filter=${filter}&page=${page}`), [filter, page]);

  return (
    <>
      <div className="dash-head">
        <div>
          <h1 className="dash-title">Mis pedidos</h1>
          <p className="eyebrow">Aquí puedes ver el estado de tus compras.</p>
        </div>
      </div>
      <div className="tabs" role="tablist" style={{ marginBottom: 20 }}>
        {FILTERS.map((f) => (
          <button key={f.id} role="tab" className="tab" aria-selected={filter === f.id} onClick={() => setParams({ filtro: f.id })}>
            {f.label}
          </button>
        ))}
      </div>
      {orders.error ? (
        <ErrorState message={orders.error.message} onRetry={orders.reload} />
      ) : orders.loading ? (
        <div className="order-list"><Skeleton h={130} r={12} /><Skeleton h={130} r={12} /></div>
      ) : !orders.data?.items.length ? (
        <Empty icon="package" title="No hay pedidos en esta sección" action={<Link className="btn btn-primary" to="/productos">Ir a la tienda</Link>} />
      ) : (
        <>
          <div className="order-list">
            {orders.data.items.map((o) => (
              <article key={o.id} className="order-card">
                <div className="order-card-head">
                  <div>
                    <strong className="num">#{o.code}</strong>
                    <p className="faint" style={{ fontSize: 13 }}>{formatDateTime(o.createdAt)} · {formatCOP(o.total)}</p>
                  </div>
                  <StatusBadge status={o.status} />
                </div>
                <div className="order-card-body">
                  <ProductArt glyph={o.items[0]?.artGlyph ?? "N"} color={o.items[0]?.artColor ?? "#e3122c"} showName={false} />
                  <div style={{ minWidth: 0 }}>
                    <strong>{o.items[0]?.productName}</strong>
                    <p className="faint" style={{ fontSize: 13 }}>
                      {o.items[0]?.productSummary}
                      {o.items.length > 1 && ` · y ${o.items.length - 1} producto${o.items.length > 2 ? "s" : ""} más`}
                    </p>
                  </div>
                  <Link className="btn btn-soft btn-sm" to={`/cuenta/pedidos/${o.code}`}>Ver detalle</Link>
                </div>
              </article>
            ))}
          </div>
          <Pagination page={page} pageSize={orders.data.pageSize} total={orders.data.total} onPage={(p) => setParams({ filtro: filter, pagina: String(p) })} />
        </>
      )}
    </>
  );
}

const TIMELINE = ["pending_payment", "paid", "processing", "completed"] as const;

function ReviewForm({ productId, onDone }: { productId: number; onDone: () => void }) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
      <div className="stars" role="radiogroup" aria-label="Calificación">
        {[1, 2, 3, 4, 5].map((i) => (
          <button key={i} type="button" role="radio" aria-checked={rating === i} aria-label={`${i} estrellas`} onClick={() => setRating(i)}>
            <Icon name="star" size={20} fill={i <= rating ? "currentColor" : "none"} />
          </button>
        ))}
      </div>
      <textarea className="textarea" rows={2} maxLength={600} placeholder="Cuéntanos tu experiencia (opcional)" value={comment} onChange={(e) => setComment(e.target.value)} />
      <button
        className="btn btn-soft btn-sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api.post(`/api/products/${productId}/reviews`, { rating, comment });
            toast("success", "¡Gracias por tu opinión!");
            onDone();
          } catch (e) {
            toast("error", e instanceof ApiError ? e.message : "No se pudo guardar.");
          } finally {
            setBusy(false);
          }
        }}
      >
        Publicar opinión
      </button>
    </div>
  );
}

export function OrderDetailPage() {
  const { code = "" } = useParams();
  useDocumentTitle(`Pedido ${code}`);
  const toast = useToast();
  const store = useStore();
  const navigate = useNavigate();
  const q = useQuery(() => api.get<{ order: Order; reviewedProductIds: number[] }>(`/api/orders/${encodeURIComponent(code)}`), [code]);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState<number | null>(null);
  const [reporting, setReporting] = useState<{ itemId: number; inventoryItemId?: number; productName: string } | null>(null);

  if (q.error?.status === 404) return <Empty icon="search" title="Pedido no encontrado" action={<Link className="btn btn-primary" to="/cuenta/pedidos">Ver mis pedidos</Link>} />;
  if (q.error) return <ErrorState message={q.error.message} onRetry={q.reload} />;
  if (q.loading || !q.data) return <div style={{ display: "grid", placeItems: "center", minHeight: 300 }}><Spinner /></div>;
  const o = q.data.order;
  const reached = TIMELINE.indexOf(o.status as (typeof TIMELINE)[number]);
  const eventFor = (s: string) => o.events?.find((e) => e.status === s);

  const payAgain = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ action: { type: "redirect"; url: string } | { type: "instructions"; text: string } }>(`/api/orders/${o.code}/pay`);
      if (r.action.type === "redirect") window.location.assign(r.action.url);
      else navigate(`/pedido/${o.code}/confirmacion`);
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "No se pudo iniciar el pago.");
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    try {
      await api.post(`/api/orders/${o.code}/cancel`);
      toast("success", "Pedido cancelado.");
      setConfirmCancel(false);
      await q.reload();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "No se pudo cancelar.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="dash-head">
        <div>
          <Link to="/cuenta/pedidos" className="faint" style={{ fontSize: 13 }}><Icon name="arrow-left" size={14} style={{ display: "inline", verticalAlign: -2 }} /> Mis pedidos</Link>
          <h1 className="dash-title num" style={{ marginTop: 6 }}>Pedido #{o.code}</h1>
          <p className="eyebrow">{formatDateTime(o.createdAt)} · {PROVIDER_LABEL[o.paymentProvider]}</p>
        </div>
        <StatusBadge status={o.status} />
      </div>

      {o.status === "pending_payment" && (
        <div style={{ marginBottom: 20 }}>
          {o.paymentProvider === "manual" ? (
            <Alert kind="info">
              <strong>Pendiente de pago por transferencia.</strong> {store?.store.manualPaymentInstructions} Referencia: <strong className="num">{o.code}</strong>.
            </Alert>
          ) : (
            <Alert kind="warning">Este pedido está esperando la confirmación del pago. Los pedidos sin pagar se cancelan automáticamente a las 48 horas.</Alert>
          )}
          <div style={{ display: "flex", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
            {o.paymentProvider !== "manual" && (
              <button className="btn btn-primary" onClick={payAgain} disabled={busy}>
                {busy && <Spinner />} Pagar ahora
              </button>
            )}
            <button className="btn btn-outline" onClick={() => setConfirmCancel(true)}>Cancelar pedido</button>
          </div>
        </div>
      )}

      <div className="split">
        <div className="panel">
          <div className="panel-head"><h3>Productos</h3></div>
          {o.items.map((it) => (
            <div key={it.id} className="line-item" style={{ gridTemplateColumns: "56px minmax(0,1fr) auto" }}>
              <ProductArt glyph={it.artGlyph} color={it.artColor ?? "#e3122c"} showName={false} />
              <div style={{ minWidth: 0 }}>
                {it.productSlug ? <Link to={`/producto/${it.productSlug}`} style={{ fontWeight: 700 }}>{it.productName}</Link> : <strong>{it.productName}</strong>}
                <p className="pcard-meta">{it.productSummary} · {it.quantity} × {formatCOP(it.unitPrice)}</p>
                {it.deliveryContent && (
                  <div style={{ marginTop: 10 }}>
                    <p className="label" style={{ marginBottom: 6 }}>Datos de entrega</p>
                    <div className="delivery-box">{it.deliveryContent}</div>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => { void navigator.clipboard?.writeText(it.deliveryContent ?? ""); toast("success", "Copiado al portapapeles."); }}>
                        <Icon name="copy" /> Copiar
                      </button>
                      {o.status === "completed" && (
                        <button className="btn btn-ghost btn-sm" onClick={() => setReporting({ itemId: it.id, productName: it.productName })}>
                          <Icon name="alert" /> Reportar falla
                        </button>
                      )}
                    </div>
                  </div>
                )}
                {it.deliveries.length > 0 && o.status === "completed" && (
                  <div style={{ marginTop: 10 }}>
                    <p className="label">{it.deliveries.filter((d) => d.status === "sold").length > 1 ? "Tus cuentas" : "Tu cuenta"}</p>
                    {it.deliveries.map((d) => (
                      <div key={d.id} className={`delivery-card${d.status === "fallen" ? " is-fallen" : ""}`}>
                        {d.status === "fallen" ? (
                          <span className="faint" style={{ fontSize: 13 }}><Icon name="refresh" size={13} style={{ display: "inline", verticalAlign: -2 }} /> Cuenta anterior dada de baja por falla.</span>
                        ) : (
                          <>
                            <div className="delivery-box">{d.content}</div>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
                              <ServiceEnds iso={d.serviceEndsAt} />
                              <span style={{ display: "flex", gap: 4 }}>
                                <button className="btn btn-ghost btn-sm" onClick={() => { void navigator.clipboard?.writeText(d.content ?? ""); toast("success", "Copiado al portapapeles."); }}>
                                  <Icon name="copy" /> Copiar
                                </button>
                                {d.status === "sold" && (
                                  <button className="btn btn-ghost btn-sm" onClick={() => setReporting({ itemId: it.id, inventoryItemId: d.id, productName: it.productName })}>
                                    <Icon name="alert" /> Reportar falla
                                  </button>
                                )}
                              </span>
                            </div>
                            {d.status === "expired" && <span className="chip-warn" style={{ color: "#ff6b6b" }}>Servicio vencido</span>}
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {o.status === "completed" && it.productId && !q.data!.reviewedProductIds.includes(it.productId) && (
                  reviewing === it.productId ? (
                    <ReviewForm productId={it.productId} onDone={() => { setReviewing(null); void q.reload(); }} />
                  ) : (
                    <button className="btn btn-ghost btn-sm" onClick={() => setReviewing(it.productId)}><Stars value={0} /> Calificar</button>
                  )
                )}
              </div>
              <span className="num t-strong">{formatCOP(it.unitPrice * it.quantity)}</span>
            </div>
          ))}
          <div style={{ marginTop: 16 }}>
            <div className="sum-row"><span>Subtotal</span><span>{formatCOP(o.subtotal)}</span></div>
            {o.discount > 0 && <div className="sum-row discount"><span>Descuento {o.couponCode && `(${o.couponCode})`}</span><span>-{formatCOP(o.discount)}</span></div>}
            <div className="sum-total"><span>Total</span><span>{formatCOP(o.total)}</span></div>
          </div>
        </div>
        <div>
          <div className="panel">
            <div className="panel-head"><h3>Seguimiento</h3></div>
            {["cancelled", "refunded"].includes(o.status) ? (
              <div className="timeline">
                {o.events?.map((e, i) => (
                  <div key={i} className="tl-item is-on">
                    <span className="tl-dot"><Icon name={e.status === "cancelled" || e.status === "refunded" ? "x" : "check"} /></span>
                    <div><strong>{ORDER_STATUS_LABEL[e.status as keyof typeof ORDER_STATUS_LABEL] ?? "Actualización"}</strong><span>{e.note} · {formatDateTime(e.createdAt)}</span></div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="timeline">
                {TIMELINE.map((s, i) => {
                  const ev = eventFor(s);
                  return (
                    <div key={s} className={`tl-item${i <= reached ? " is-on" : ""}`}>
                      <span className="tl-dot"><Icon name={i <= reached ? "check" : "clock"} /></span>
                      <div>
                        <strong>{ORDER_STATUS_LABEL[s]}</strong>
                        <span>{ev ? `${ev.note} · ${formatDateTime(ev.createdAt)}` : i <= reached ? "Completado junto con el paso siguiente" : "Pendiente"}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {(() => {
              const extra = (o.events ?? []).filter((e) => !(TIMELINE as readonly string[]).includes(e.status) && !["cancelled", "refunded"].includes(e.status));
              return extra.length ? (
                <div style={{ marginTop: 8, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
                  <p className="label" style={{ marginBottom: 8 }}>Novedades</p>
                  <ul style={{ display: "grid", gap: 8 }}>
                    {extra.map((e, i) => (
                      <li key={i} style={{ fontSize: 13 }}>
                        <span className="muted">{e.note}</span>
                        <span className="faint" style={{ display: "block", fontSize: 11 }}>{formatDateTime(e.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null;
            })()}
          </div>
          <div className="panel">
            <div className="panel-head"><h3>Datos del comprador</h3></div>
            <p style={{ fontSize: 14 }}>{o.buyerName}</p>
            <p className="muted" style={{ fontSize: 14 }}>{o.buyerEmail} · {o.buyerPhone}</p>
            {o.buyerDocument && <p className="muted" style={{ fontSize: 14 }}>Documento: {o.buyerDocument}</p>}
            <Link className="btn btn-outline btn-sm" style={{ marginTop: 16 }} to={`/cuenta/soporte?pedido=${o.code}`}><Icon name="headphones" /> ¿Necesitas ayuda con este pedido?</Link>
          </div>
        </div>
      </div>
      {reporting && (
        <ReportIssueModal open onClose={() => setReporting(null)} orderCode={o.code} orderItemId={reporting.itemId} inventoryItemId={reporting.inventoryItemId} productName={reporting.productName} />
      )}
      <ConfirmModal open={confirmCancel} title="Cancelar pedido" text="El pedido se cancelará y los productos volverán a estar disponibles. Si ya realizaste un pago, contacta a soporte en lugar de cancelar." confirmLabel="Sí, cancelar" danger busy={busy} onConfirm={cancel} onClose={() => setConfirmCancel(false)} />
    </>
  );
}

export function ProfilePage() {
  useDocumentTitle("Mis datos");
  const { user, refresh } = useSession();
  const toast = useToast();
  const profile = useForm(profileSchema, { name: user?.name ?? "", phone: user?.phone ?? "", documentId: user?.documentId ?? "" });
  const pw = useForm(changePasswordSchema, { currentPassword: "", password: "", confirmPassword: "" });

  return (
    <>
      <div className="dash-head"><div><h1 className="dash-title">Mis datos</h1><p className="eyebrow">Se usan para agilizar tus compras.</p></div></div>
      <div className="panel">
        <form
          className="form"
          noValidate
          onSubmit={profile.submit(async (d) => {
            await api.patch("/api/account/profile", d);
            await refresh();
            toast("success", "Datos actualizados.");
          })}
        >
          {profile.formError && <Alert kind="error">{profile.formError}</Alert>}
          <div className="form-row">
            <TextField label="Nombre completo" value={profile.values.name} onValue={(v) => profile.set("name", v)} error={profile.errors.name} autoComplete="name" />
            <TextField label="Correo electrónico" value={user?.email ?? ""} onValue={() => undefined} disabled hint="Para cambiar tu correo escribe a soporte." />
          </div>
          <div className="form-row">
            <TextField label="Celular" type="tel" value={profile.values.phone ?? ""} onValue={(v) => profile.set("phone", v)} error={profile.errors.phone} autoComplete="tel" />
            <TextField label="Documento" value={profile.values.documentId ?? ""} onValue={(v) => profile.set("documentId", v)} error={profile.errors.documentId} />
          </div>
          <div><SubmitButton loading={profile.submitting}>Guardar cambios</SubmitButton></div>
        </form>
      </div>
      <div className="panel">
        <div className="panel-head"><h3>Cambiar contraseña</h3></div>
        <form
          className="form"
          noValidate
          onSubmit={pw.submit(async (d) => {
            await api.post("/api/account/password", d);
            pw.setValues({ currentPassword: "", password: "", confirmPassword: "" });
            toast("success", "Contraseña actualizada. Cerramos tus otras sesiones.");
          })}
        >
          {pw.formError && <Alert kind="error">{pw.formError}</Alert>}
          <TextField label="Contraseña actual" type="password" autoComplete="current-password" value={pw.values.currentPassword} onValue={(v) => pw.set("currentPassword", v)} error={pw.errors.currentPassword} hint="Si te registraste con Google y no tienes contraseña, escribe cualquier texto." />
          <div className="form-row">
            <TextField label="Nueva contraseña" type="password" autoComplete="new-password" value={pw.values.password} onValue={(v) => pw.set("password", v)} error={pw.errors.password} />
            <TextField label="Confirmar contraseña" type="password" autoComplete="new-password" value={pw.values.confirmPassword} onValue={(v) => pw.set("confirmPassword", v)} error={pw.errors.confirmPassword} />
          </div>
          <div><SubmitButton loading={pw.submitting}>Actualizar contraseña</SubmitButton></div>
        </form>
      </div>
    </>
  );
}

interface Address { id: number; label: string; line1: string; city: string; region: string; phone: string; isDefault: boolean }

export function AddressesPage() {
  useDocumentTitle("Direcciones");
  const toast = useToast();
  const list = useQuery(() => api.get<{ items: Address[] }>("/api/account/addresses"));
  const [editing, setEditing] = useState<Address | "new" | null>(null);
  const [deleting, setDeleting] = useState<Address | null>(null);
  const form = useForm(addressSchema, { label: "", line1: "", city: "", region: "", phone: "", isDefault: false });

  const open = (a: Address | "new") => {
    setEditing(a);
    form.setErrors({});
    form.setFormError(null);
    form.setValues(a === "new" ? { label: "", line1: "", city: "", region: "", phone: "", isDefault: false } : { label: a.label, line1: a.line1, city: a.city, region: a.region, phone: a.phone, isDefault: a.isDefault });
  };
  const save = form.submit(async (d) => {
    if (editing === "new") await api.post("/api/account/addresses", d);
    else if (editing) await api.put(`/api/account/addresses/${editing.id}`, d);
    toast("success", "Dirección guardada.");
    setEditing(null);
    await list.reload();
  });

  return (
    <>
      <div className="dash-head">
        <div><h1 className="dash-title">Direcciones</h1><p className="eyebrow">Direcciones de facturación para tus compras.</p></div>
        <button className="btn btn-primary btn-sm" onClick={() => open("new")}><Icon name="plus" /> Agregar</button>
      </div>
      {list.error ? <ErrorState message={list.error.message} onRetry={list.reload} /> : list.loading ? <Skeleton h={120} r={12} /> : !list.data?.items.length ? (
        <Empty icon="pin" title="No tienes direcciones guardadas" action={<button className="btn btn-primary" onClick={() => open("new")}>Agregar dirección</button>} />
      ) : (
        <div className="order-list">
          {list.data.items.map((a) => (
            <div key={a.id} className="order-card">
              <div className="order-card-head">
                <strong>{a.label} {a.isDefault && <span className="status status-neutral" style={{ marginLeft: 8 }}>Principal</span>}</strong>
                <div className="row-actions">
                  <button className="icon-btn" onClick={() => open(a)} aria-label={`Editar ${a.label}`}><Icon name="pencil" /></button>
                  <button className="icon-btn btn-danger" onClick={() => setDeleting(a)} aria-label={`Eliminar ${a.label}`}><Icon name="trash" /></button>
                </div>
              </div>
              <p className="muted" style={{ fontSize: 14 }}>{a.line1}, {a.city}, {a.region}{a.phone && ` · ${a.phone}`}</p>
            </div>
          ))}
        </div>
      )}
      <Modal
        open={editing !== null}
        title={editing === "new" ? "Nueva dirección" : "Editar dirección"}
        onClose={() => setEditing(null)}
        footer={<><button className="btn btn-ghost" onClick={() => setEditing(null)}>Cancelar</button><button className="btn btn-primary" onClick={() => void save()} disabled={form.submitting}>{form.submitting && <Spinner />} Guardar</button></>}
      >
        <form className="form" onSubmit={save} noValidate>
          {form.formError && <Alert kind="error">{form.formError}</Alert>}
          <TextField label="Nombre (ej. Casa, Oficina)" value={form.values.label} onValue={(v) => form.set("label", v)} error={form.errors.label} />
          <TextField label="Dirección" value={form.values.line1} onValue={(v) => form.set("line1", v)} error={form.errors.line1} autoComplete="street-address" />
          <div className="form-row">
            <TextField label="Ciudad" value={form.values.city} onValue={(v) => form.set("city", v)} error={form.errors.city} />
            <TextField label="Departamento" value={form.values.region} onValue={(v) => form.set("region", v)} error={form.errors.region} />
          </div>
          <TextField label="Teléfono (opcional)" type="tel" value={form.values.phone ?? ""} onValue={(v) => form.set("phone", v)} error={form.errors.phone} />
          <Check checked={Boolean(form.values.isDefault)} onChange={(v) => form.set("isDefault", v)}>Usar como dirección principal</Check>
        </form>
      </Modal>
      <ConfirmModal
        open={deleting !== null}
        title="Eliminar dirección"
        text={`¿Eliminar «${deleting?.label}»?`}
        confirmLabel="Eliminar"
        danger
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          try {
            await api.del(`/api/account/addresses/${deleting!.id}`);
            toast("success", "Dirección eliminada.");
          } catch (e) {
            toast("error", e instanceof ApiError ? e.message : "No se pudo eliminar.");
          }
          setDeleting(null);
          await list.reload();
        }}
      />
    </>
  );
}

export function PaymentMethodsPage() {
  useDocumentTitle("Métodos de pago");
  const store = useStore();
  const { user, refresh } = useSession();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <>
      <div className="dash-head"><div><h1 className="dash-title">Métodos de pago</h1><p className="eyebrow">Elige tu método preferido. Nunca guardamos datos de tarjetas: los pagos se procesan en la pasarela.</p></div></div>
      <div className="pay-options">
        {store?.paymentMethods.map((m) => (
          <div key={m.id} className={`pay-option${m.configured ? "" : " is-disabled"}`} style={{ gridTemplateColumns: "minmax(0,1fr) auto", cursor: "default" }}>
            <span>
              <strong style={{ display: "block" }}>{m.label}</strong>
              <span className="faint" style={{ fontSize: 13 }}>{m.configured ? m.description : m.pendingReason}</span>
            </span>
            {user?.preferredPayment === m.id ? (
              <span className="status status-completed">Preferido</span>
            ) : (
              <button
                className="btn btn-outline btn-sm"
                disabled={!m.configured || busy !== null}
                onClick={async () => {
                  setBusy(m.id);
                  try {
                    await api.put("/api/account/payment-preference", { provider: m.id });
                    await refresh();
                    toast("success", `${m.label} es ahora tu método preferido.`);
                  } catch (e) {
                    toast("error", e instanceof ApiError ? e.message : "Error");
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                {busy === m.id && <Spinner />} Usar por defecto
              </button>
            )}
          </div>
        ))}
        {store?.unavailableMethods.map((m) => (
          <div key={m.id} className="pay-option is-disabled" style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}>
            <span><strong style={{ display: "block" }}>{m.label}</strong><span className="faint" style={{ fontSize: 13 }}>{m.reason}</span></span>
            <span className="status status-neutral">No disponible</span>
          </div>
        ))}
      </div>
    </>
  );
}

export function CouponsPage() {
  useDocumentTitle("Cupones");
  const toast = useToast();
  const list = useQuery(() => api.get<{ items: { code: string; description: string; kind: string; value: number; minSubtotal: number; endsAt: string | null }[] }>("/api/account/coupons"));
  return (
    <>
      <div className="dash-head"><div><h1 className="dash-title">Cupones</h1><p className="eyebrow">Cupones vigentes para usar en el carrito.</p></div></div>
      {list.error ? <ErrorState message={list.error.message} onRetry={list.reload} /> : list.loading ? <Skeleton h={100} r={12} /> : !list.data?.items.length ? (
        <Empty icon="ticket" title="No hay cupones disponibles" text="Te avisaremos cuando haya nuevas promociones." />
      ) : (
        <div className="stats" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
          {list.data.items.map((c) => (
            <div key={c.code} className="panel" style={{ borderStyle: "dashed", borderColor: "var(--accent-line)" }}>
              <strong className="price num" style={{ fontSize: 26 }}>{c.kind === "percent" ? `${c.value}%` : formatCOP(c.value)}</strong>
              <p className="muted" style={{ fontSize: 14, margin: "6px 0 12px" }}>{c.description}</p>
              {c.minSubtotal > 0 && <p className="hint">Compra mínima {formatCOP(c.minSubtotal)}</p>}
              {c.endsAt && <p className="hint">Vence el {formatDate(c.endsAt)}</p>}
              <button className="btn btn-soft btn-sm" style={{ marginTop: 12 }} onClick={() => { void navigator.clipboard?.writeText(c.code); toast("success", `Cupón ${c.code} copiado.`); }}>
                <Icon name="copy" /> {c.code}
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
