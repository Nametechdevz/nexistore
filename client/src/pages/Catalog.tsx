import { Link, useParams, useSearchParams } from "react-router-dom";
import { Icon } from "../components/Icon";
import { ProductCard } from "../components/ProductCard";
import { CardSkeletons, Empty, ErrorState, Pagination, ProductArt } from "../components/ui";
import { api, qs } from "../lib/api";
import { useDocumentTitle, useQuery } from "../lib/hooks";
import { useStore } from "../lib/state";
import { backgroundFor } from "../lib/format";
import type { Category, Paginated, ProductSummary } from "../../../shared/types";

const PRICE_RANGES = [
  { id: "", label: "Todos los precios" },
  { id: "0-30000", label: "Hasta $30.000" },
  { id: "30000-60000", label: "$30.000 – $60.000" },
  { id: "60000-100000", label: "$60.000 – $100.000" },
  { id: "100000-", label: "Más de $100.000" },
];

const SORTS = [
  { id: "popular", label: "Más populares" },
  { id: "discount", label: "Mayor descuento" },
  { id: "price_asc", label: "Menor precio" },
  { id: "price_desc", label: "Mayor precio" },
  { id: "newest", label: "Más recientes" },
];

export function CatalogPage({ mode }: { mode: "all" | "deals" | "category" }) {
  const { slug } = useParams();
  const [params, setParams] = useSearchParams();
  const store = useStore();
  const q = params.get("q") ?? "";
  const price = params.get("precio") ?? "";
  const sort = params.get("orden") ?? (mode === "deals" ? "discount" : "popular");
  const page = Number(params.get("pagina") ?? 1) || 1;
  const category = mode === "category" ? slug ?? "" : params.get("categoria") ?? "";
  const [min, max] = price.split("-");

  const cats = useQuery(() => api.get<{ items: Category[] }>("/api/catalog/categories"));
  const current = cats.data?.items.find((c) => c.slug === category);
  const list = useQuery(
    () =>
      api.get<Paginated<ProductSummary>>(
        `/api/catalog/products${qs({ q, category, minPrice: min, maxPrice: max, sort, page, pageSize: 24, onSale: mode === "deals" ? 1 : undefined })}`,
      ),
    [q, category, price, sort, page, mode],
  );

  const title = mode === "deals" ? "Promociones" : mode === "category" ? current?.name ?? "Categoría" : q ? `Resultados para «${q}»` : "Todos los productos";
  useDocumentTitle(title);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "pagina") next.delete("pagina");
    setParams(next, { replace: key !== "pagina" });
  };

  return (
    <div className="container">
      <div className="page-head">
        <nav className="crumbs" aria-label="Migas de pan">
          <Link to="/">Inicio</Link>
          <span aria-hidden>›</span>
          {mode === "category" ? (
            <>
              <Link to="/categorias">Categorías</Link>
              <span aria-hidden>›</span>
              <span>{current?.name ?? "…"}</span>
            </>
          ) : (
            <span>{mode === "deals" ? "Promociones" : "Productos"}</span>
          )}
        </nav>
        <h1 className="page-title">{title}</h1>
        <p className="eyebrow">
          {mode === "deals" && store?.campaign.enabled
            ? store.campaign.promoText
            : mode === "category"
              ? current?.description
              : "Encuentra el servicio digital ideal para ti o para regalar."}
        </p>
      </div>

      <div className="catalog">
        <aside className="filters" aria-label="Filtros">
          {mode !== "category" && (
            <div className="filter-group">
              <h4>Categoría</h4>
              <div className="filter-list">
                <button aria-pressed={!category} onClick={() => setParam("categoria", "")}>
                  Todas
                </button>
                {cats.data?.items.map((c) => (
                  <button key={c.id} aria-pressed={category === c.slug} onClick={() => setParam("categoria", c.slug)}>
                    <span>{c.name}</span>
                    <span className="faint num">{c.productCount}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="filter-group">
            <h4>Precio</h4>
            <div className="filter-list">
              {PRICE_RANGES.map((r) => (
                <button key={r.id} aria-pressed={price === r.id} onClick={() => setParam("precio", r.id)}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        </aside>

        <section aria-live="polite">
          <div className="toolbar">
            <span className="muted num" style={{ fontSize: 14 }}>
              {list.loading ? "Buscando…" : `${list.data?.total ?? 0} producto${list.data?.total === 1 ? "" : "s"}`}
              {q && (
                <button className="btn btn-ghost btn-sm" onClick={() => setParam("q", "")} style={{ marginLeft: 8 }}>
                  <Icon name="x" /> Quitar búsqueda
                </button>
              )}
            </span>
            <label className="sr-only" htmlFor="sort">Ordenar</label>
            <select id="sort" className="select" value={sort} onChange={(e) => setParam("orden", e.target.value)}>
              {SORTS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          {list.error ? (
            <ErrorState message={list.error.message} onRetry={list.reload} />
          ) : list.loading ? (
            <div className="p-grid">
              <CardSkeletons n={8} />
            </div>
          ) : list.data && list.data.items.length === 0 ? (
            <Empty
              icon="search"
              title="No encontramos productos"
              text="Prueba con otras palabras o quita algunos filtros."
              action={
                <Link className="btn btn-outline" to="/productos">
                  Ver todo el catálogo
                </Link>
              }
            />
          ) : (
            <>
              <div className="p-grid">
                {list.data?.items.map((p) => (
                  <ProductCard key={p.id} p={p} ribbon={mode === "deals" && store?.campaign.enabled} />
                ))}
              </div>
              {list.data && <Pagination page={page} pageSize={list.data.pageSize} total={list.data.total} onPage={(p) => setParam("pagina", String(p))} />}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

export function CategoriesPage() {
  useDocumentTitle("Categorías");
  const store = useStore();
  const cats = useQuery(() => api.get<{ items: Category[] }>("/api/catalog/categories"));
  const all = useQuery(() => api.get<Paginated<ProductSummary>>("/api/catalog/products?pageSize=48"));
  const byCat = (slug: string) => (all.data?.items ?? []).filter((p) => p.categorySlug === slug).slice(0, 4);

  return (
    <div className="container">
      <div className="page-head">
        <nav className="crumbs" aria-label="Migas de pan">
          <Link to="/">Inicio</Link>
          <span aria-hidden>›</span>
          <span>Categorías</span>
        </nav>
        <h1 className="page-title">Categorías</h1>
        <p className="eyebrow">Encuentra el servicio digital ideal.</p>
      </div>
      {cats.error ? (
        <ErrorState message={cats.error.message} onRetry={cats.reload} />
      ) : (
        <div className="cat-grid">
          {cats.loading && Array.from({ length: 9 }, (_, i) => <div key={i} className="skel" style={{ height: 220, borderRadius: 16 }} />)}
          {cats.data?.items.map((c) => (
            <Link key={c.id} to={`/categorias/${c.slug}`} className="cat-card" style={{ ["--hue" as string]: c.color }}>
              <span className="cat-icon">
                <Icon name={c.icon} />
              </span>
              <div>
                <h3>{c.name}</h3>
                <p>{c.description}</p>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div className="cat-mini">
                  {byCat(c.slug).map((p) => (
                    <ProductArt key={p.id} glyph={p.artGlyph} color={p.artColor} imageUrl={p.imageUrl} showName={false} />
                  ))}
                </div>
                <span className="cat-count num">{c.productCount} productos →</span>
              </div>
            </Link>
          ))}
        </div>
      )}
      {store?.campaign.enabled && (
        <section className="section">
          <div className={`promo${backgroundFor(store.campaign, "promo") ? " has-bg" : ""}`} style={backgroundFor(store.campaign, "promo") ? { ["--promo-bg" as string]: `url("${backgroundFor(store.campaign, "promo")}")` } : undefined}>
            <div>
              <h2>{store.campaign.promoTitle}</h2>
              <p>{store.campaign.promoText}</p>
              <Link className="btn btn-light" to="/promociones">
                Ver ofertas <Icon name="arrow-right" />
              </Link>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
