import { Link } from "react-router-dom";
import { Icon } from "../components/Icon";
import { ProductCard } from "../components/ProductCard";
import { CardSkeletons, ErrorState, ProductArt } from "../components/ui";
import { api } from "../lib/api";
import { backgroundFor } from "../lib/format";
import { useDocumentTitle, useQuery } from "../lib/hooks";
import { useStore } from "../lib/state";
import { PremiumHome } from "./PremiumHome";
import type { Category, ProductSummary } from "../../../shared/types";

const TRUST = [
  { icon: "zap", title: "Entrega inmediata", text: "Recibe tu producto en tu panel" },
  { icon: "shield", title: "Pagos seguros", text: "Verificados con la pasarela" },
  { icon: "headphones", title: "Soporte 24/7", text: "Estamos para ayudarte" },
  { icon: "crown", title: "Productos originales", text: "Garantía de funcionamiento" },
];

function HeroVisual({ products, seal }: { products: ProductSummary[]; seal?: { top: string; value: string; bottom: string } }) {
  const pick = (i: number) => products[i % Math.max(products.length, 1)];
  const slots = ["g1", "g2", "g3", "g4", "g5"];
  return (
    <div className="hero-visual" aria-hidden="true">
      {products.length > 0 &&
        slots.map((cls, i) => {
          const p = pick(i)!;
          return (
            <div key={cls} className={`gift ${cls}`}>
              <ProductArt glyph={p.artGlyph} color={p.artColor} name={p.name.split(" ")[0]} showName={i === 0} ribbon={i % 2 === 0} />
            </div>
          );
        })}
      {seal && (
        <div className="seal">
          <div>
            <small>{seal.top}</small>
            <strong>{seal.value}</strong>
            <small>{seal.bottom}</small>
          </div>
        </div>
      )}
    </div>
  );
}

/** Estilo elegido en Configuración → Apariencia (el servidor ya lo marca en <html>). */
export const useStyle = () => {
  const store = useStore(); // se vuelve a evaluar cuando llega la configuración
  return (document.documentElement.dataset.style ?? store?.theme?.style) === "premium" ? "premium" : "clasico";
};

export function HomePage() {
  return useStyle() === "premium" ? <PremiumHome /> : <ClassicHome />;
}

