import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Icon } from "../../components/Icon";
import { Alert, ConfirmModal, Empty, ErrorState, Modal, Pagination, ProductArt, SelectField, Skeleton, Spinner, TextArea, TextField, Check } from "../../components/ui";
import { api, ApiError, qs } from "../../lib/api";
import { formatCOP, formatDate, formatDateTime, PROVIDER_LABEL } from "../../lib/format";
import { useDebounced, useDocumentTitle, useQuery } from "../../lib/hooks";
import { useToast } from "../../lib/state";
import { Chat, TICKET_STATUS, type TicketDetail } from "../account/AccountExtra";
import { INVENTORY_STATUS_LABEL, type InventoryStatus } from "../../../../shared/constants";

/* ================= Inventario de cuentas ================= */

interface InvSummary {
  productId: number;
  name: string;
  slug: string;
  artGlyph: string;
  artColor: string;
  lowStockThreshold: number;
  available: number;
  reserved: number;
  sold: number;
  fallen: number;
  expired: number;
  expiring: number;
}

interface InvItem {
  id: number;
  label: string;
  status: InventoryStatus;
  productId: number;
  productName: string;
  expiresAt: string | null;
  soldAt: string | null;
  serviceEndsAt: string | null;
  notes: string;
  customer: { name: string; email: string } | null;
  orderCode: string | null;
}

const FILTERS = [
  { id: "", label: "Todas" },
  { id: "available", label: "Disponibles" },
  { id: "sold", label: "Vendidas" },
  { id: "reserved", label: "Reservadas" },
  { id: "por-vencer", label: "Por vencer (proveedor)" },
  { id: "servicio-por-vencer", label: "Servicio de cliente por vencer" },
  { id: "fallen", label: "Caídas" },
  { id: "expired", label: "Vencidas" },
  { id: "disabled", label: "Deshabilitadas" },
];

const daysTo = (iso: string | null) => (iso ? Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000) : null);

function Expiry({ iso }: { iso: string | null }) {
  const d = daysTo(iso);
  if (d === null) return <span className="faint">Sin fecha</span>;
  if (d < 0) return <span style={{ color: "#ff6b6b" }}>Venció {formatDate(iso)}</span>;
  return <span className={d <= 7 ? "chip-warn" : "muted"}>{formatDate(iso)}{d <= 7 ? ` · ${d} d` : ""}</span>;
}

