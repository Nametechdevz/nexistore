import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Icon } from "../components/Icon";
import { ProductCard } from "../components/ProductCard";
import { Empty, ErrorState, Price, ProductArt, QtyStepper, Skeleton, Stars } from "../components/ui";
import { api } from "../lib/api";
import { formatCOP, formatDate } from "../lib/format";
import { useDocumentTitle, useQuery } from "../lib/hooks";
import { useCart, useStore, useToast } from "../lib/state";
import type { ProductDetail, ProductSummary } from "../../../shared/types";

export function ProductPage() {
  const { slug = "" } = useParams();
  const { data, error, loading, reload } = useQuery(
    () => api.get<{ product: ProductDetail; related: ProductSummary[] }>(`/api/catalog/products/${encodeURIComponent(slug)}`),
    [slug],
  );
  const p = data?.product;
  useDocumentTitle(p?.name ?? "Producto");
  const cart = useCart();
  const toast = useToast();
  const store = useStore();
  const navigate = useNavigate();
  const [view, setView] = useState(0);
  const [variantId, setVariantId] = useState<number | null>(null);
  useEffect(() => {
    setView(0);
    setVariantId(null);
  }, [slug]);
  const [qty, setQty] = useState(1);

  if (error?.status === 404)
    return (
      <div className="container">
        <Empty icon="search" title="Producto no encontrado" text="Puede que ya no esté disponible." action={<Link className="btn btn-primary" to="/productos">Ver catálogo</Link>} />
      </div>
    );
  if (error)
    return (
      <div className="container">
        <ErrorState message={error.message} onRetry={reload} />
      </div>
    );
  if (loading || !p)
    return (
      <div className="container section">
        <div className="pdp">
          <Skeleton h={480} r={16} />
          <div style={{ display: "grid", gap: 16 }}>
            <Skeleton h={40} w="70%" />
            <Skeleton h={20} w="40%" />
            <Skeleton h={48} w="50%" />
            <Skeleton h={140} />
            <Skeleton h={52} />
          </div>
        </div>
      </div>
    );

  // Opción elegida: la seleccionada o, por defecto, la primera con inventario.
  const variants = p.variants ?? [];
  const selected = variants.length ? (variants.find((v) => v.id === variantId) ?? variants.find((v) => v.stock > 0) ?? variants[0]!) : null;
  const price = selected?.price ?? p.price;
  const compareAt = selected ? selected.compareAtPrice : p.compareAtPrice;
  const stock = selected?.stock ?? p.stock;
  const inCart = cart.lines.find((l) => l.productId === p.id && (l.variantId ?? null) === (selected?.id ?? null))?.quantity ?? 0;
  const maxAllowed = Math.max(0, Math.min(p.maxPerOrder, stock) - inCart);
  const soldOut = stock <= 0;
  // Imágenes subidas por el administrador; si no hay, 3 composiciones del arte propio.
  const images = p.images?.length ? p.images : p.imageUrl ? [p.imageUrl] : [];
  const views = [
    { ribbon: false, icon: undefined as string | undefined },
    { ribbon: Boolean(store?.campaign.enabled), icon: undefined },
    { ribbon: false, icon: p.categoryIcon },
  ];

  const add = (goToCart: boolean) => {
    cart.add(p.id, Math.min(qty, maxAllowed), Math.min(p.maxPerOrder, stock), selected?.id ?? null);
    toast("success", `${p.name}${selected ? ` (${selected.name})` : ""} se agregó al carrito.`);
    setQty(1);
    if (goToCart) navigate("/carrito");
  };

  const sections = [
    { icon: "gift", title: "¿Qué incluye?", body: p.includesText },
    { icon: "file", title: "Instrucciones de uso", body: p.instructions },
    { icon: "truck", title: "Métodos de entrega", body: p.deliveryText },
    { icon: "shield", title: "Garantía", body: p.warrantyText },
  ].filter((s) => s.body);

  return (
    <div className="container">
      <div className="page-head" style={{ paddingBottom: 16 }}>
        <nav className="crumbs" aria-label="Migas de pan">
          <Link to="/">Inicio</Link>
          <span aria-hidden>›</span>
          <Link to={`/categorias/${p.categorySlug}`}>{p.categoryName}</Link>
          <span aria-hidden>›</span>
          <span>{p.name}</span>
        </nav>
      </div>
      <div className="pdp">
        <div>
          <div className="gallery-main">
            {images.length ? (
              <ProductArt glyph={p.artGlyph} color={p.artColor} imageUrl={images[Math.min(view, images.length - 1)]!} />
            ) : (
              <ProductArt glyph={p.artGlyph} color={p.artColor} name={p.name} ribbon={views[view]!.ribbon} icon={views[view]!.icon} />
            )}
          </div>
          {images.length > 1 && (
            <div className="gallery-thumbs" role="group" aria-label="Imágenes del producto">
              {images.map((src, i) => (
                <button key={src} aria-pressed={view === i} onClick={() => setView(i)} aria-label={`Imagen ${i + 1}`}>
                  <ProductArt glyph={p.artGlyph} color={p.artColor} imageUrl={src} showName={false} />
                </button>
              ))}
            </div>
          )}
          {!images.length && (
            <div className="gallery-thumbs" role="group" aria-label="Vistas del producto">
              {views.map((v, i) => (
                <button key={i} aria-pressed={view === i} onClick={() => setView(i)} aria-label={`Vista ${i + 1}`}>
                  <ProductArt glyph={p.artGlyph} color={p.artColor} ribbon={v.ribbon} icon={v.icon} showName={false} />
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <h1 className="pdp-title">{p.name}</h1>
          <div className="rating">
            {p.ratingCount > 0 ? (
              <>
                <Stars value={p.ratingAvg ?? 0} />
                <span className="num">
                  {p.ratingAvg?.toFixed(1)} ({p.ratingCount} valoracion{p.ratingCount === 1 ? "" : "es"})
                </span>
              </>
            ) : (
              <span>Aún sin valoraciones</span>
            )}
          </div>
          <Price price={price} compareAt={compareAt} size="lg" />
          {variants.length > 0 && (
            <div className="variant-picker">
              <span className="label">Elige una opción</span>
              <div className="variant-options" role="radiogroup" aria-label="Opciones del producto">
                {variants.map((v) => {
                  const off = v.compareAtPrice && v.compareAtPrice > v.price ? Math.round((1 - v.price / v.compareAtPrice) * 100) : 0;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      role="radio"
                      aria-checked={selected?.id === v.id}
                      className="variant-opt"
                      disabled={v.stock <= 0}
                      onClick={() => {
                        setVariantId(v.id);
                        setQty(1);
                      }}
                    >
                      {off > 0 && <span className="badge-off">-{off}%</span>}
                      <strong>{v.name}</strong>
                      <span>
                        <span className="num">{formatCOP(v.price)}</span>
                        {v.compareAtPrice ? <s className="num">{formatCOP(v.compareAtPrice)}</s> : null}
                      </span>
                      <small>{v.stock <= 0 ? "Agotado" : v.stock <= 5 ? `Quedan ${v.stock}` : v.durationDays ? `${v.durationDays} días de servicio` : "Disponible"}</small>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <ul className="feature-list">
            {(selected?.durationDays || p.durationLabel) && (
              <li>
                <Icon name="clock" /> {selected?.durationDays ? `${selected.durationDays} días de servicio` : p.durationLabel}
              </li>
            )}
            {p.accountLabel && (
              <li>
                <Icon name="user" /> {p.accountLabel}
              </li>
            )}
            <li>
              <Icon name="zap" /> {p.deliveryMode === "auto" ? "Entrega automática al confirmarse el pago" : "Entrega digital en tu panel"}
            </li>
            <li>
              <Icon name="badge-check" /> Garantía de funcionamiento
            </li>
            <li>
              <Icon name="package" />
              {soldOut ? <span style={{ color: "var(--text-3)" }}>Agotado</span> : stock <= 5 ? <span style={{ color: "var(--warning)" }}>Últimas {stock} unidades</span> : <span>Disponible</span>}
            </li>
          </ul>
          {soldOut ? (
            <button className="btn btn-primary btn-lg btn-block" disabled>
              Agotado
            </button>
          ) : maxAllowed === 0 ? (
            <Link className="btn btn-outline btn-lg btn-block" to="/carrito">
              Ya tienes el máximo permitido en tu carrito
            </Link>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              <div className="buy-row">
                <QtyStepper value={qty} onChange={setQty} max={maxAllowed} label={p.name} />
                <button className="btn btn-primary btn-lg" onClick={() => add(false)}>
                  <Icon name="cart" /> Agregar al carrito
                </button>
              </div>
              <button className="btn btn-outline btn-lg btn-block" onClick={() => add(true)}>
                Comprar ahora
              </button>
            </div>
          )}
        </div>
      </div>

      <section className="section split" style={{ alignItems: "start" }}>
        <div className="panel">
          <h2 className="section-title" style={{ fontSize: "var(--fs-lg)", marginBottom: 12 }}>
            Descripción
          </h2>
          <p className="prose">{p.description}</p>
          <div style={{ marginTop: 16 }}>
            {sections.map((s, i) => (
              <details key={s.title} className="acc" open={i === 0}>
                <summary>
                  <Icon name={s.icon} />
                  {s.title}
                  <Icon name="chevron-down" className="chev" />
                </summary>
                <div className="acc-body">{s.body}</div>
              </details>
            ))}
          </div>
        </div>
        <div className="panel">
          <h2 className="section-title" style={{ fontSize: "var(--fs-lg)", marginBottom: 12 }}>
            Opiniones
          </h2>
          {p.reviews.length === 0 ? (
            <p className="muted" style={{ fontSize: 14 }}>
              Todavía no hay opiniones. Quienes reciben el producto pueden calificarlo desde el detalle de su pedido.
            </p>
          ) : (
            <ul style={{ display: "grid", gap: 16 }}>
              {p.reviews.map((r) => (
                <li key={r.id} style={{ borderBottom: "1px solid var(--line)", paddingBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <strong style={{ fontSize: 14 }}>{r.author}</strong>
                    <Stars value={r.rating} />
                  </div>
                  {r.comment && <p className="muted" style={{ fontSize: 14, marginTop: 4 }}>{r.comment}</p>}
                  <span className="faint" style={{ fontSize: 12 }}>{formatDate(r.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {data.related.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">También te puede interesar</h2>
          </div>
          <div className="p-row">
            {data.related.map((r) => (
              <ProductCard key={r.id} p={r} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
