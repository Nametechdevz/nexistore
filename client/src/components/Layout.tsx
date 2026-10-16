import { useCallback, useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Icon } from "./Icon";
import { NotificationBell } from "./Notifications";
import { Drawer, Logo, ProductArt } from "./ui";
import { api, qs } from "../lib/api";
import { formatCOP } from "../lib/format";
import { useDebounced } from "../lib/hooks";
import { usePremiumEffects } from "../lib/premium";
import { useCart, useSession, useStore } from "../lib/state";
import type { ProductSummary } from "../../../shared/types";

const NAV = [
  { to: "/", label: "Inicio", icon: "home", end: true },
  { to: "/productos", label: "Productos", icon: "bag" },
  { to: "/categorias", label: "Categorías", icon: "tags" },
  { to: "/promociones", label: "Promociones", icon: "percent" },
  { to: "/blog", label: "Blog", icon: "book" },
  { to: "/soporte", label: "Soporte", icon: "support" },
];

function SearchBox({ onDone }: { onDone?: () => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<ProductSummary[]>([]);
  const [active, setActive] = useState(-1);
  const debounced = useDebounced(q.trim(), 220);
  const navigate = useNavigate();
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (debounced.length < 2) {
      setHits([]);
      return;
    }
    let alive = true;
    api
      .get<{ items: ProductSummary[] }>(`/api/catalog/products${qs({ q: debounced, pageSize: 6 })}`)
      .then((r) => alive && setHits(r.items))
      .catch(() => alive && setHits([]));
    return () => {
      alive = false;
    };
  }, [debounced]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const go = (path: string) => {
    setOpen(false);
    setQ("");
    onDone?.();
    navigate(path);
  };

  return (
    <div className="search" ref={boxRef}>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (active >= 0 && hits[active]) go(`/producto/${hits[active].slug}`);
          else if (q.trim()) go(`/productos${qs({ q: q.trim() })}`);
        }}
      >
        <div className="input-wrap">
          <Icon name="search" />
          <input
            className="input"
            type="search"
            placeholder="¿Qué servicio buscas?"
            aria-label="Buscar productos"
            value={q}
            maxLength={80}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
              setActive(-1);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, hits.length - 1));
              if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, -1));
              if (e.key === "Escape") setOpen(false);
            }}
          />
        </div>
      </form>
      {open && debounced.length >= 2 && (
        <div className="search-pop" role="listbox">
          {hits.length === 0 ? (
            <p className="faint" style={{ padding: 12, fontSize: 13 }}>
              Sin resultados para «{debounced}».
            </p>
          ) : (
            <>
              {hits.map((h, i) => (
                <button key={h.id} className="search-hit" role="option" aria-selected={i === active} style={{ width: "100%", textAlign: "left" }} onClick={() => go(`/producto/${h.slug}`)}>
                  <ProductArt glyph={h.artGlyph} color={h.artColor} imageUrl={h.imageUrl} showName={false} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ display: "block", fontSize: 14 }}>{h.name}</strong>
                    <span className="faint" style={{ fontSize: 12 }}>
                      {h.categoryName} · {h.summary}
                    </span>
                  </span>
                  <span className="price num" style={{ fontSize: 14 }}>
                    {formatCOP(h.price)}
                  </span>
                </button>
              ))}
              <button className="btn btn-ghost btn-sm btn-block" onClick={() => go(`/productos${qs({ q: debounced })}`)}>
                Ver todos los resultados <Icon name="arrow-right" />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { user, logout } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  if (!user) return null;
  return (
    <div style={{ position: "relative" }} ref={ref}>
      <button className="user-chip" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">
        <span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span>
        <span className="hide-tablet">{user.name.split(" ")[0]}</span>
        <Icon name="chevron-down" size={15} />
      </button>
      {open && (
        <div className="menu-pop" role="menu" onClick={() => setOpen(false)}>
          <Link to="/cuenta" role="menuitem">
            <Icon name="user" /> Mi cuenta
          </Link>
          <Link to="/cuenta/pedidos" role="menuitem">
            <Icon name="package" /> Mis pedidos
          </Link>
          <Link to="/cuenta/billetera" role="menuitem">
            <Icon name="wallet" /> Billetera
          </Link>
          {user.role === "admin" && (
            <Link to="/admin" role="menuitem">
              <Icon name="dashboard" /> Panel administrador
            </Link>
          )}
          <button
            role="menuitem"
            onClick={async () => {
              await logout();
              navigate("/");
            }}
          >
            <Icon name="logout" /> Cerrar sesión
          </button>
        </div>
      )}
    </div>
  );
}

export function Header() {
  const { user, ready } = useSession();
  const cart = useCart();
  const [drawer, setDrawer] = useState(false);
  const closeDrawer = useCallback(() => setDrawer(false), []);
  const location = useLocation();
  useEffect(() => {
    setDrawer(false);
  }, [location.pathname]);

  return (
    <header className="site-header">
      <div className="container header-row">
        <button className="icon-btn only-mobile" onClick={() => setDrawer(true)} aria-label="Abrir menú">
          <Icon name="menu" />
        </button>
        <Logo />
        <SearchBox />
        <div className="header-actions">
          {user && <NotificationBell scope="user" />}
          <Link to="/carrito" className="icon-btn" aria-label={`Carrito, ${cart.count} productos`}>
            <Icon name="cart" />
            {cart.count > 0 && <span className="count-dot">{cart.count}</span>}
          </Link>
          {ready && (user ? <UserMenu /> : (
            <Link to="/ingresar" className="btn btn-primary btn-sm">
              Iniciar sesión
            </Link>
          ))}
        </div>
      </div>
      <div className="container mobile-search">
        <SearchBox />
      </div>
      <div className="container">
        <nav className="main-nav" aria-label="Principal">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}>
              {n.label}
            </NavLink>
          ))}
        </nav>
      </div>
      <Drawer open={drawer} onClose={closeDrawer} label="Menú">
            <div className="drawer-head">
              <Logo />
              <button className="icon-btn" onClick={closeDrawer} aria-label="Cerrar menú">
                <Icon name="x" />
              </button>
            </div>
            {ready && !user && (
              <div className="drawer-cta">
                <Link to="/ingresar" className="btn btn-primary btn-block">Iniciar sesión</Link>
                <Link to="/registro" className="btn btn-outline btn-block">Crear cuenta</Link>
              </div>
            )}
            {user && (
              <Link to="/cuenta" className="drawer-user">
                <span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span>
                <span>
                  <strong>{user.name}</strong>
                  <small>{user.email}</small>
                </span>
              </Link>
            )}
            <nav>
              {NAV.map((n) => (
                <NavLink key={n.to} to={n.to} end={n.end}>
                  <Icon name={n.icon} /> {n.label}
                </NavLink>
              ))}
              {user && (
                <NavLink to="/cuenta">
                  <Icon name="user" /> Mi cuenta
                </NavLink>
              )}
              {user?.role === "admin" && (
                <NavLink to="/admin">
                  <Icon name="dashboard" /> Panel administrador
                </NavLink>
              )}
            </nav>
            <div className="drawer-foot">
              <Link to="/carrito"><Icon name="cart" /> Carrito{cart.count > 0 ? ` (${cart.count})` : ""}</Link>
              <Link to="/soporte"><Icon name="headphones" /> Soporte</Link>
            </div>
      </Drawer>
    </header>
  );
}