export function AdminInventory() {
  useDocumentTitle("Inventario de cuentas");
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const product = params.get("producto") ?? "";
  const estado = params.get("estado") ?? "";
  const page = Number(params.get("pagina") ?? 1) || 1;
  const [search, setSearch] = useState("");
  const q = useDebounced(search, 300);
  const summary = useQuery(() => api.get<{ vault: boolean; items: InvSummary[] }>("/api/admin/inventory/summary"));
  const list = useQuery(() => api.get<{ items: InvItem[]; total: number; pageSize: number }>(`/api/admin/inventory${qs({ producto: product, estado, q, page, pageSize: 50 })}`), [product, estado, q, page]);
  const [bulk, setBulk] = useState(false);
  const [editing, setEditing] = useState<InvItem | null>(null);
  const [falling, setFalling] = useState<InvItem | null>(null);
  const [deleting, setDeleting] = useState<InvItem | null>(null);

  const set = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    if (k !== "pagina") n.delete("pagina");
    setParams(n, { replace: true });
  };
  const reloadAll = () => {
    void summary.reload();
    void list.reload();
  };

  return (
    <>
      <div className="dash-head">
        <div><h1 className="dash-title">Inventario de cuentas</h1><p className="eyebrow">Cuentas disponibles, vendidas, por vencer y caídas. Se entregan automáticamente al confirmarse el pago.</p></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className="btn btn-outline btn-sm"
            onClick={async () => {
              const r = await api.post<{ expiring: number; expired: number; lowStock: number; customerNotices: number }>("/api/admin/alerts/run");
              toast("success", `Revisión hecha: ${r.expiring} por vencer, ${r.expired} vencidas, ${r.lowStock} con poco stock, ${r.customerNotices} avisos a clientes.`);
              reloadAll();
            }}
          >
            <Icon name="bell" /> Revisar alertas ahora
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setBulk(true)} disabled={!summary.data?.vault || !summary.data.items.length}>
            <Icon name="plus" /> Agregar cuentas
          </button>
        </div>
      </div>
      {summary.data && !summary.data.vault && (
        <div style={{ marginBottom: 16 }}>
          <Alert kind="warning">Inventario pendiente de configuración: define <strong>INVENTORY_ENCRYPTION_KEY</strong> en el servidor para guardar credenciales cifradas.</Alert>
        </div>
      )}
      {summary.data && !summary.data.items.length && (
        <Empty icon="key" title="Ningún producto usa entrega automática" text="Edita un producto y elige «Entrega automática desde inventario» para empezar a cargar cuentas." action={<Link className="btn btn-primary" to="/admin/productos">Ir a productos</Link>} />
      )}
      <div className="inv-cards">
        {summary.loading && <Skeleton h={130} r={12} />}
        {summary.data?.items.map((p) => (
          <button key={p.productId} className={`inv-card${p.available <= p.lowStockThreshold ? " is-low" : ""}`} aria-pressed={String(p.productId) === product} onClick={() => set("producto", String(p.productId) === product ? "" : String(p.productId))}>
            <div className="cell-product">
              <ProductArt glyph={p.artGlyph} color={p.artColor} showName={false} />
              <div style={{ minWidth: 0 }}>
                <strong style={{ display: "block" }}>{p.name}</strong>
                {p.available <= p.lowStockThreshold ? <span className="chip-warn">Poco inventario (alerta en {p.lowStockThreshold})</span> : <span className="faint" style={{ fontSize: 12 }}>Alerta en {p.lowStockThreshold}</span>}
              </div>
            </div>
            <div className="inv-counts">
              <div><strong style={{ color: "var(--success)" }}>{p.available}</strong><span>Disponibles</span></div>
              <div><strong style={{ color: "#6aa5ff" }}>{p.sold}</strong><span>Vendidas</span></div>
              <div><strong style={{ color: p.expiring ? "var(--warning)" : undefined }}>{p.expiring}</strong><span>Por vencer</span></div>
              <div><strong style={{ color: p.fallen ? "#ff6b6b" : undefined }}>{p.fallen}</strong><span>Caídas</span></div>
            </div>
          </button>
        ))}
      </div>

      <div className="tabs" role="tablist" aria-label="Filtrar por estado" style={{ marginBottom: 12, flexWrap: "wrap" }}>
        {FILTERS.map((f) => (
          <button key={f.id} role="tab" className="tab" aria-selected={estado === f.id} onClick={() => set("estado", f.id)}>{f.label}</button>
        ))}
      </div>
      <div className="toolbar">
        <div className="input-wrap" style={{ flex: 1, maxWidth: 380 }}>
          <Icon name="search" />
          <input className="input" placeholder="Etiqueta, correo del cliente o pedido…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar cuentas" />
        </div>
        {product && <button className="btn btn-ghost btn-sm" onClick={() => set("producto", "")}><Icon name="x" /> Todos los productos</button>}
      </div>
      <div className="panel" style={{ padding: 8 }}>
        {list.error ? <ErrorState message={list.error.message} onRetry={list.reload} /> : list.loading && !list.data ? <Skeleton h={240} /> : !list.data?.items.length ? (
          <Empty icon="key" title="No hay cuentas con este filtro" />
        ) : (
          <div className="table-wrap">
            <table className="table responsive">
              <thead><tr><th>Cuenta</th><th>Estado</th><th>Vence (proveedor)</th><th>Cliente / pedido</th><th>Servicio hasta</th><th /></tr></thead>
              <tbody>
                {list.data.items.map((it) => (
                  <tr key={it.id}>
                    <td><strong>{it.label || `#${it.id}`}</strong><div className="faint" style={{ fontSize: 12 }}>{it.productName}</div></td>
                    <td><span className={`status status-${it.status}`}>{INVENTORY_STATUS_LABEL[it.status]}</span></td>
                    <td data-label="Vence:"><Expiry iso={it.expiresAt} /></td>
                    <td>{it.customer ? <><span>{it.customer.name}</span><div className="faint" style={{ fontSize: 12 }}>{it.orderCode && <Link className="text-accent" to={`/admin/pedidos/${it.orderCode}`}>{it.orderCode}</Link>}</div></> : <span className="faint">—</span>}</td>
                    <td data-label="Servicio:">{it.serviceEndsAt ? <Expiry iso={it.serviceEndsAt} /> : <span className="faint">—</span>}</td>
                    <td className="t-right">
                      <div className="row-actions">
                        <button className="icon-btn" onClick={() => setEditing(it)} aria-label="Ver / editar"><Icon name="eye" /></button>
                        {["available", "sold", "reserved"].includes(it.status) && (
                          <button className="icon-btn btn-danger" onClick={() => setFalling(it)} aria-label="Marcar caída" title="Marcar caída"><Icon name="alert" /></button>
                        )}
                        {!it.orderCode && <button className="icon-btn btn-danger" onClick={() => setDeleting(it)} aria-label="Eliminar"><Icon name="trash" /></button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {list.data && <Pagination page={page} pageSize={list.data.pageSize} total={list.data.total} onPage={(p) => set("pagina", String(p))} />}

      {bulk && summary.data && <BulkModal products={summary.data.items} defaultProduct={Number(product) || summary.data.items[0]?.productId} onClose={() => setBulk(false)} onDone={() => { setBulk(false); reloadAll(); }} />}
      {editing && <EditItemModal item={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); reloadAll(); }} />}
      {falling && <FallModal item={falling} onClose={() => setFalling(null)} onDone={() => { setFalling(null); reloadAll(); }} />}
      <ConfirmModal open={deleting !== null} title="Eliminar cuenta" text={`¿Eliminar «${deleting?.label}» del inventario?`} confirmLabel="Eliminar" danger onClose={() => setDeleting(null)}
        onConfirm={async () => {
          try {
            await api.del(`/api/admin/inventory/${deleting!.id}`);
            toast("success", "Cuenta eliminada.");
            reloadAll();
          } catch (e) {
            toast("error", e instanceof ApiError ? e.message : "Error");
          }
          setDeleting(null);
        }} />
    </>
  );
}

function BulkModal({ products, defaultProduct, onClose, onDone }: { products: InvSummary[]; defaultProduct?: number; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [productId, setProductId] = useState(defaultProduct ?? 0);
  const [lines, setLines] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const count = lines.split(/\r?\n/).filter((l) => l.trim()).length;
  return (
    <Modal open wide title="Agregar cuentas al inventario" onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={busy || !count || !productId} onClick={async () => {
        setBusy(true);
        setError(null);
        try {
          const r = await api.post<{ created: number }>("/api/admin/inventory/bulk", { productId, lines, expiresAt: expiresAt || null });
          toast("success", `${r.created} cuenta(s) agregada(s). El stock se actualizó.`);
          onDone();
        } catch (e) {
          setError(e instanceof ApiError ? e.message : "Error");
        } finally {
          setBusy(false);
        }
      }}>{busy && <Spinner />} Agregar {count || ""}</button></>}>
      <div className="form">
        {error && <Alert kind="error">{error}</Alert>}
        <div className="form-row">
          <SelectField label="Producto" value={productId} onValue={(v) => setProductId(Number(v))} options={products.map((p) => ({ value: p.productId, label: p.name }))} />
          <TextField label="Vencimiento por defecto (opcional)" type="date" value={expiresAt} onValue={setExpiresAt} hint="Fecha en que vence la cuenta en el proveedor." />
        </div>
        <TextArea
          label="Cuentas (una por línea)"
          value={lines}
          onValue={setLines}
          rows={10}
          hint="Formato: credenciales | etiqueta (opcional) | vencimiento AAAA-MM-DD (opcional). Ej.: correo@x.com:Clave123 | Perfil 2 | 2026-12-31"
        />
        <p className="hint"><Icon name="lock" size={12} style={{ display: "inline", verticalAlign: -1 }} /> Las credenciales se guardan cifradas y solo se muestran al cliente cuando su pedido está completado.</p>
      </div>
    </Modal>
  );
}

function EditItemModal({ item, onClose, onDone }: { item: InvItem; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const detail = useQuery(() => api.get<{ item: { content: string; label: string; expiresAt: string | null; notes: string; status: string } }>(`/api/admin/inventory/${item.id}`), [item.id]);
  const [label, setLabel] = useState(item.label);
  const [content, setContent] = useState("");
  const [expiresAt, setExpiresAt] = useState(item.expiresAt?.slice(0, 10) ?? "");
  const [notes, setNotes] = useState(item.notes);
  const [disabled, setDisabled] = useState(item.status === "disabled");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (detail.data) setContent(detail.data.item.content);
  }, [detail.data]);
  const editableStatus = ["available", "disabled"].includes(item.status);
  return (
    <Modal open title={`Cuenta #${item.id} · ${item.productName}`} onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cerrar</button><button className="btn btn-primary" disabled={busy || !detail.data} onClick={async () => {
        setBusy(true);
        try {
          await api.put(`/api/admin/inventory/${item.id}`, {
            label,
            content: content !== detail.data?.item.content ? content : undefined,
            expiresAt: expiresAt || null,
            notes,
            status: editableStatus ? (disabled ? "disabled" : "available") : undefined,
          });
          toast("success", "Cuenta actualizada.");
          onDone();
        } catch (e) {
          toast("error", e instanceof ApiError ? e.message : "Error");
        } finally {
          setBusy(false);
        }
      }}>{busy && <Spinner />} Guardar</button></>}>
      {detail.loading ? <Skeleton h={200} /> : (
        <div className="form">
          <div className="form-row">
            <TextField label="Etiqueta" value={label} onValue={setLabel} />
            <TextField label="Vence en el proveedor" type="date" value={expiresAt} onValue={setExpiresAt} />
          </div>
          <TextArea label="Credenciales" value={content} onValue={setContent} rows={4} hint={item.status === "sold" ? "Si cambias la clave, el cliente verá los nuevos datos en su pedido." : undefined} />
          <TextArea label="Notas internas" value={notes} onValue={setNotes} rows={2} maxLength={500} />
          {editableStatus && <Check checked={disabled} onChange={setDisabled}>Deshabilitada (no se vende)</Check>}
          {item.customer && <p className="hint">Vendida a {item.customer.name} ({item.customer.email}) · pedido {item.orderCode} · servicio hasta {formatDate(item.serviceEndsAt)}</p>}
        </div>
      )}
    </Modal>
  );
}

