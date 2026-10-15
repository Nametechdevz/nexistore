import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AreaChart } from "../../components/AreaChart";
import { Icon, ICON_NAMES } from "../../components/Icon";
import {
  Alert, Check, ConfirmModal, Empty, ErrorState, Modal, Pagination, ProductArt, SelectField, Skeleton, Spinner, StatusBadge, TextArea, TextField,
} from "../../components/ui";
import { api, ApiError, qs } from "../../lib/api";
import { formatCOP, formatDate, PROVIDER_LABEL, slugify } from "../../lib/format";
import { useDebounced, useDocumentTitle, useForm, useQuery } from "../../lib/hooks";
import { useToast } from "../../lib/state";
import { categoryInputSchema, productInputSchema } from "../../../../shared/schemas";
import type { Category, Order, PaymentMethodInfo, ProductDetail, ProductSummary } from "../../../../shared/types";

/* ================= Dashboard ================= */

interface Dashboard {
  kpi: Record<string, number>;
  series: { day: string; total: number; orders: number }[];
  recent: Order[];
  top: { name: string; units: number; revenue: number }[];
  paymentMethods: PaymentMethodInfo[];
}

const WEEKDAY = new Intl.DateTimeFormat("es-CO", { weekday: "short", timeZone: "UTC" });
const DAYMONTH = new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", timeZone: "UTC" });

