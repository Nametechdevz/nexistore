import "@fontsource-variable/manrope";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/hero.css";
import "./styles/premium.css";

import { lazy, StrictMode, Suspense, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Outlet, RouterProvider, useRouteError } from "react-router-dom";
import { ShopLayout } from "./components/Layout";
import { AppProviders } from "./lib/state";
import { ForgotPage, LoginPage, RegisterPage, ResetPage } from "./pages/Auth";
import { CatalogPage, CategoriesPage } from "./pages/Catalog";
import { CartPage, CheckoutPage, ConfirmationPage } from "./pages/Checkout";
import { BlogPage, BlogPostPage, LegalPage, NotFoundPage, PublicSupportPage } from "./pages/Content";
import { HomePage } from "./pages/Home";
import { ProductPage } from "./pages/Product";
import { AccountLayout } from "./pages/account/AccountLayout";
import {
  AccountOverview, AddressesPage, CouponsPage, OrderDetailPage, OrdersPage, PaymentMethodsPage, ProfilePage,
} from "./pages/account/AccountPages";
import { SupportPage, TicketPage, WalletPage } from "./pages/account/AccountExtra";
import { Spinner } from "./components/ui";

// El panel administrativo se carga bajo demanda: no pesa en la tienda pública.
const adminPage = (name: string) =>
  lazy(async () => {
    const [layout, cat, ops, extra] = await Promise.all([
      import("./pages/admin/AdminLayout"),
      import("./pages/admin/AdminCatalog"),
      import("./pages/admin/AdminOps"),
      import("./pages/admin/AdminExtra"),
    ]);
    const all = { ...layout, ...cat, ...ops, ...extra } as unknown as Record<string, ComponentType>;
    return { default: all[name]! };
  });
const Admin = (name: string) => {
  const C = adminPage(name);
  return (
    <Suspense fallback={<div style={{ display: "grid", placeItems: "center", minHeight: 300 }}><Spinner /></div>}>
      <C />
    </Suspense>
  );
};

/** Pantalla de error propia (en lugar de la de desarrollo de React Router). */
function AppError() {
  const err = useRouteError() as { message?: string } | undefined;
  // Tras una actualización, los archivos antiguos del panel ya no existen: basta con recargar.
  const stale = /dynamically imported module|Importing a module script failed|Loading chunk/i.test(err?.message ?? "");
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "var(--bg)", color: "var(--text)" }}>
      <div style={{ maxWidth: 440, textAlign: "center", display: "grid", gap: 14 }}>
        <h1 style={{ fontSize: 24 }}>{stale ? "Hay una versión nueva de la tienda" : "Algo salió mal"}</h1>
        <p className="muted">{stale ? "Recarga la página para continuar." : "Ocurrió un error inesperado al mostrar esta página. Recarga para intentarlo de nuevo."}</p>
        {!stale && err?.message && <code style={{ fontSize: 12, opacity: 0.6, wordBreak: "break-word" }}>{err.message}</code>}
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>Recargar</button>
          <a className="btn btn-outline" href="/">Ir al inicio</a>
        </div>
      </div>
    </div>
  );
}

const router = createBrowserRouter([
  {
    errorElement: <AppError />,
    element: (
      <AppProviders>
        <Outlet />
      </AppProviders>
    ),
    children: [
      {
        element: <ShopLayout />,
        children: [
          { path: "/", element: <HomePage /> },
          { path: "/productos", element: <CatalogPage mode="all" /> },
          { path: "/promociones", element: <CatalogPage mode="deals" /> },
          { path: "/categorias", element: <CategoriesPage /> },
          { path: "/categorias/:slug", element: <CatalogPage mode="category" /> },
          { path: "/producto/:slug", element: <ProductPage /> },
          { path: "/carrito", element: <CartPage /> },
          { path: "/checkout", element: <CheckoutPage /> },
          { path: "/pedido/:code/confirmacion", element: <ConfirmationPage /> },
          { path: "/blog", element: <BlogPage /> },
          { path: "/blog/:slug", element: <BlogPostPage /> },
          { path: "/soporte", element: <PublicSupportPage /> },
          { path: "/terminos", element: <LegalPage kind="terms" /> },
          { path: "/privacidad", element: <LegalPage kind="privacy" /> },
          {
            path: "/cuenta",
            element: <AccountLayout />,
            children: [
              { index: true, element: <AccountOverview /> },
              { path: "pedidos", element: <OrdersPage /> },
              { path: "pedidos/:code", element: <OrderDetailPage /> },
              { path: "datos", element: <ProfilePage /> },
              { path: "direcciones", element: <AddressesPage /> },
              { path: "pagos", element: <PaymentMethodsPage /> },
              { path: "cupones", element: <CouponsPage /> },
              { path: "soporte", element: <SupportPage /> },
              { path: "soporte/:id", element: <TicketPage /> },
              { path: "billetera", element: <WalletPage /> },
            ],
          },
          { path: "*", element: <NotFoundPage /> },
        ],
      },
      { path: "/ingresar", element: <LoginPage /> },
      { path: "/registro", element: <RegisterPage /> },
      { path: "/recuperar", element: <ForgotPage /> },
      { path: "/restablecer/:token", element: <ResetPage /> },
      {
        path: "/admin",
        element: Admin("AdminLayout"),
        children: [
          { index: true, element: Admin("AdminDashboard") },
          { path: "productos", element: Admin("AdminProducts") },
          { path: "categorias", element: Admin("AdminCategories") },
          { path: "pedidos", element: Admin("AdminOrders") },
          { path: "pedidos/:code", element: Admin("AdminOrderDetail") },
          { path: "clientes", element: Admin("AdminCustomers") },
          { path: "cupones", element: Admin("AdminCoupons") },
          { path: "contenido", element: Admin("AdminContent") },
          { path: "soporte", element: Admin("AdminTickets") },
          { path: "soporte/:id", element: Admin("AdminTicketDetail") },
          { path: "inventario", element: Admin("AdminInventory") },
          { path: "billetera", element: Admin("AdminWallet") },
          { path: "reportes", element: Admin("AdminReports") },
          { path: "configuracion", element: Admin("AdminSettings") },
        ],
      },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