function FallModal({ item, onClose, onDone }: { item: InvItem; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [replace, setReplace] = useState(true);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal open title="Marcar cuenta como caída" onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={busy} onClick={async () => {
        setBusy(true);
        try {
          const r = await api.post<{ result: string; ticketId?: number }>(`/api/admin/inventory/${item.id}/fall`, { replace, note });
          toast(
            r.result === "replaced" ? "success" : "info",
            r.result === "replaced" ? "Cuenta reemplazada y cliente notificado." : r.result === "fallen_pending" ? `Sin cuentas para reemplazar: se abrió la solicitud #${r.ticketId} y se avisó al cliente.` : "Cuenta marcada como caída.",
          );
          onDone();
        } catch (e) {
          toast("error", e instanceof ApiError ? e.message : "Error");
        } finally {
          setBusy(false);
        }
      }}>{busy && <Spinner />} Confirmar</button></>}>
      <div className="form">
        <p className="muted">«{item.label}» dejará de venderse y el inventario se actualizará.</p>
        {item.status === "sold" && (
          <>
            <Alert kind="info">Esta cuenta está vendida a {item.customer?.name}. El pedido {item.orderCode} se actualizará y el cliente recibirá una notificación.</Alert>
            <Check checked={replace} onChange={setReplace}>Entregar automáticamente otra cuenta disponible (conserva la fecha de fin del servicio)</Check>
          </>
        )}
        <TextField label="Motivo (interno)" value={note} onValue={setNote} maxLength={300} placeholder="Ej.: el proveedor cambió la clave" />
      </div>
    </Modal>
  );
}

