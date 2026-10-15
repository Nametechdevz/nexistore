import { useEffect, useState } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Icon } from "../../components/Icon";
import { Empty, Logo, Spinner } from "../../components/ui";
import { useSession } from "../../lib/state";

const ITEMS = [
  { to: "/admin", label: "Dashboard", icon: "dashboard", end: true },
  { to: "/admin/productos", label: "Productos", icon: "box" },
  { to: "/admin/categorias", label: "Categorías", icon: "tags" },
  { to: "/admin/pedidos", label: "Pedidos", icon: "package" },
  { to: "/admin/clientes", label: "Clientes", icon: "users" },
  { to: "/admin/cupones", label: "Cupones", icon: "ticket" },
  { to: "/admin/contenido", label: "Blog / Contenido", icon: "book" },
  { to: "/admin/soporte", label: "Soporte", icon: "headphones" },
  { to: "/admin/reportes", label: "Reportes", icon: "chart" },
  { to: "/admin/configuracion", label: "Configuración", icon: "settings" },
];

export function AdminLayout() {
  const { user, ready, logout } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const [drawer, setDrawer] = useState(false);
  useEffect(() => setDrawer(false), [location.pathname]);
  useEffect(() => window.scrollTo(0, 0), [location.pathname]);

  if (!ready) return <div style={{ display: "grid", placeItems: "center", minHeight: "100vh" }}><Spinner /></div>;
  if (!user) return <Navigate to={`/ingresar?next=${encodeURIComponent(location.pathname)}`} replace />;
  if (user.role !== "admin")
    return (
      <div className="container">
        <Empty icon="lock" title="Acceso restringido" text="Esta sección es solo para administradores." action={<Link className="btn btn-primary" to="/">Volver a la tienda</Link>} />
      </div>
    );

  const nav = (
    <>
      {ITEMS.map((i) => (
        <NavLink key={i.to} to={i.to} end={i.end}>
          <Icon name={i.icon} /> {i.label}
        </NavLink>
      ))}
      <div className="sep" />
      <Link to="/"><Icon name="bag" /> Ver tienda</Link>
      <button
        onClick={async () => {
          await logout();
          navigate("/");
        }}
        style={{ color: "var(--accent-hover)" }}
      >
        <Icon name="logout" /> Cerrar sesión
      </button>
    </>
  );

  return (
    <>
      <header className="site-header">
        <div className="container header-row" style={{ maxWidth: 1440 }}>
          <button className="icon-btn only-mobile" onClick={() => setDrawer(true)} aria-label="Abrir menú">
            <Icon name="menu" />
          </button>
          <Logo to="/admin" sub="PANEL ADMIN" />
          <div className="header-actions">
            <span className="user-chip">
              <span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span>
              <span className="hide-tablet">{user.name}</span>
            </span>
          </div>
        </div>
      </header>
      <div className="container dash" style={{ maxWidth: 1440 }}>
        <nav className="dash-nav" aria-label="Administración" style={{ top: 92 }}>{nav}</nav>
        <main style={{ minWidth: 0 }}>
          <Outlet />
        </main>
      </div>
      {drawer && (
        <>
          <div className="drawer-backdrop" onClick={() => setDrawer(false)} />
          <aside className="drawer" aria-label="Menú de administración">
            <Logo to="/admin" sub="PANEL ADMIN" />
            <nav className="dash-nav" style={{ display: "grid", position: "static" }}>{nav}</nav>
          </aside>
        </>
      )}
    </>
  );
}
