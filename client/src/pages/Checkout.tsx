import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Icon } from "../components/Icon";
import { Alert, Check, Empty, ErrorState, ProductArt, QtyStepper, Skeleton, Spinner, StatusBadge, SubmitButton, TextArea, TextField } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { formatCOP, PROVIDER_LABEL } from "../lib/format";
import { useDocumentTitle, useForm, useQuery } from "../lib/hooks";
import { useCart, useSession, useStore, useToast } from "../lib/state";
import { checkoutSchema } from "../../../shared/schemas";
import type { Order, ProductSummary } from "../../../shared/types";

interface Quote {
  items: { product: ProductSummary; quantity: number; available: boolean; lineTotal: number }[];
  removed: number[];
  coupon: { code: string; kind: string; value: number } | null;
  couponError: string | null;
  subtotal: number;
  discount: number;
  total: number;
}

const STEPS = ["Carrito", "Datos", "Pago", "Confirmación"];

export function Steps({ current }: { current: number }) {
  return (
    <ol className="steps" aria-label="Progreso de compra">
      {STEPS.map((s, i) => (
        <li key={s} className={`step${i < current ? " is-done" : ""}${i === current ? " is-current" : ""}`} aria-current={i === current ? "step" : undefined}>
          <span className="step-dot">{i < current ? <Icon name="check" size={15} /> : i + 1}</span>
          {s}
        </li>
      ))}
    </ol>
  );
}

const PAY_COLORS: Record<string, string> = {
  wallet: "#e3122c",
  mercadopago: "#00a6e0",
  wompi: "#1f1f6b",
  manual: "#7c3aed",
  paypal: "#1d4ed8",
  zenobank: "#7c5cff",
};
const PAY_SHORT: Record<string, string> = { wallet: "$", mercadopago: "MP", wompi: "W", manual: "TR", paypal: "PP", zenobank: "₿" };

function PaymentLogos() {
  const store = useStore();
  if (!store) return null;
  return (
    <div>
      <p className="label" style={{ marginTop: 24 }}>Métodos de pago</p>
      <div className="pay-logos">
        {store.paymentMethods.map((m) => (
          <span key={m.id} className="pay-logo" style={{ background: PAY_COLORS[m.id], opacity: m.configured ? 1 : 0.35 }} title={m.configured ? m.label : `${m.label} — ${m.pendingReason}`}>
            {PAY_SHORT[m.id]}
          </span>
        ))}
        {store.unavailableMethods.map((m) => (
          <span key={m.id} className="pay-logo" style={{ background: PAY_COLORS[m.id], opacity: 0.35 }} title={`${m.label} — ${m.reason}`}>
            {PAY_SHORT[m.id]}
          </span>
        ))}
      </div>
    </div>
  );
}

function useQuote(couponOverride?: string) {
  const cart = useCart();
  const code = couponOverride ?? cart.coupon;
  const key = JSON.stringify(cart.lines) + code;
  return useQuery(() => (cart.lines.length ? api.post<Quote>("/api/cart/quote", { items: cart.lines, couponCode: code || "" }) : Promise.resolve(null)), [key]);
}

function Summary({ quote, children, showCoupon }: { quote: Quote; children?: React.ReactNode; showCoupon?: boolean }) {
  const cart = useCart();
  const [code, setCode] = useState(cart.coupon);
  return (
    <aside className="summary" aria-label="Resumen de compra">
      <h3>Resumen de compra</h3>
      {showCoupon && (
        <form
          className="coupon-row"
          onSubmit={(e) => {
            e.preventDefault();
            cart.setCoupon(code.trim().toUpperCase());
          }}
        >
          <label className="sr-only" htmlFor="coupon">Cupón</label>
          <input id="coupon" className="input" placeholder="Cupón de descuento" value={code} maxLength={40} onChange={(e) => setCode(e.target.value)} />
          <button className="btn btn-soft" type="submit">Aplicar</button>
        </form>
      )}
      {showCoupon && quote.couponError && cart.coupon && (
        <p className="field-error" style={{ marginBottom: 12 }}>
          <Icon name="alert" size={13} /> {quote.couponError}{" "}
          <button className="text-accent" onClick={() => { cart.setCoupon(""); setCode(""); }}>Quitar</button>
        </p>
      )}
      {quote.coupon && (
        <p className="hint" style={{ marginBottom: 8 }}>
          Cupón <strong>{quote.coupon.code}</strong> aplicado.{" "}
          {showCoupon && <button className="text-accent" onClick={() => { cart.setCoupon(""); setCode(""); }}>Quitar</button>}
        </p>
      )}
      <div className="sum-row"><span>Subtotal</span><span>{formatCOP(quote.subtotal)}</span></div>
      {quote.discount > 0 && <div className="sum-row discount"><span>Descuento</span><span>-{formatCOP(quote.discount)}</span></div>}
      <div className="sum-total"><span>Total</span><span>{formatCOP(quote.total)}</span></div>
      {children}
    </aside>
  );
}