function ClassicHome() {
  useDocumentTitle("");
  const store = useStore();
  const campaign = store?.campaign;
  const cats = useQuery(() => api.get<{ items: Category[] }>("/api/catalog/categories"));
  const popular = useQuery(() => api.get<{ items: ProductSummary[] }>("/api/catalog/products?featured=1&pageSize=12"));
  const deals = useQuery(() => api.get<{ items: ProductSummary[] }>("/api/catalog/products?onSale=1&sort=discount&pageSize=6"));
  const heroProducts = popular.data?.items.slice(0, 5) ?? [];
  const seasonal = campaign?.enabled;
  const heroBg = backgroundFor(campaign, "hero");
  const promoBg = backgroundFor(campaign, "promo");

  return (
    <>
      <section className={`hero${heroBg ? " has-bg" : ""}`} style={heroBg ? { ["--hero-bg" as string]: `url("${heroBg}")` } : undefined}>
        {seasonal && campaign?.snow && <div className="snow" />}
        <div className="container hero-inner">
          <div>
            <h1 className="hero-title">
              {seasonal ? campaign.titleLead : "Todo lo digital que necesitas,"}
              <em>{seasonal ? campaign.titleAccent : "en un solo lugar."}</em>
            </h1>
            <p className="hero-sub">{seasonal ? campaign.subtitle : "Streaming, software, juegos e IA con entrega inmediata y garantía de funcionamiento."}</p>
            <div className="hero-cta">
              <Link className="btn btn-primary btn-lg" to={seasonal ? campaign.ctaHref : "/promociones"}>
                {seasonal ? campaign.ctaLabel : "Ver promociones"} <Icon name="arrow-right" />
              </Link>
              <Link className="btn btn-outline btn-lg" to="/productos">
                Explorar catálogo
              </Link>
            </div>
          </div>
          <HeroVisual products={campaign?.heroProducts === false ? [] : heroProducts} seal={seasonal ? { top: campaign.sealTop, value: campaign.sealValue, bottom: campaign.sealBottom } : undefined} />
        </div>
      </section>

      <div className="container">
        <div className="trust">
          {TRUST.map((t) => (
            <div key={t.title} className="trust-item">
              <Icon name={t.icon} />
              <div>
                <strong>{t.title}</strong>
                <span>{t.text}</span>
              </div>
            </div>
          ))}
        </div>

        <section className="section" aria-labelledby="cat-title">
          <h2 id="cat-title" className="sr-only">Categorías</h2>
          <div className="cat-strip">
            {cats.loading &&
              Array.from({ length: 10 }, (_, i) => <div key={i} className="skel" style={{ height: 112, borderRadius: 12 }} />)}
            {cats.data?.items.map((c) => (
              <Link key={c.id} to={`/categorias/${c.slug}`} className="cat-chip" style={{ ["--hue" as string]: c.color }}>
                <span className={`cat-icon${c.imageUrl ? " has-img" : ""}`}>
                  {c.imageUrl ? <img src={c.imageUrl} alt="" className="cat-img" loading="lazy" /> : <Icon name={c.icon} />}
                </span>
                {c.name}
              </Link>
            ))}
            {cats.data && (
              <Link to="/promociones" className="cat-chip" style={{ ["--hue" as string]: "#f2711c" }}>
                <span className="cat-icon">
                  <Icon name="percent" />
                </span>
                Ofertas
              </Link>
            )}
          </div>
          {cats.error && <ErrorState message={cats.error.message} onRetry={cats.reload} />}
        </section>

        <section className="section" aria-labelledby="pop-title">
          <div className="section-head">
            <div>
              <h2 id="pop-title" className="section-title">Productos más populares</h2>
              <p className="eyebrow">Lo que más se está regalando esta temporada</p>
            </div>
            <Link className="btn btn-outline btn-sm" to="/productos">
              Ver todos <Icon name="arrow-right" />
            </Link>
          </div>
          {popular.error ? (
            <ErrorState message={popular.error.message} onRetry={popular.reload} />
          ) : (
            <div className="p-row">
              {popular.loading ? <CardSkeletons n={6} /> : popular.data?.items.map((p) => <ProductCard key={p.id} p={p} />)}
            </div>
          )}
        </section>

        {seasonal && (
          <section className="section">
            <div className={`promo${promoBg ? " has-bg" : ""}`} style={promoBg ? { ["--promo-bg" as string]: `url("${promoBg}")` } : undefined}>
              <div>
                <h2>{campaign.promoTitle}</h2>
                <p>{campaign.promoText}</p>
                <Link className="btn btn-light" to="/promociones">
                  Ver ofertas <Icon name="arrow-right" />
                </Link>
              </div>
              <div className="promo-stack" aria-hidden="true">
                {(deals.data?.items ?? []).slice(0, 3).map((p, i) => (
                  <div key={p.id} className="art-wrap" style={{ position: "absolute", left: `${8 + i * 26}%`, top: i === 1 ? 50 : 18, transform: `rotate(${[-8, 6, -3][i]}deg)` }}>
                    <div style={{ width: 150, borderRadius: 16, overflow: "hidden", boxShadow: "var(--shadow-3)" }}>
                      <ProductArt glyph={p.artGlyph} color={p.artColor} ribbon showName={false} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        <section className="section" aria-labelledby="deals-title">
          <div className="section-head">
            <div>
              <h2 id="deals-title" className="section-title">Mejores descuentos</h2>
              <p className="eyebrow">Precios especiales por tiempo limitado</p>
            </div>
            <Link className="btn btn-outline btn-sm" to="/promociones">
              Ver promociones <Icon name="arrow-right" />
            </Link>
          </div>
          <div className="p-grid dense">
            {deals.loading ? <CardSkeletons n={6} /> : deals.data?.items.map((p) => <ProductCard key={p.id} p={p} ribbon={seasonal} />)}
          </div>
        </section>
      </div>
    </>
  );
}