/* ================= Billetera (admin) ================= */

interface Topup { code: string; amount: number; provider: string; status: string; paymentCurrency: string | null; paymentAmountForeign: string | null; createdAt: string; customer?: { id: number; name: string; email: string } }

export function AdminWallet() {
  useDocumentTitle("Billetera");
  const toast = useToast();
  const [status, setStatus] = useState("pending");
  const list = useQuery(() => api.get<{ items: Topup[]; totalBalances: number; usersWithBalance: number }>(`/api/admin/wallet/topups${qs({ status })}`), [status]);
  const [confirming, setConfirming] = useState<Topup | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <div className="dash-head"><div><h1 className="dash-title">Billetera</h1><p className="eyebrow">Recargas de saldo de los clientes. Para ajustar el saldo de un cliente, ve a Clientes.</p></div></div>
      <div className="stats">
        <div className="stat"><span className="stat-icon"><Icon name="wallet" /></span><div><strong className="num">{list.data ? formatCOP(list.data.totalBalances) : "–"}</strong><span>Saldo total de clientes</span></div></div>
        <div className="stat"><span className="stat-icon" style={{ ["--hue" as string]: "var(--info)" }}><Icon name="users" /></span><div><strong>{list.data?.usersWithBalance ?? "–"}</strong><span>Clientes con saldo</span></div></div>
      </div>
      <div className="tabs" style={{ marginBottom: 16 }}>
        {[["pending", "Pendientes"], ["paid", "Acreditadas"], ["cancelled", "Canceladas"], ["", "Todas"]].map(([id, label]) => (
          <button key={id} className="tab" aria-selected={status === id} onClick={() => setStatus(id!)}>{label}</button>
        ))}
      </div>
      <div className="panel" style={{ padding: 8 }}>
        {list.error ? <ErrorState message={list.error.message} onRetry={list.reload} /> : list.loading && !list.data ? <Skeleton h={200} /> : !list.data?.items.length ? <Empty icon="wallet" title="Sin recargas en esta sección" /> : (
          <div className="table-wrap">
            <table className="table responsive">
              <thead><tr><th>Recarga</th><th>Cliente</th><th>Método</th><th className="t-right">Monto</th><th>Estado</th><th /></tr></thead>
              <tbody>
                {list.data.items.map((t) => (
                  <tr key={t.code}>
                    <td><strong className="num">{t.code}</strong><div className="faint" style={{ fontSize: 12 }}>{formatDateTime(t.createdAt)}</div></td>
                    <td>{t.customer?.name}<div className="faint" style={{ fontSize: 12 }}>{t.customer?.email}</div></td>
                    <td className="muted">{PROVIDER_LABEL[t.provider] ?? t.provider}</td>
                    <td className="t-right num t-strong">{formatCOP(t.amount)}{t.paymentAmountForeign && <div className="faint" style={{ fontSize: 12 }}>{t.paymentAmountForeign} {t.paymentCurrency}</div>}</td>
                    <td><span className={`status ${t.status === "paid" ? "status-completed" : t.status === "pending" ? "status-pending_payment" : "status-neutral"}`}>{t.status === "paid" ? "Acreditada" : t.status === "pending" ? "Pendiente" : "Cancelada"}</span></td>
                    <td className="t-right">
                      {t.status === "pending" && t.provider === "manual" && (
                        <div className="row-actions">
                          <button className="btn btn-soft btn-sm" onClick={() => setConfirming(t)}>Confirmar</button>
                          <button className="btn btn-ghost btn-sm" onClick={async () => { await api.post(`/api/admin/wallet/topups/${t.code}/cancel`).catch(() => undefined); void list.reload(); }}>Cancelar</button>
                        </div>
                      )}
                      {t.status === "pending" && t.provider !== "manual" && <span className="faint" style={{ fontSize: 12 }}>Esperando pasarela</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <ConfirmModal open={confirming !== null} title="Confirmar recarga" busy={busy}
        text={`Confirma solo si verificaste que recibiste ${confirming ? formatCOP(confirming.amount) : ""} con la referencia ${confirming?.code}. El saldo se acreditará al cliente de inmediato.`}
        confirmLabel="Acreditar saldo" onClose={() => setConfirming(null)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api.post(`/api/admin/wallet/topups/${confirming!.code}/confirm`);
            toast("success", "Saldo acreditado.");
            void list.reload();
          } catch (e) {
            toast("error", e instanceof ApiError ? e.message : "Error");
          } finally {
            setBusy(false);
            setConfirming(null);
          }
        }} />
    </>
  );
}

export function CustomerWalletModal({ customer, onClose }: { customer: { id: number; name: string }; onClose: () => void }) {
  const toast = useToast();
  const q = useQuery(() => api.get<{ balance: number; transactions: { id: number; kind: string; amount: number; balanceAfter: number; note: string; actor: string; createdAt: string; reference: string | null }[] }>(`/api/admin/customers/${customer.id}/wallet`), [customer.id]);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [sign, setSign] = useState<"+" | "-">("+");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal open wide title={`Billetera de ${customer.name}`} onClose={onClose}>
      {!q.data ? <Skeleton h={200} /> : (
        <div className="form">
          <p>Saldo actual: <strong className="num price" style={{ fontSize: 22 }}>{formatCOP(q.data.balance)}</strong></p>
          <div className="panel" style={{ padding: 16 }}>
            <p className="label" style={{ marginBottom: 8 }}>Ajuste manual</p>
            {error && <Alert kind="error">{error}</Alert>}
            <div className="form-row" style={{ alignItems: "end" }}>
              <SelectField label="Tipo" value={sign} onValue={(v) => setSign(v as "+")} options={[{ value: "+", label: "Acreditar (+)" }, { value: "-", label: "Debitar (−)" }]} />
              <TextField label="Monto (COP)" inputMode="numeric" value={amount} onValue={(v) => setAmount(v.replace(/\D/g, ""))} />
              <TextField label="Motivo (visible al cliente)" value={note} onValue={setNote} maxLength={255} />
            </div>
            <button className="btn btn-primary btn-sm" style={{ marginTop: 12 }} disabled={busy || !Number(amount) || note.trim().length < 3} onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await api.post(`/api/admin/customers/${customer.id}/wallet`, { amount: Number(amount) * (sign === "-" ? -1 : 1), note });
                toast("success", "Saldo ajustado.");
                setAmount("");
                setNote("");
                void q.reload();
              } catch (e) {
                setError(e instanceof ApiError ? e.message : "Error");
              } finally {
                setBusy(false);
              }
            }}>{busy && <Spinner />} Aplicar ajuste</button>
          </div>
          {!q.data.transactions.length ? <p className="muted">Sin movimientos.</p> : (
            <ul className="ledger">
              {q.data.transactions.map((t) => (
                <li key={t.id} className="ledger-row" style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}>
                  <span><strong>{t.note || t.kind}</strong><span className="faint" style={{ display: "block", fontSize: 12 }}>{formatDateTime(t.createdAt)} · {t.actor}{t.reference && ` · ${t.reference}`}</span></span>
                  <span style={{ textAlign: "right" }}><strong className={`num ${t.amount > 0 ? "amount-pos" : ""}`}>{t.amount > 0 ? "+" : "−"}{formatCOP(Math.abs(t.amount))}</strong><span className="faint num" style={{ display: "block", fontSize: 12 }}>{formatCOP(t.balanceAfter)}</span></span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}

/* ================= Soporte (admin) ================= */

interface TicketRow {
  id: number;
  subject: string;
  kind: "general" | "account_issue";
  status: "open" | "answered" | "closed";
  orderCode: string | null;
  resolution: string | null;
  lastMessageAt: string;
  lastMessage: { body: string; authorRole: string } | null;
  customer?: { name: string; email: string };
}

export function AdminTickets() {
  useDocumentTitle("Soporte");
  const [status, setStatus] = useState("open");
  const [kind, setKind] = useState("");
  const list = useQuery(() => api.get<{ items: TicketRow[] }>(`/api/admin/tickets${qs({ status, kind })}`), [status, kind]);
  return (
    <>
      <div className="dash-head"><div><h1 className="dash-title">Soporte</h1><p className="eyebrow">Conversaciones con clientes y reportes de cuentas caídas.</p></div></div>
      <div className="tabs" style={{ marginBottom: 10, flexWrap: "wrap" }}>
        {(["open", "answered", "closed", ""] as const).map((s) => (
          <button key={s || "all"} className="tab" aria-selected={status === s} onClick={() => setStatus(s)}>{s ? TICKET_STATUS[s] : "Todas"}</button>
        ))}
      </div>
      <div className="tabs" style={{ marginBottom: 16 }}>
        <button className="tab" aria-selected={kind === ""} onClick={() => setKind("")}>Todo</button>
        <button className="tab" aria-selected={kind === "account_issue"} onClick={() => setKind("account_issue")}><Icon name="alert" size={14} style={{ display: "inline", verticalAlign: -2 }} /> Cuentas caídas</button>
        <button className="tab" aria-selected={kind === "general"} onClick={() => setKind("general")}>Consultas</button>
      </div>
      {list.error ? <ErrorState message={list.error.message} onRetry={list.reload} /> : list.loading ? <Skeleton h={200} /> : !list.data?.items.length ? <Empty icon="headphones" title="No hay solicitudes aquí" /> : (
        <div className="order-list">
          {list.data.items.map((t) => (
            <Link key={t.id} to={`/admin/soporte/${t.id}`} className="order-card">
              <div className="order-card-head">
                <div>
                  <strong>{t.kind === "account_issue" && <Icon name="alert" size={15} style={{ display: "inline", verticalAlign: -2, marginRight: 6, color: "var(--warning)" }} />}{t.subject}</strong>
                  <p className="faint" style={{ fontSize: 12 }}>#{t.id} · {t.customer?.name} · {t.customer?.email} · {formatDateTime(t.lastMessageAt)}</p>
                </div>
                <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {t.resolution && <span className="status status-completed">{t.resolution === "replaced" ? "Reemplazada" : "Reembolsada"}</span>}
                  <span className={`status status-${t.status}`}>{TICKET_STATUS[t.status]}</span>
                </span>
              </div>
              {t.lastMessage && <p className="muted" style={{ fontSize: 13 }}>{t.lastMessage.authorRole === "admin" ? "Tú: " : ""}{t.lastMessage.body}</p>}
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

export function AdminTicketDetail() {
  const { id = "" } = useParams();
  const toast = useToast();
  const q = useQuery(() => api.get<{ ticket: TicketDetail; suggestedRefund: number | null }>(`/api/admin/tickets/${encodeURIComponent(id)}`), [id]);
  useDocumentTitle(q.data?.ticket.subject ?? "Soporte");
  const [nextStatus, setNextStatus] = useState<"answered" | "closed" | "open">("answered");
  const [refund, setRefund] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    if (q.data?.suggestedRefund !== undefined && q.data?.suggestedRefund !== null) setRefund(String(q.data.suggestedRefund));
  }, [q.data?.suggestedRefund]);
  useEffect(() => {
    const t = setInterval(() => {
      api.get<{ ticket: TicketDetail; suggestedRefund: number | null }>(`/api/admin/tickets/${encodeURIComponent(id)}`).then((r) => q.setData(r)).catch(() => undefined);
    }, 15_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (q.error) return <ErrorState message={q.error.message} onRetry={q.reload} />;
  if (!q.data) return <div style={{ display: "grid", placeItems: "center", minHeight: 300 }}><Spinner /></div>;
  const t = q.data.ticket;

  const resolve = async (action: "replace" | "refund") => {
    setBusy(action);
    try {
      const r = await api.post<{ ticket: TicketDetail }>(`/api/admin/tickets/${t.id}/resolve`, { action, amount: action === "refund" ? Number(refund) : undefined });
      q.setData({ ...q.data!, ticket: r.ticket });
      toast("success", action === "replace" ? "Cuenta reemplazada. El cliente ya ve los nuevos datos." : "Reembolso acreditado a la billetera del cliente.");
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="dash-head">
        <div>
          <Link to="/admin/soporte" className="faint" style={{ fontSize: 13 }}>← Soporte</Link>
          <h1 className="dash-title" style={{ marginTop: 6 }}>{t.subject}</h1>
          <p className="eyebrow">#{t.id} · {t.customer?.name} ({t.customer?.email}){t.orderCode && <> · <Link className="text-accent" to={`/admin/pedidos/${t.orderCode}`}>Pedido {t.orderCode}</Link></>}</p>
        </div>
        <span className={`status status-${t.status}`}>{TICKET_STATUS[t.status]}</span>
      </div>
      <div className="split">
        <div className="panel">
          <Chat
            ticket={t}
            me="admin"
            onSend={async (body) => {
              try {
                const r = await api.post<{ ticket: TicketDetail }>(`/api/admin/tickets/${t.id}/messages`, { body, status: nextStatus });
                q.setData({ ...q.data!, ticket: r.ticket });
              } catch (e) {
                toast("error", e instanceof ApiError ? e.message : "No se pudo enviar.");
                throw e;
              }
            }}
          />
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
            <span className="hint">Al responder, marcar como:</span>
            <select className="select" style={{ width: "auto", height: 34 }} value={nextStatus} onChange={(e) => setNextStatus(e.target.value as "answered")} aria-label="Estado tras responder">
              <option value="answered">Respondida</option>
              <option value="closed">Cerrada</option>
              <option value="open">Abierta</option>
            </select>
            {t.status !== "closed" && (
              <button className="btn btn-ghost btn-sm" onClick={async () => { await api.post(`/api/admin/tickets/${t.id}/status`, { status: "closed" }); void q.reload(); }}>Cerrar sin responder</button>
            )}
          </div>
        </div>
        <div>
          {t.kind === "account_issue" && t.item && (
            <div className="panel">
              <div className="panel-head"><h3>Cuenta reportada</h3></div>
              <p><strong>{t.item.productName}</strong></p>
              {t.item.label && <p className="muted" style={{ fontSize: 14 }}>{t.item.label} · <span className={`status status-${t.item.inventoryStatus}`}>{INVENTORY_STATUS_LABEL[t.item.inventoryStatus as InventoryStatus] ?? "—"}</span></p>}
              {t.item.serviceEndsAt && <p className="hint">Servicio del cliente hasta {formatDate(t.item.serviceEndsAt)}</p>}
              {t.resolution ? (
                <div style={{ marginTop: 12 }}><Alert kind="success">Resuelto: {t.resolution === "replaced" ? "cuenta reemplazada" : "reembolso a la billetera"}.</Alert></div>
              ) : (
                <div className="form" style={{ marginTop: 16, gap: 12 }}>
                  <button className="btn btn-primary btn-block" disabled={busy !== null || !t.item.availableReplacements} onClick={() => resolve("replace")}>
                    {busy === "replace" && <Spinner />} <Icon name="refresh" /> Reemplazar cuenta ({t.item.availableReplacements ?? 0} disponibles)
                  </button>
                  {!t.item.availableReplacements && <p className="hint">No hay cuentas disponibles: <Link className="text-accent" to={`/admin/inventario?producto=${t.item.productId}`}>agrega inventario</Link> o reembolsa.</p>}
                  <div className="divider">o</div>
                  <TextField label="Reembolso a la billetera (COP)" inputMode="numeric" value={refund} onValue={(v) => setRefund(v.replace(/\D/g, ""))} hint={`Sugerido según días restantes. Máximo ${formatCOP(t.item.unitPrice)}.`} />
                  <button className="btn btn-outline btn-block" disabled={busy !== null || !Number(refund)} onClick={() => resolve("refund")}>
                    {busy === "refund" && <Spinner />} <Icon name="wallet" /> Reembolsar {formatCOP(Number(refund) || 0)}
                  </button>
                  <p className="hint">Ambas acciones actualizan el pedido, el inventario y notifican al cliente.</p>
                </div>
              )}
            </div>
          )}
          <div className="panel">
            <div className="panel-head"><h3>Cliente</h3></div>
            <p>{t.customer?.name}</p>
            <p className="muted" style={{ fontSize: 14 }}>{t.customer?.email}</p>
          </div>
        </div>
      </div>
    </>
  );
}