export function Footer() {
  const store = useStore();
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div>
          <Logo />
          <p className="muted" style={{ marginTop: 16, maxWidth: 320, fontSize: 14 }}>
            Productos digitales con entrega inmediata, pagos verificados y soporte cuando lo necesites.
          </p>
        </div>
        <div>
          <h4>Tienda</h4>
          <ul>
            <li><Link to="/productos">Todos los productos</Link></li>
            <li><Link to="/categorias">Categorías</Link></li>
            <li><Link to="/promociones">Promociones</Link></li>
            <li><Link to="/blog">Blog</Link></li>
          </ul>
        </div>
        <div>
          <h4>Tu cuenta</h4>
          <ul>
            <li><Link to="/cuenta">Mi cuenta</Link></li>
            <li><Link to="/cuenta/pedidos">Mis pedidos</Link></li>
            <li><Link to="/carrito">Carrito</Link></li>
          </ul>
        </div>
        <div>
          <h4>Ayuda</h4>
          <ul>
            <li><Link to="/soporte">Centro de soporte</Link></li>
            <li><Link to="/terminos">Términos y condiciones</Link></li>
            <li><Link to="/privacidad">Privacidad</Link></li>
            {store?.store.supportEmail && <li><a href={`mailto:${store.store.supportEmail}`}>{store.store.supportEmail}</a></li>}
          </ul>
        </div>
      </div>
      <div className="container footer-bottom">
        <span>© {new Date().getFullYear()} NexiStore. Todos los derechos reservados.</span>
        <span>Precios en pesos colombianos (COP), impuestos incluidos.</span>
      </div>
    </footer>
  );
}

function TabBar() {
  const cart = useCart();
  const { user } = useSession();
  return (
    <nav className="tabbar" aria-label="Navegación inferior">
      <NavLink to="/" end><Icon name="home" />Inicio</NavLink>
      <NavLink to="/categorias"><Icon name="tags" />Categorías</NavLink>
      <NavLink to="/promociones"><Icon name="percent" />Ofertas</NavLink>
      <NavLink to="/carrito" style={{ position: "relative" }}>
        <Icon name="cart" />Carrito
        {cart.count > 0 && <span className="count-dot">{cart.count}</span>}
      </NavLink>
      <NavLink to={user ? "/cuenta" : "/ingresar"}><Icon name="user" />Cuenta</NavLink>
    </nav>
  );
}

export function ShopLayout() {
  const { pathname } = useLocation();
  const store = useStore();
  const premium = (document.documentElement.dataset.style ?? store?.theme?.style) === "premium";
  usePremiumEffects(premium, pathname);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  useEffect(() => {
    document.body.classList.add("has-tabbar");
    return () => document.body.classList.remove("has-tabbar");
  }, []);
  return (
    <>
      <a href="#main" className="sr-only">Saltar al contenido</a>
      {premium && <div className="scroll-progress" aria-hidden="true" />}
      <Header />
      <main id="main">
        <div key={pathname} className="page-enter">
          <Outlet />
        </div>
      </main>
      <Footer />
      <TabBar />
    </>
  );
}