export function AdminDashboard() {
  useDocumentTitle("Dashboard");
  const [range, setRange] = useState<"week" | "month">("week");
  const d = useQuery(() => api.get<Dashboard>(`/api/admin/dashboard?range=${range}`), [range]);
  const k = d.data?.kpi;
  const label = (day: string) => (range === "week" ? WEEKDAY.format(new Date(`${day}T12:00:00Z`)) : DAYMONTH.format(new Date(`${day}T12:00:00Z`)));
  const unconfigured = d.data?.paymentMethods.filter((m) => !m.configured) ?? [];

  if (d.error) return <ErrorState message={d.error.message} onRetry={d.reload} />;
  return (
    <>
      <div className="dash-head">
        <div><h1 className="dash-title">Dashboard</h1><p className="eyebrow">Resumen de la tienda.</p></div>
      </div>
      {unconfigured.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <Alert kind="warning">
            Pasarelas pendientes de configuración: {unconfigured.map((m) => m.label).join(", ")}. <Link className="text-accent" to="/admin/configuracion">Ver detalles</Link>
          </Alert>
        </div>
      )}
      <div className="stats">
        <div className="stat"><span className="stat-icon"><Icon name="box" /></span><div><strong>{k?.products ?? "–"}</strong><span>Productos activos · {k?.available_accounts ?? 0} cuentas disponibles</span></div></div>
        <div className="stat"><span className="stat-icon" style={{ ["--hue" as string]: "var(--hue-gold)" }}><Icon name="package" /></span><div><strong>{k?.orders ?? "–"}</strong><span>Pedidos</span></div></div>
        <div className="stat"><span className="stat-icon" style={{ ["--hue" as string]: "var(--success)" }}><Icon name="users" /></span><div><strong>{k?.customers ?? "–"}</strong><span>Clientes</span></div></div>
        <div className="stat"><span className="stat-icon" style={{ ["--hue" as string]: "var(--info)" }}><Icon name="wallet" /></span><div><strong className="num">{k ? formatCOP(k.revenue) : "–"}</strong><span>Ventas (COP)</span></div></div>
      </div>
      {k && (k.to_deliver > 0 || k.low_stock > 0 || k.open_tickets > 0 || k.pending_payment > 0 || k.open_issues > 0 || k.expiring_accounts > 0 || k.pending_topups > 0) && (
        <div className="tabs" style={{ marginBottom: 20, flexWrap: "wrap" }}>
          {k.to_deliver > 0 && <Link className="tab" style={{ display: "inline-flex", alignItems: "center" }} to="/admin/pedidos?estado=paid">{k.to_deliver} por entregar</Link>}
          {k.pending_payment > 0 && <Link className="tab" style={{ display: "inline-flex", alignItems: "center" }} to="/admin/pedidos?estado=pending_payment">{k.pending_payment} pendientes de pago</Link>}
          {k.low_stock > 0 && <Link className="tab" style={{ display: "inline-flex", alignItems: "center" }} to="/admin/productos">{k.low_stock} con inventario bajo</Link>}
          {k.open_tickets > 0 && <Link className="tab" style={{ display: "inline-flex", alignItems: "center" }} to="/admin/soporte">{k.open_tickets} solicitudes abiertas</Link>}
          {k.open_issues > 0 && <Link className="tab" style={{ display: "inline-flex", alignItems: "center", color: "#ff6b6b" }} to="/admin/soporte">{k.open_issues} cuentas caídas por resolver</Link>}
          {k.expiring_accounts > 0 && <Link className="tab" style={{ display: "inline-flex", alignItems: "center", color: "var(--warning)" }} to="/admin/inventario?estado=por-vencer">{k.expiring_accounts} cuentas por vencer</Link>}
          {k.pending_topups > 0 && <Link className="tab" style={{ display: "inline-flex", alignItems: "center" }} to="/admin/billetera">{k.pending_topups} recargas por confirmar</Link>}
        </div>
      )}
      <div className="split">
        <div className="panel">
          <div className="panel-head">
            <h3>Ventas {range === "week" ? "esta semana" : "últimos 30 días"}</h3>
            <select className="select" style={{ width: "auto", height: 36 }} value={range} onChange={(e) => setRange(e.target.value as "week")} aria-label="Periodo">
              <option value="week">Esta semana</option>
              <option value="month">Últimos 30 días</option>
            </select>
          </div>
          {d.loading && !d.data ? <Skeleton h={240} /> : d.data && <AreaChart data={d.data.series} labelFor={label} />}
        </div>
        <div className="panel">
          <div className="panel-head"><h3>Más vendidos</h3></div>
          {!d.data?.top.length ? (
            <p className="muted" style={{ fontSize: 14 }}>Aún no hay ventas confirmadas.</p>
          ) : (
            <div className="bars">
              {d.data.top.map((t) => (
                <div key={t.name} className="bar-row">
                  <span>{t.name}</span>
                  <span className="faint num">{t.units} u.</span>
                  <div className="bar-track"><div className="bar-fill" style={{ width: `${(t.units / d.data!.top[0]!.units) * 100}%` }} /></div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="panel" style={{ marginTop: 20 }}>
        <div className="panel-head"><h3>Pedidos recientes</h3><Link className="btn btn-ghost btn-sm" to="/admin/pedidos">Ver todos <Icon name="arrow-right" /></Link></div>
        {d.data && <OrdersTable orders={d.data.recent} />}
      </div>
    </>
  );
}

export function OrdersTable({ orders }: { orders: Order[] }) {
  if (!orders.length) return <Empty icon="package" title="Sin pedidos" />;
  return (
    <div className="table-wrap">
      <table className="table responsive">
        <thead><tr><th>Pedido</th><th>Cliente</th><th>Fecha</th><th>Pago</th><th>Estado</th><th className="t-right">Total</th><th /></tr></thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td className="t-strong num"><Link to={`/admin/pedidos/${o.code}`}>{o.code}</Link></td>
              <td>{o.buyerName}</td>
              <td className="muted">{formatDate(o.createdAt)}</td>
              <td className="muted">{PROVIDER_LABEL[o.paymentProvider]}</td>
              <td><StatusBadge status={o.status} /></td>
              <td className="t-right t-strong num">{formatCOP(o.total)}</td>
              <td className="t-right"><Link className="btn btn-light btn-sm" to={`/admin/pedidos/${o.code}`}>Ver</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ================= Productos ================= */

type ProductForm = {
  name: string; slug: string; categoryId: number; summary: string; description: string; includesText: string; instructions: string;
  deliveryText: string; warrantyText: string; durationLabel: string; accountLabel: string; price: number; compareAtPrice: number | null;
  stock: number; maxPerOrder: number; artGlyph: string; artColor: string | null; imageUrl: string; isFeatured: boolean; isActive: boolean;
  deliveryMode: "manual" | "auto"; durationDays: number | null; lowStockThreshold: number;
};

const emptyProduct = (categoryId = 0): ProductForm => ({
  name: "", slug: "", categoryId, summary: "", description: "", includesText: "", instructions: "",
  deliveryText: "Entrega digital en tu panel de usuario (Mis pedidos → Ver detalle) una vez confirmado el pago.",
  warrantyText: "Garantía de funcionamiento durante todo el periodo contratado.",
  durationLabel: "", accountLabel: "", price: 0, compareAtPrice: null, stock: 0, maxPerOrder: 5, artGlyph: "", artColor: null, imageUrl: "",
  isFeatured: false, isActive: true, deliveryMode: "manual", durationDays: null, lowStockThreshold: 5,
});

const num = (v: string) => (v === "" ? 0 : Number(v.replace(/\D/g, "")));

function ProductEditor({ id, categories, onClose, onSaved }: { id: number | "new"; categories: Category[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const form = useForm(productInputSchema, emptyProduct(categories[0]?.id));
  const [slugTouched, setSlugTouched] = useState(id !== "new");
  const loaded = useQuery(async () => {
    if (id === "new") return null;
    const r = await api.get<{ product: ProductDetail & { rawArtColor: string | null } }>(`/api/admin/products/${id}`);
    const p = r.product;
    form.setValues({
      name: p.name, slug: p.slug, categoryId: p.categoryId, summary: p.summary, description: p.description, includesText: p.includesText,
      instructions: p.instructions, deliveryText: p.deliveryText, warrantyText: p.warrantyText, durationLabel: p.durationLabel, accountLabel: p.accountLabel,
      price: p.price, compareAtPrice: p.compareAtPrice, stock: p.stock, maxPerOrder: p.maxPerOrder, artGlyph: p.artGlyph,
      artColor: p.rawArtColor, imageUrl: p.imageUrl ?? "", isFeatured: p.isFeatured, isActive: p.isActive,
      deliveryMode: p.deliveryMode, durationDays: p.durationDays, lowStockThreshold: (p as unknown as { lowStockThreshold?: number }).lowStockThreshold ?? 5,
    });
    return p;
  }, [id]);
  const v = form.values as ProductForm;
  const cat = categories.find((c) => c.id === v.categoryId);

  const save = form.submit(async (data) => {
    if (id === "new") await api.post("/api/admin/products", data);
    else await api.put(`/api/admin/products/${id}`, data);
    toast("success", "Producto guardado.");
    onSaved();
  });

  return (
    <Modal
      open
      wide
      title={id === "new" ? "Nuevo producto" : "Editar producto"}
      onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={() => void save()} disabled={form.submitting || loaded.loading}>{form.submitting && <Spinner />} Guardar</button></>}
    >
      {loaded.loading ? <Skeleton h={300} /> : (
        <form className="form" onSubmit={save} noValidate>
          {form.formError && <Alert kind="error">{form.formError}</Alert>}
          <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0,1fr)", gap: 20, alignItems: "start" }}>
            <div style={{ borderRadius: 14, overflow: "hidden" }}>
              <ProductArt glyph={v.artGlyph || v.name.slice(0, 1).toUpperCase() || "?"} color={v.artColor || cat?.color || "#e3122c"} imageUrl={v.imageUrl || null} name={v.name.split(" ")[0]} />
            </div>
            <div className="form" style={{ gap: 16 }}>
              <TextField label="Nombre" value={v.name} error={form.errors.name} onValue={(val) => { form.set("name", val); if (!slugTouched) form.set("slug", slugify(val)); }} />
              <TextField label="Slug (URL)" value={v.slug} error={form.errors.slug} onValue={(val) => { setSlugTouched(true); form.set("slug", val); }} hint={`/producto/${v.slug || "…"}`} />
            </div>
          </div>
          <div className="form-row">
            <SelectField label="Categoría" value={v.categoryId} error={form.errors.categoryId} onValue={(val) => form.set("categoryId", Number(val))} options={[{ value: 0, label: "Selecciona…" }, ...categories.map((c) => ({ value: c.id, label: c.name }))]} />
            <TextField label="Resumen corto" value={v.summary} error={form.errors.summary} onValue={(val) => form.set("summary", val)} placeholder="1 año · Perfil individual" maxLength={160} />
          </div>
          <div className="form-row">
            <TextField label="Precio (COP)" inputMode="numeric" value={v.price || ""} error={form.errors.price} onValue={(val) => form.set("price", num(val))} />
            <TextField label="Precio anterior (opcional)" inputMode="numeric" value={v.compareAtPrice ?? ""} error={form.errors.compareAtPrice} onValue={(val) => form.set("compareAtPrice", val === "" ? null : num(val))} />
            <TextField label="Inventario" inputMode="numeric" value={v.stock} error={form.errors.stock} onValue={(val) => form.set("stock", num(val))} disabled={v.deliveryMode === "auto"} hint={v.deliveryMode === "auto" ? "Se calcula con las cuentas disponibles." : undefined} />
            <TextField label="Máx. por pedido" inputMode="numeric" value={v.maxPerOrder} error={form.errors.maxPerOrder} onValue={(val) => form.set("maxPerOrder", num(val))} />
          </div>
          <div className="form-row">
            <SelectField label="Entrega" value={v.deliveryMode} onValue={(val) => form.set("deliveryMode", val as "auto")} options={[{ value: "manual", label: "Manual (el admin entrega)" }, { value: "auto", label: "Automática desde inventario de cuentas" }]} hint={v.deliveryMode === "auto" ? "Al confirmarse el pago se entrega una cuenta del inventario y el pedido se completa solo." : undefined} />
            <TextField label="Duración del servicio (días)" inputMode="numeric" value={v.durationDays ?? ""} error={form.errors.durationDays} onValue={(val) => form.set("durationDays", val === "" ? null : num(val))} hint="Se usa para avisar al cliente antes del vencimiento." />
            <TextField label="Alerta de poco stock en" inputMode="numeric" value={v.lowStockThreshold} error={form.errors.lowStockThreshold} onValue={(val) => form.set("lowStockThreshold", num(val))} />
          </div>
          <div className="form-row">
            <TextField label="Duración" value={v.durationLabel} onValue={(val) => form.set("durationLabel", val)} placeholder="1 año de duración" />
            <TextField label="Tipo de cuenta" value={v.accountLabel} onValue={(val) => form.set("accountLabel", val)} placeholder="Cuenta individual" />
          </div>
          <TextArea label="Descripción" value={v.description} error={form.errors.description} onValue={(val) => form.set("description", val)} rows={4} />
          <div className="form-row">
            <TextArea label="¿Qué incluye?" value={v.includesText} onValue={(val) => form.set("includesText", val)} rows={4} />
            <TextArea label="Instrucciones de uso" value={v.instructions} onValue={(val) => form.set("instructions", val)} rows={4} />
          </div>
          <div className="form-row">
            <TextArea label="Métodos de entrega" value={v.deliveryText} onValue={(val) => form.set("deliveryText", val)} rows={3} />
            <TextArea label="Garantía" value={v.warrantyText} onValue={(val) => form.set("warrantyText", val)} rows={3} />
          </div>
          <div className="form-row">
            <TextField label="Monograma del arte" value={v.artGlyph} onValue={(val) => form.set("artGlyph", val.slice(0, 4))} hint="1–4 caracteres." />
            <TextField label="Color del arte (opcional)" value={v.artColor ?? ""} error={form.errors.artColor} onValue={(val) => form.set("artColor", val || null)} placeholder={cat?.color ?? "#e3122c"} />
            <TextField label="Imagen (URL https, opcional)" value={v.imageUrl} error={form.errors.imageUrl} onValue={(val) => form.set("imageUrl", val)} placeholder="https://…" />
          </div>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            <Check checked={v.isActive} onChange={(val) => form.set("isActive", val)}>Visible en la tienda</Check>
            <Check checked={v.isFeatured} onChange={(val) => form.set("isFeatured", val)}>Destacado en inicio</Check>
          </div>
        </form>
      )}
    </Modal>
  );
}

export function AdminProducts() {
  useDocumentTitle("Productos");
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get("q") ?? "");
  const q = useDebounced(search, 300);
  const category = params.get("categoria") ?? "";
  const page = Number(params.get("pagina") ?? 1) || 1;
  const cats = useQuery(() => api.get<{ items: Category[] }>("/api/admin/categories"));
  const list = useQuery(() => api.get<{ items: (ProductSummary & { isActive: boolean })[]; total: number; pageSize: number }>(`/api/admin/products${qs({ q, category, page })}`), [q, category, page]);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [deleting, setDeleting] = useState<ProductSummary | null>(null);
  const [busy, setBusy] = useState(false);

  const adjustStock = async (p: ProductSummary, delta: number) => {
    try {
      const r = await api.patch<{ stock: number }>(`/api/admin/products/${p.id}/stock`, { delta });
      list.setData((d) => d && { ...d, items: d.items.map((x) => (x.id === p.id ? { ...x, stock: r.stock } : x)) });
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Error");
    }
  };
  const toggleActive = async (p: ProductSummary & { isActive: boolean }) => {
    try {
      await api.patch(`/api/admin/products/${p.id}/active`, { isActive: !p.isActive });
      list.setData((d) => d && { ...d, items: d.items.map((x) => (x.id === p.id ? { ...x, isActive: !p.isActive } : x)) });
      toast("success", p.isActive ? "Producto ocultado de la tienda." : "Producto visible en la tienda.");
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Error");
    }
  };

  return (
    <>
      <div className="dash-head">
        <div><h1 className="dash-title">Productos</h1><p className="eyebrow num">{list.data?.total ?? "…"} productos</p></div>
        <button className="btn btn-primary btn-sm" onClick={() => setEditing("new")} disabled={!cats.data?.items.length}><Icon name="plus" /> Nuevo producto</button>
      </div>
      <div className="toolbar">
        <div className="input-wrap" style={{ flex: 1, minWidth: 220, maxWidth: 380 }}>
          <Icon name="search" />
          <input className="input" placeholder="Buscar por nombre…" value={search} onChange={(e) => { setSearch(e.target.value); setParams((p) => { p.delete("pagina"); return p; }); }} aria-label="Buscar productos" />
        </div>
        <select className="select" value={category} onChange={(e) => setParams(e.target.value ? { categoria: e.target.value } : {})} aria-label="Filtrar por categoría">
          <option value="">Todas las categorías</option>
          {cats.data?.items.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
        </select>
      </div>
      <div className="panel" style={{ padding: 8 }}>
        {list.error ? <ErrorState message={list.error.message} onRetry={list.reload} /> : list.loading && !list.data ? <Skeleton h={300} /> : !list.data?.items.length ? (
          <Empty icon="box" title="No hay productos" text={q ? "Prueba otra búsqueda." : "Crea tu primer producto."} />
        ) : (
          <div className="table-wrap">
            <table className="table responsive">
              <thead><tr><th>Producto</th><th>Categoría</th><th className="t-right">Precio</th><th>Inventario</th><th>Estado</th><th /></tr></thead>
              <tbody>
                {list.data.items.map((p) => (
                  <tr key={p.id} style={{ opacity: p.isActive ? 1 : 0.55 }}>
                    <td>
                      <div className="cell-product">
                        <ProductArt glyph={p.artGlyph} color={p.artColor} imageUrl={p.imageUrl} showName={false} />
                        <div><strong>{p.name}</strong><div className="faint" style={{ fontSize: 12 }}>{p.summary}</div></div>
                      </div>
                    </td>
                    <td className="muted">{p.categoryName}</td>
                    <td className="t-right num t-strong">{formatCOP(p.price)}</td>
                    <td>
                      {p.deliveryMode === "auto" ? (
                        <Link to={`/admin/inventario?producto=${p.id}`} className={`status ${p.stock <= 3 ? "status-pending_payment" : "status-sold"}`} title="Gestionado por inventario de cuentas">
                          <Icon name="key" size={12} /> {p.stock} cuentas
                        </Link>
                      ) : (
                      <div className="qty" style={{ height: 32 }}>
                        <button onClick={() => adjustStock(p, -1)} disabled={p.stock <= 0} aria-label="Restar inventario"><Icon name="minus" /></button>
                        <output className={p.stock <= 5 ? "text-accent" : ""}>{p.stock}</output>
                        <button onClick={() => adjustStock(p, 1)} aria-label="Sumar inventario"><Icon name="plus" /></button>
                      </div>
                      )}
                    </td>
                    <td><button className={`status ${p.isActive ? "status-completed" : "status-neutral"}`} onClick={() => toggleActive(p)} title="Cambiar visibilidad">{p.isActive ? "Visible" : "Oculto"}</button></td>
                    <td className="t-right">
                      <div className="row-actions">
                        <Link className="icon-btn" to={`/producto/${p.slug}`} target="_blank" aria-label="Ver en la tienda"><Icon name="eye" /></Link>
                        <button className="icon-btn" onClick={() => setEditing(p.id)} aria-label={`Editar ${p.name}`}><Icon name="pencil" /></button>
                        <button className="icon-btn btn-danger" onClick={() => setDeleting(p)} aria-label={`Eliminar ${p.name}`}><Icon name="trash" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {list.data && <Pagination page={page} pageSize={list.data.pageSize} total={list.data.total} onPage={(p) => setParams((s) => { s.set("pagina", String(p)); return s; })} />}
      {editing !== null && cats.data && (
        <ProductEditor id={editing} categories={cats.data.items} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void list.reload(); }} />
      )}
      <ConfirmModal
        open={deleting !== null}
        title="Eliminar producto"
        text={`¿Eliminar «${deleting?.name}»? Si tiene pedidos asociados no se podrá eliminar; en ese caso ocúltalo.`}
        confirmLabel="Eliminar"
        danger
        busy={busy}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api.del(`/api/admin/products/${deleting!.id}`);
            toast("success", "Producto eliminado.");
            void list.reload();
          } catch (e) {
            toast("error", e instanceof ApiError ? e.message : "Error");
          } finally {
            setBusy(false);
            setDeleting(null);
          }
        }}
      />
    </>
  );
}

/* ================= Categorías ================= */

export function AdminCategories() {
  useDocumentTitle("Categorías");
  const toast = useToast();
  const list = useQuery(() => api.get<{ items: Category[] }>("/api/admin/categories"));
  const [editing, setEditing] = useState<Category | "new" | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const form = useForm(categoryInputSchema, { name: "", slug: "", description: "", icon: "tag", color: "#e3122c", sortOrder: 0, isActive: true });
  const v = form.values;

  const open = (c: Category | "new") => {
    setEditing(c);
    form.setErrors({});
    form.setFormError(null);
    form.setValues(c === "new" ? { name: "", slug: "", description: "", icon: "tag", color: "#e3122c", sortOrder: (list.data?.items.length ?? 0), isActive: true } : { name: c.name, slug: c.slug, description: c.description, icon: c.icon, color: c.color, sortOrder: c.sortOrder, isActive: c.isActive });
  };
  const save = form.submit(async (d) => {
    if (editing === "new") await api.post("/api/admin/categories", d);
    else if (editing) await api.put(`/api/admin/categories/${editing.id}`, d);
    toast("success", "Categoría guardada.");
    setEditing(null);
    await list.reload();
  });

  return (
    <>
      <div className="dash-head">
        <div><h1 className="dash-title">Categorías</h1><p className="eyebrow">Organiza el catálogo.</p></div>
        <button className="btn btn-primary btn-sm" onClick={() => open("new")}><Icon name="plus" /> Nueva categoría</button>
      </div>
      {list.error ? <ErrorState message={list.error.message} onRetry={list.reload} /> : list.loading ? <Skeleton h={300} /> : (
        <div className="panel" style={{ padding: 8 }}>
          <div className="table-wrap">
            <table className="table responsive">
              <thead><tr><th>Categoría</th><th>Slug</th><th>Productos</th><th>Orden</th><th>Estado</th><th /></tr></thead>
              <tbody>
                {list.data?.items.map((c) => (
                  <tr key={c.id}>
                    <td><div className="cell-product"><span className="cat-icon" style={{ ["--hue" as string]: c.color, width: 36, height: 36 }}><Icon name={c.icon} /></span><strong>{c.name}</strong></div></td>
                    <td className="muted">{c.slug}</td>
                    <td className="num">{c.productCount}</td>
                    <td className="num">{c.sortOrder}</td>
                    <td><span className={`status ${c.isActive ? "status-completed" : "status-neutral"}`}>{c.isActive ? "Activa" : "Inactiva"}</span></td>
                    <td className="t-right"><div className="row-actions">
                      <button className="icon-btn" onClick={() => open(c)} aria-label={`Editar ${c.name}`}><Icon name="pencil" /></button>
                      <button className="icon-btn btn-danger" onClick={() => setDeleting(c)} aria-label={`Eliminar ${c.name}`}><Icon name="trash" /></button>
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <Modal open={editing !== null} title={editing === "new" ? "Nueva categoría" : "Editar categoría"} onClose={() => setEditing(null)}
        footer={<><button className="btn btn-ghost" onClick={() => setEditing(null)}>Cancelar</button><button className="btn btn-primary" onClick={() => void save()} disabled={form.submitting}>{form.submitting && <Spinner />} Guardar</button></>}>
        <form className="form" onSubmit={save} noValidate>
          {form.formError && <Alert kind="error">{form.formError}</Alert>}
          <div className="form-row">
            <TextField label="Nombre" value={v.name} error={form.errors.name} onValue={(val) => { form.set("name", val); if (editing === "new") form.set("slug", slugify(val)); }} />
            <TextField label="Slug" value={v.slug} error={form.errors.slug} onValue={(val) => form.set("slug", val)} />
          </div>
          <TextField label="Descripción" value={v.description ?? ""} onValue={(val) => form.set("description", val)} maxLength={255} />
          <div className="form-row">
            <SelectField label="Icono" value={v.icon ?? "tag"} onValue={(val) => form.set("icon", val)} options={ICON_NAMES.map((n) => ({ value: n, label: n }))} />
            <div className="field">
              <label className="label" htmlFor="cat-color">Color</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input id="cat-color" type="color" value={v.color} onChange={(e) => form.set("color", e.target.value)} style={{ width: 52, height: 46, border: 0, background: "none" }} />
                <input className="input" value={v.color} onChange={(e) => form.set("color", e.target.value)} aria-label="Color hexadecimal" />
              </div>
              {form.errors.color && <p className="field-error">{form.errors.color}</p>}
            </div>
            <TextField label="Orden" inputMode="numeric" value={v.sortOrder ?? 0} onValue={(val) => form.set("sortOrder", num(val))} />
          </div>
          <Check checked={Boolean(v.isActive)} onChange={(val) => form.set("isActive", val)}>Categoría activa</Check>
        </form>
      </Modal>
      <ConfirmModal open={deleting !== null} title="Eliminar categoría" text={`¿Eliminar «${deleting?.name}»? Solo es posible si no tiene productos.`} confirmLabel="Eliminar" danger onClose={() => setDeleting(null)}
        onConfirm={async () => {
          try {
            await api.del(`/api/admin/categories/${deleting!.id}`);
            toast("success", "Categoría eliminada.");
            void list.reload();
          } catch (e) {
            toast("error", e instanceof ApiError ? e.message : "Error");
          }
          setDeleting(null);
        }} />
    </>
  );
}
