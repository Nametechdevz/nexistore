import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../components/Icon";
import { PayLogo } from "../components/PayLogo";
import { ProductCard } from "../components/ProductCard";
import { CardSkeletons, ErrorState, ProductArt } from "../components/ui";
import { api } from "../lib/api";
import { useDocumentTitle, useQuery } from "../lib/hooks";
import { countUp, useTilt } from "../lib/premium";
import { useSession, useStore } from "../lib/state";
import { DEFAULT_THEME } from "../../../shared/themes";
import type { Category, ProductSummary } from "../../../shared/types";

/** Número que cuenta hacia arriba al aparecer. */
function Counter({ value, suffix = "" }: { value: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => (ref.current ? countUp(ref.current, value, suffix) : undefined), [value, suffix]);
  return <span ref={ref} className="num">0{suffix}</span>;
}

const STEPS = [
  { icon: "search", title: "Elige", text: "Encuentra tu servicio y la opción que más te sirve." },
  { icon: "lock", title: "Paga seguro", text: "Pasarela verificada, billetera o transferencia con comprobante." },
  { icon: "zap", title: "Recibe al instante", text: "Tus datos de acceso llegan a tu panel y a tu correo." },
];

export function PremiumHome() {
  useDocumentTitle("");
  const store = useStore();
  const { user } = useSession();
  const theme = { ...DEFAULT_THEME, ...store?.theme };
  const cats = useQuery(() => api.get<{ items: Category[] }>("/api/catalog/categories"));
  const popular = useQuery(() => api.get<{ items: ProductSummary[]; total: number }>("/api/catalog/products?sort=popular&pageSize=10"));
  const all = useQuery(() => api.get<{ total: number }>("/api/catalog/products?pageSize=1"));
  const deals = useQuery(() => api.get<{ items: ProductSummary[] }>("/api/catalog/products?onSale=1&sort=discount&pageSize=6"));
  const stage = useRef<HTMLDivElement>(null);
  useTilt(stage, true);

  const featured = popular.data?.items ?? [];
  const methods = (store?.paymentMethods ?? []).filter((m) => m.configured);
  const categories = cats.data?.items ?? [];

  return (
    <div className="pro">
      {/* ---------- Portada ---------- */}
      <section className="pro-hero">
        <div className="aurora" aria-hidden="true">
          <span className="blob b1" />
          <span className="blob b2" />
          <span className="blob b3" />
          <span className="blob b4" />
          <span className="pro-grid" />
        </div>
        <div className="container pro-hero-inner">
          <div className="pro-copy">
            <span className="pill">
              <span className="dot" /> Entrega inmediata · Pagos verificados
            </span>
            <h1 className="pro-title">
              {theme.heroTitle} <span className="grad-text">{theme.heroAccent}</span>
            </h1>
            <p className="pro-sub">{theme.heroSubtitle}</p>
            <div className="hero-cta">
              <Link className="btn btn-primary btn-lg btn-shine" to="/productos">
                Explorar catálogo <Icon name="arrow-right" />
              </Link>
              <Link className="btn btn-outline btn-lg" to="/promociones">
                Ver ofertas
              </Link>
            </div>
            <div className="pro-stats">
              <div>
                <strong>{all.data ? <Counter value={all.data.total} suffix="+" /> : "—"}</strong>
                <span>Productos disponibles</span>
              </div>
              <div>
                <strong>{cats.data ? <Counter value={categories.length} /> : "—"}</strong>
                <span>Categorías</span>
              </div>
              <div>
                <strong><Counter value={100} suffix="%" /></strong>
                <span>Pagos verificados</span>
              </div>
            </div>
          </div>

          <div className="pro-stage" ref={stage} aria-hidden="true">
            <div className="orbit" />
            <div className="stage-3d">
              {featured.slice(0, 3).map((p, i) => (
                <div key={p.id} className={`float-card fc${i + 1}`}>
                  <ProductArt glyph={p.artGlyph} color={p.artColor} imageUrl={p.imageUrl} name={p.name.split(" ")[0]} showName={i === 0} />
                  <div className="fc-meta">
                    <strong>{p.name}</strong>
                    <span className="num">{p.hasVariants ? "Desde " : ""}${p.price.toLocaleString("es-CO")}</span>
                  </div>
                </div>
              ))}
              <div className="float-chip chip-a"><Icon name="check" /> Pago verificado</div>
              <div className="float-chip chip-b"><Icon name="zap" /> Entregado en segundos</div>
            </div>
          </div>
        </div>
        <a href="#descubre" className="scroll-cue" aria-label="Bajar">
          <span />
        </a>
      </section>

      {/* ---------- Cinta de categorías ---------- */}
      {categories.length > 0 && (
        <div className="marquee" aria-label="Categorías">
          <div className="marquee-track">
            {[...categories, ...categories].map((c, i) => (
              <Link key={`${c.id}-${i}`} to={`/categorias/${c.slug}`} className="marquee-item" style={{ ["--hue" as string]: c.color }} tabIndex={i >= categories.length ? -1 : 0} aria-hidden={i >= categories.length}>
                {c.imageUrl ? <img src={c.imageUrl} alt="" /> : <Icon name={c.icon} />}
                {c.name}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="container" id="descubre">
        {/* ---------- Destacados ---------- */}
        <section className="section" aria-labelledby="pro-pop">
          <div className="section-head">
            <div>
              <span className="kicker">Lo más pedido</span>
              <h2 id="pro-pop" className="section-title">Favoritos de la comunidad</h2>
            </div>
            <Link className="btn btn-outline btn-sm" to="/productos">
              Ver todo <Icon name="arrow-right" />
            </Link>
          </div>
          {popular.error ? (
            <ErrorState message={popular.error.message} onRetry={popular.reload} />
          ) : (
            <div className="p-grid">{popular.loading ? <CardSkeletons n={10} /> : featured.slice(0, 10).map((p) => <ProductCard key={p.id} p={p} />)}</div>
          )}
        </section>

        {/* ---------- Beneficios (bento) ---------- */}
        <section className="section" aria-labelledby="pro-why">
          <div className="section-head center">
            <div>
              <span className="kicker">Por qué elegirnos</span>
              <h2 id="pro-why" className="section-title">Comprar digital, sin complicaciones</h2>
            </div>
          </div>
          <div className="bento">
            <article className="bento-card glow-card b-big">
              <span className="b-icon"><Icon name="zap" /></span>
              <h3>Entrega automática</h3>
              <p>En cuanto se confirma tu pago, el sistema te entrega tus datos de acceso. Sin esperas ni mensajes de ida y vuelta.</p>
              <ol className="b-flow">
                <li><Icon name="cart" /> Pedido creado</li>
                <li><Icon name="shield" /> Pago verificado</li>
                <li className="on"><Icon name="key" /> Acceso entregado</li>
              </ol>
            </article>
            <article className="bento-card glow-card">
              <span className="b-icon"><Icon name="shield" /></span>
              <h3>Pagos verificados</h3>
              <p>Cada pago se confirma con la pasarela o con tu comprobante antes de entregar.</p>
              {methods.length > 0 && (
                <div className="pay-logos" style={{ marginTop: "auto" }}>
                  {methods.map((m) => <PayLogo key={m.id} id={m.id} logo={m.logo} label={m.label} />)}
                </div>
              )}
            </article>
            <article className="bento-card glow-card">
              <span className="b-icon"><Icon name="badge-check" /></span>
              <h3>Garantía real</h3>
              <p>Si un acceso falla durante tu servicio, lo reemplazamos o te devolvemos la parte no usada.</p>
            </article>
            <article className="bento-card glow-card">
              <span className="b-icon"><Icon name="wallet" /></span>
              <h3>Billetera</h3>
              <p>Recarga saldo y paga en un clic. Los reembolsos llegan al instante.</p>
            </article>
            <article className="bento-card glow-card">
              <span className="b-icon"><Icon name="headphones" /></span>
              <h3>Soporte en la tienda</h3>
              <p>Chatea con nosotros desde tu pedido y recibe respuesta con notificación.</p>
            </article>
          </div>
        </section>

        {/* ---------- Cómo funciona ---------- */}
        <section className="section" aria-labelledby="pro-how">
          <div className="section-head center">
            <div>
              <span className="kicker">Así de fácil</span>
              <h2 id="pro-how" className="section-title">Tu servicio listo en 3 pasos</h2>
            </div>
          </div>
          <ol className="steps-pro" data-reveal>
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <span className="sp-num">{i + 1}</span>
                <span className="sp-icon"><Icon name={s.icon} /></span>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ---------- Ofertas ---------- */}
        {(deals.data?.items.length ?? 0) > 0 && (
          <section className="section" aria-labelledby="pro-deals">
            <div className="section-head">
              <div>
                <span className="kicker">Por tiempo limitado</span>
                <h2 id="pro-deals" className="section-title">Ofertas que vale la pena aprovechar</h2>
              </div>
              <Link className="btn btn-outline btn-sm" to="/promociones">
                Ver ofertas <Icon name="arrow-right" />
              </Link>
            </div>
            <div className="p-grid dense">{deals.data!.items.map((p) => <ProductCard key={p.id} p={p} />)}</div>
          </section>
        )}

        {/* ---------- Llamado final ---------- */}
        <section className="section">
          <div className="cta-pro" data-reveal>
            <div className="cta-glow" aria-hidden="true" />
            <h2>¿Listo para empezar?</h2>
            <p>Crea tu cuenta en segundos, recarga tu billetera y recibe tus servicios al instante.</p>
            <div className="hero-cta" style={{ justifyContent: "center" }}>
              <Link className="btn btn-primary btn-lg btn-shine" to={user ? "/productos" : "/registro"}>
                {user ? "Ir al catálogo" : "Crear mi cuenta"} <Icon name="arrow-right" />
              </Link>
              <Link className="btn btn-outline btn-lg" to="/soporte">
                Hablar con soporte
              </Link>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