export function CartPage() {
  useDocumentTitle("Carrito");
  const cart = useCart();
  const { user } = useSession();
  const navigate = useNavigate();
  const { data: quote, loading, error, reload } = useQuote();

  // Elimina del carrito productos que ya no existen o fueron desactivados.
  useEffect(() => {
    if (quote?.removed.length) quote.removed.forEach((id) => cart.remove(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote?.removed.join(",")]);

  if (!cart.lines.length)
    return (
      <div className="container section">
        <Steps current={0} />
        <Empty icon="cart" title="Tu carrito está vacío" text="Explora el catálogo y agrega tus productos favoritos." action={<Link className="btn btn-primary" to="/productos">Explorar productos</Link>} />
      </div>
    );

  const unavailable = quote?.items.some((i) => !i.available);

  return (
    <div className="container section" style={{ paddingTop: 32 }}>
      <Steps current={0} />
      <div className="checkout">
        <section>
          <h1 className="page-title" style={{ fontSize: "var(--fs-xl)" }}>Tu carrito</h1>
          <p className="eyebrow num">{cart.count} producto{cart.count === 1 ? "" : "s"}</p>
          {error && <ErrorState message={error.message} onRetry={reload} />}
          {loading && !quote && <div style={{ display: "grid", gap: 12, marginTop: 16 }}><Skeleton h={88} /><Skeleton h={88} /></div>}
          <div style={{ marginTop: 8 }}>
            {quote?.items.map(({ product: p, quantity, available, lineTotal }) => (
              <div key={p.id} className="line-item">
                <Link to={`/producto/${p.slug}`}><ProductArt glyph={p.artGlyph} color={p.artColor} imageUrl={p.imageUrl} showName={false} /></Link>
                <div style={{ minWidth: 0 }}>
                  <Link to={`/producto/${p.slug}`} style={{ fontWeight: 700 }}>{p.name}</Link>
                  <p className="pcard-meta">{p.summary}</p>
                  <p className="price num" style={{ fontSize: 16 }}>{formatCOP(p.price)}</p>
                  {!available && <p className="field-error">Solo quedan {p.stock} unidades disponibles.</p>}
                </div>
                <div className="line-item-end">
                  <QtyStepper value={quantity} onChange={(v) => cart.setQty(p.id, v)} max={Math.max(1, Math.min(p.maxPerOrder, p.stock))} label={p.name} />
                  <span className="num hide-tablet" style={{ minWidth: 90, textAlign: "right", fontWeight: 700 }}>{formatCOP(lineTotal)}</span>
                  <button className="icon-btn btn-danger" onClick={() => cart.remove(p.id)} aria-label={`Eliminar ${p.name}`}>
                    <Icon name="trash" />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <Link to="/productos" className="btn btn-ghost" style={{ marginTop: 16 }}>
            <Icon name="arrow-left" /> Seguir comprando
          </Link>
        </section>
        {quote && (
          <Summary quote={quote} showCoupon>
            {unavailable && <Alert kind="warning">Ajusta las cantidades: algunos productos no tienen inventario suficiente.</Alert>}
            <button
              className="btn btn-primary btn-lg btn-block"
              style={{ marginTop: 20 }}
              disabled={unavailable || loading}
              onClick={() => navigate(user ? "/checkout" : "/ingresar?next=/checkout")}
            >
              Continuar al pago <Icon name="arrow-right" />
            </button>
            {!user && <p className="hint" style={{ marginTop: 10, textAlign: "center" }}>Inicia sesión o crea tu cuenta para finalizar la compra.</p>}
            <PaymentLogos />
          </Summary>
        )}
      </div>
    </div>
  );
}

const buyerStep = checkoutSchema.pick({ buyerName: true, buyerEmail: true, buyerPhone: true, buyerDocument: true, notes: true });

export function CheckoutPage() {
  useDocumentTitle("Finalizar compra");
  const { user, ready } = useSession();
  const cart = useCart();
  const store = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const { data: quote, loading } = useQuote();
  const wallet = useQuery(() => (user ? api.get<{ balance: number }>("/api/account/wallet") : Promise.resolve(null)), [user?.id]);
  const [step, setStep] = useState<1 | 2>(1);
  // Evita que, al vaciar el carrito tras crear el pedido, se redirija al carrito en lugar de la confirmación.
  const placed = useRef(false);
  const firstConfigured = useMemo(() => store?.paymentMethods.find((m) => m.configured && m.id !== "wallet")?.id, [store]);

  const form = useForm(checkoutSchema, {
    buyerName: user?.name ?? "",
    buyerEmail: user?.email ?? "",
    buyerPhone: user?.phone ?? "",
    buyerDocument: user?.documentId ?? "",
    paymentProvider: (user?.preferredPayment as "manual") ?? "manual",
    couponCode: cart.coupon,
    notes: "",
    acceptTerms: false as unknown as true,
  });

  useEffect(() => {
    if (user) form.setValues((v) => ({ ...v, buyerName: v.buyerName || user.name, buyerEmail: v.buyerEmail || user.email, buyerPhone: v.buyerPhone || user.phone || "", buyerDocument: v.buyerDocument || user.documentId || "" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);
  useEffect(() => {
    const pref = store?.paymentMethods.find((m) => m.id === user?.preferredPayment && m.configured);
    if (store) form.set("paymentProvider", (pref?.id ?? firstConfigured ?? "manual") as "manual");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  if (!ready) return null;
  if (!user) return <Navigate to="/ingresar?next=/checkout" replace />;
  if (!cart.lines.length && !placed.current) return <Navigate to="/carrito" replace />;

  const nextStep = (e: React.FormEvent) => {
    e.preventDefault();
    const res = buyerStep.safeParse(form.values);
    if (!res.success) {
      const errs: Record<string, string> = {};
      for (const i of res.error.issues) errs[String(i.path[0])] ??= i.message;
      form.setErrors(errs);
      return;
    }
    form.setErrors({});
    setStep(2);
    window.scrollTo({ top: 0 });
  };

  const pay = form.submit(async (data) => {
    // El servidor recalcula todo con su carrito persistido: se sincroniza antes de pagar.
    await api.put("/api/cart", { items: cart.lines, mode: "replace" });
    const res = await api.post<{ code: string; status?: string; action: { type: "redirect"; url: string } | { type: "instructions"; text: string } | null; warning?: string }>(
      "/api/checkout",
      { ...data, couponCode: cart.coupon || "" },
    );
    placed.current = true;
    cart.clear();
    cart.setCoupon("");
    if (res.warning) toast("error", res.warning);
    if (res.action?.type === "redirect") {
      window.location.assign(res.action.url);
      return;
    }
    navigate(`/pedido/${res.code}/confirmacion`, { replace: true });
  });

  const anyConfigured = store?.paymentMethods.some((m) => m.configured && (m.id !== "wallet" || (wallet.data?.balance ?? 0) >= (quote?.total ?? Infinity)));

  return (
    <div className="container section" style={{ paddingTop: 32 }}>
      <Steps current={step} />
      <div className="checkout">
        {step === 1 ? (
          <form className="form" onSubmit={nextStep} noValidate>
            <h1 className="page-title" style={{ fontSize: "var(--fs-xl)" }}>Datos del comprador</h1>
            <p className="muted" style={{ marginTop: -12 }}>Usaremos estos datos para la factura y para enviarte tu producto.</p>
            <div className="form-row">
              <TextField label="Nombre completo" value={form.values.buyerName} onValue={(v) => form.set("buyerName", v)} error={form.errors.buyerName} autoComplete="name" />
              <TextField label="Correo electrónico" type="email" value={form.values.buyerEmail} onValue={(v) => form.set("buyerEmail", v)} error={form.errors.buyerEmail} autoComplete="email" />
            </div>
            <div className="form-row">
              <TextField label="Celular" type="tel" value={form.values.buyerPhone} onValue={(v) => form.set("buyerPhone", v)} error={form.errors.buyerPhone} autoComplete="tel" placeholder="300 123 4567" />
              <TextField label="Documento de identidad" value={form.values.buyerDocument} onValue={(v) => form.set("buyerDocument", v)} error={form.errors.buyerDocument} inputMode="numeric" />
            </div>
            <TextArea label="Notas del pedido (opcional)" value={form.values.notes ?? ""} onValue={(v) => form.set("notes", v)} error={form.errors.notes} rows={3} hint="Por ejemplo, el número a recargar." maxLength={500} />
            <div style={{ display: "flex", gap: 12, justifyContent: "space-between", flexWrap: "wrap" }}>
              <Link to="/carrito" className="btn btn-ghost"><Icon name="arrow-left" /> Volver al carrito</Link>
              <button className="btn btn-primary btn-lg" type="submit">Continuar <Icon name="arrow-right" /></button>
            </div>
          </form>
        ) : (
          <form className="form" onSubmit={pay} noValidate>
            <h1 className="page-title" style={{ fontSize: "var(--fs-xl)" }}>Método de pago</h1>
            {form.formError && <Alert kind="error">{form.formError}</Alert>}
            {!anyConfigured && (
              <Alert kind="warning">
                Ningún método de pago está configurado todavía. El administrador debe agregar las credenciales de la pasarela para habilitar las compras.
              </Alert>
            )}
            <div className="pay-options" role="radiogroup" aria-label="Métodos de pago">
              {store?.paymentMethods.map((m) => {
                const total = quote?.total ?? 0;
                const walletShort = m.id === "wallet" && (wallet.data?.balance ?? 0) < total;
                const enabled = m.configured && !walletShort;
                const detail =
                  m.id === "wallet"
                    ? `Saldo disponible: ${formatCOP(wallet.data?.balance ?? 0)}${walletShort ? " · no alcanza para este pedido" : ""}`
                    : m.id === "zenobank" && m.configured && m.rate
                      ? `Pagarás ${(Math.ceil((total / m.rate) * 100) / 100).toFixed(2)} ${m.currency} en cripto (tasa ${formatCOP(m.rate)}/${m.currency})`
                      : m.configured
                        ? m.description
                        : m.pendingReason;
                return (
                  <label key={m.id} className={`pay-option${enabled ? "" : " is-disabled"}`}>
                    <input type="radio" name="pay" value={m.id} disabled={!enabled} checked={form.values.paymentProvider === m.id} onChange={() => form.set("paymentProvider", m.id)} />
                    <span className="pay-logo" style={{ background: PAY_COLORS[m.id] }}>{PAY_SHORT[m.id]}</span>
                    <span>
                      <strong style={{ display: "block" }}>{m.label}</strong>
                      <span className="faint" style={{ fontSize: 13 }}>{detail}</span>
                    </span>
                    {!m.configured ? <span className="status status-neutral">Pendiente</span> : walletShort ? <Link className="btn btn-ghost btn-sm" to="/cuenta/billetera">Recargar</Link> : null}
                  </label>
                );
              })}
              {store?.unavailableMethods.map((m) => (
                <div key={m.id} className="pay-option is-disabled" aria-disabled="true">
                  <input type="radio" disabled aria-label={m.label} />
                  <span className="pay-logo" style={{ background: PAY_COLORS[m.id] }}>{PAY_SHORT[m.id]}</span>
                  <span>
                    <strong style={{ display: "block" }}>{m.label}</strong>
                    <span className="faint" style={{ fontSize: 13 }}>{m.reason}</span>
                  </span>
                  <span className="status status-neutral">No disponible</span>
                </div>
              ))}
            </div>
            {form.errors.paymentProvider && <p className="field-error">{form.errors.paymentProvider}</p>}
            <div className="panel" style={{ padding: 16 }}>
              <p style={{ fontSize: 14 }}><strong>{form.values.buyerName}</strong> · {form.values.buyerEmail} · {form.values.buyerPhone}</p>
              <button type="button" className="text-accent" style={{ fontSize: 13 }} onClick={() => setStep(1)}>Editar datos</button>
            </div>
            <Check checked={Boolean(form.values.acceptTerms)} onChange={(v) => form.set("acceptTerms", v as true)} error={form.errors.acceptTerms}>
              Acepto los <Link to="/terminos" className="text-accent" target="_blank">términos y condiciones</Link> y la <Link to="/privacidad" className="text-accent" target="_blank">política de privacidad</Link>.
            </Check>
            <div style={{ display: "flex", gap: 12, justifyContent: "space-between", flexWrap: "wrap" }}>
              <button type="button" className="btn btn-ghost" onClick={() => setStep(1)}><Icon name="arrow-left" /> Volver</button>
              <SubmitButton loading={form.submitting} className="btn btn-primary btn-lg" disabled={!anyConfigured}>
                <Icon name="lock" /> Pagar {quote ? formatCOP(quote.total) : ""}
              </SubmitButton>
            </div>
            <p className="hint">Serás redirigido a la pasarela segura. Tu pedido se confirma solo cuando la pasarela verifica el pago.</p>
          </form>
        )}
        {quote ? (
          <Summary quote={quote}>
            <ul style={{ display: "grid", gap: 10, marginTop: 16 }}>
              {quote.items.map((i) => (
                <li key={i.product.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13 }}>
                  <span className="muted">{i.quantity} × {i.product.name}</span>
                  <span className="num">{formatCOP(i.lineTotal)}</span>
                </li>
              ))}
            </ul>
          </Summary>
        ) : loading ? (
          <Skeleton h={240} r={16} />
        ) : null}
      </div>
    </div>
  );
}

/* ---------- Confirmación / verificación del pago ---------- */

export function ConfirmationPage() {
  const { code = "" } = useParams();
  const [params] = useSearchParams();
  const location = useLocation();
  const store = useStore();
  const { user, ready } = useSession();
  useDocumentTitle(`Pedido ${code}`);
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [checking, setChecking] = useState(false);
  const attempts = useRef(0);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const urlParams = Object.fromEntries(params.entries());
    const tick = async () => {
      try {
        setChecking(true);
        const r = await api.post<{ order: Order; result: string }>(`/api/orders/${encodeURIComponent(code)}/verify-payment`, { params: urlParams });
        if (!alive) return;
        setOrder(r.order);
        attempts.current += 1;
        // Mientras la pasarela confirma, se reconsulta unas veces.
        if (r.order.status === "pending_payment" && r.order.paymentProvider !== "manual" && attempts.current < 6) timer = setTimeout(tick, 5000);
      } catch (e) {
        if (alive) setError(e instanceof ApiError ? e : new ApiError(0, "Error"));
      } finally {
        if (alive) setChecking(false);
      }
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, user]);

  if (ready && !user) return <Navigate to={`/ingresar?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (error) return <div className="container section"><ErrorState message={error.message} /></div>;
  if (!order) return <div className="container section" style={{ display: "grid", placeItems: "center", minHeight: 300 }}><Spinner /></div>;

  const paid = ["paid", "processing", "completed"].includes(order.status);
  const cancelled = ["cancelled", "refunded"].includes(order.status);
  const rejected = order.events?.some((e) => e.status === "payment_rejected") && order.status === "pending_payment";

  return (
    <div className="container section" style={{ paddingTop: 32, maxWidth: 820 }}>
      <Steps current={paid ? 4 : 3} />
      <div className="panel" style={{ textAlign: "center", padding: "40px 24px" }}>
        <div className="empty-icon" style={{ margin: "0 auto 16px", background: paid ? "var(--success-soft)" : cancelled || rejected ? "var(--danger-soft)" : "var(--warning-soft)", color: paid ? "var(--success)" : cancelled || rejected ? "var(--danger)" : "var(--warning)" }}>
          <Icon name={paid ? "check" : cancelled || rejected ? "x" : "clock"} />
        </div>
        <h1 className="page-title" style={{ fontSize: "var(--fs-xl)" }}>
          {paid ? "¡Pago confirmado!" : cancelled ? "Pedido cancelado" : rejected ? "El pago no fue aprobado" : "Pedido recibido"}
        </h1>
        <p className="muted" style={{ marginTop: 8 }}>
          Pedido <strong className="num">{order.code}</strong> · {formatCOP(order.total)}
          {order.paymentAmountForeign && ` (${order.paymentAmountForeign} ${order.paymentCurrency})`} · {PROVIDER_LABEL[order.paymentProvider]}
        </p>
        <div style={{ marginTop: 12 }}><StatusBadge status={order.status} /></div>
        <div style={{ maxWidth: 520, margin: "24px auto 0", textAlign: "left" }}>
          {order.status === "completed" && <Alert kind="success">¡Listo! Tus datos de acceso ya están disponibles en el detalle del pedido.</Alert>}
          {paid && order.status !== "completed" && <Alert kind="success">Estamos preparando tu entrega. Verás los datos de acceso en el detalle del pedido cuando esté completado.</Alert>}
          {!paid && !cancelled && order.paymentProvider === "manual" && (
            <Alert kind="info">
              <strong>Pago por transferencia.</strong> {store?.store.manualPaymentInstructions}
              <br />Valor exacto: <strong className="num">{formatCOP(order.total)}</strong> · Referencia: <strong className="num">{order.code}</strong>
            </Alert>
          )}
          {!paid && !cancelled && order.paymentProvider !== "manual" && !rejected && (
            <Alert kind="warning">
              {checking ? "Verificando el pago con la pasarela…" : "Aún no recibimos la confirmación de la pasarela. Si ya pagaste, puede tardar unos minutos; este estado se actualizará automáticamente."}
            </Alert>
          )}
          {rejected && <Alert kind="error">La pasarela rechazó el pago. Puedes intentarlo de nuevo desde el detalle del pedido.</Alert>}
        </div>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", marginTop: 28 }}>
          <Link className="btn btn-primary" to={`/cuenta/pedidos/${order.code}`}>Ver detalle del pedido</Link>
          <Link className="btn btn-outline" to="/productos">Seguir comprando</Link>
        </div>
      </div>
    </div>
  );
}

