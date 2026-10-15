import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Icon } from "../components/Icon";
import { ProductCard } from "../components/ProductCard";
import { Empty, ErrorState, Price, ProductArt, QtyStepper, Skeleton, Stars } from "../components/ui";
import { api } from "../lib/api";
import { formatDate } from "../lib/format";
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

  const inCart = cart.lines.find((l) => l.productId === p.id)?.quantity ?? 0;
  const maxAllowed = Math.max(0, Math.min(p.maxPerOrder, p.stock) - inCart);
  const soldOut = p.stock <= 0;
  // Galería: 3 composiciones del arte propio (o la imagen subida por el administrador).
  const views = [
    { ribbon: false, icon: undefined as string | undefined },
    { ribbon: Boolean(store?.campaign.enabled), icon: undefined },
    { ribbon: false, icon: p.categoryIcon },
  ];

  const add = (goToCart: boolean) => {
    cart.add(p.id, Math.min(qty, maxAllowed), Math.min(p.maxPerOrder, p.stock));
    toast("success", `${p.name} se agregó al carrito.`);
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
            {p.imageUrl ? (
              <ProductArt glyph={p.artGlyph} color={p.artColor} imageUrl={p.imageUrl} />
            ) : (
              <ProductArt glyph={p.artGlyph} color={p.artColor} name={p.name} ribbon={views[view]!.ribbon} icon={views[view]!.icon} />
            )}
          </div>
          {!p.imageUrl && (
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
          <Price price={p.price} compareAt={p.compareAtPrice} size="lg" />
          <ul className="feature-list">
            {p.durationLabel && (
              <li>
                <Icon name="clock" /> {p.durationLabel}
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
              {soldOut ? <span style={{ color: "var(--text-3)" }}>Agotado</span> : p.stock <= 5 ? <span style={{ color: "var(--warning)" }}>Últimas {p.stock} unidades</span> : <span>Disponible</span>}
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
