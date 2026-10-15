import { NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Icon } from "../../components/Icon";
import { Spinner } from "../../components/ui";
import { useSession } from "../../lib/state";

const ITEMS = [
  { to: "/cuenta", label: "Inicio", icon: "home", end: true },
  { to: "/cuenta/pedidos", label: "Mis pedidos", icon: "package" },
  { to: "/cuenta/datos", label: "Mis datos", icon: "user" },
  { to: "/cuenta/direcciones", label: "Direcciones", icon: "pin" },
  { to: "/cuenta/pagos", label: "Métodos de pago", icon: "wallet" },
  { to: "/cuenta/cupones", label: "Cupones", icon: "ticket" },
  { to: "/cuenta/soporte", label: "Soporte", icon: "headphones" },
];

export function AccountLayout() {
  const { user, ready, logout } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  if (!ready) return <div style={{ display: "grid", placeItems: "center", minHeight: 320 }}><Spinner /></div>;
  if (!user) return <Navigate to={`/ingresar?next=${encodeURIComponent(location.pathname)}`} replace />;

  return (
    <div className="container dash">
      <nav className="dash-nav" aria-label="Mi cuenta">
        <div className="dash-profile">
          <span className="avatar avatar-lg">{user.name.slice(0, 1).toUpperCase()}</span>
          <strong>{user.name}</strong>
          <span>{user.email}</span>
        </div>
        {ITEMS.map((i) => (
          <NavLink key={i.to} to={i.to} end={i.end}>
            <Icon name={i.icon} /> {i.label}
          </NavLink>
        ))}
        {user.role === "admin" && (
          <NavLink to="/admin">
            <Icon name="dashboard" /> Panel administrador
          </NavLink>
        )}
        <div className="sep" />
        <button
          onClick={async () => {
            await logout();
            navigate("/");
          }}
        >
          <Icon name="logout" /> Cerrar sesión
        </button>
      </nav>
      <div style={{ minWidth: 0 }}>
        <nav className="dash-mobile-nav" aria-label="Mi cuenta">
          {ITEMS.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end}>
              <Icon name={i.icon} /> {i.label}
            </NavLink>
          ))}
        </nav>
        <div style={{ marginTop: 4 }}>
          <Outlet />
        </div>
      </div>
    </div>
  );
}
