import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, setCsrfToken } from "./api";
import { CART_MAX_QTY } from "../../../shared/constants";
import type { CampaignSettings } from "../../../shared/schemas";
import type { CartLine, PaymentMethodInfo, SessionUser } from "../../../shared/types";

/* ---------------- Toasts ---------------- */

export interface Toast {
  id: number;
  kind: "success" | "error" | "info";
  text: string;
}
const ToastCtx = createContext<(kind: Toast["kind"], text: string) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

/* ---------------- Sesión ---------------- */

interface SessionState {
  user: SessionUser | null;
  ready: boolean;
  googleEnabled: boolean;
  refresh: () => Promise<SessionUser | null>;
  logout: () => Promise<void>;
}
const SessionCtx = createContext<SessionState>(null as unknown as SessionState);
export const useSession = () => useContext(SessionCtx);

/* ---------------- Tienda (campaña y pagos) ---------------- */

export interface StoreInfo {
  campaign: CampaignSettings;
  store: { storeName: string; supportEmail: string; supportWhatsapp: string; manualPaymentInstructions: string };
  paymentMethods: PaymentMethodInfo[];
  unavailableMethods: { id: string; label: string; reason: string }[];
}
const StoreCtx = createContext<StoreInfo | null>(null);
export const useStore = () => useContext(StoreCtx);

/* ---------------- Carrito ---------------- */

interface CartState {
  lines: CartLine[];
  count: number;
  coupon: string;
  setCoupon: (code: string) => void;
  add: (productId: number, quantity?: number, max?: number) => void;
  setQty: (productId: number, quantity: number) => void;
  remove: (productId: number) => void;
  clear: () => void;
  syncFromServer: () => Promise<void>;
}
const CartCtx = createContext<CartState>(null as unknown as CartState);
export const useCart = () => useContext(CartCtx);

const CART_KEY = "nx_cart";
const COUPON_KEY = "nx_coupon";
const CART_OWNER_KEY = "nx_cart_owner";

function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeLocal(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* almacenamiento no disponible */
  }
}
const sanitize = (lines: unknown): CartLine[] =>
  Array.isArray(lines)
    ? lines
        .filter((l) => l && Number.isInteger(l.productId) && Number.isInteger(l.quantity) && l.quantity > 0)
        .map((l) => ({ productId: l.productId, quantity: Math.min(l.quantity, CART_MAX_QTY) }))
    : [];

export function AppProviders({ children }: { children: ReactNode }) {
  /* Toasts */
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toast = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  /* Sesión */
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const refresh = useCallback(async () => {
    const me = await api.get<{ user: SessionUser | null; csrfToken: string; googleEnabled: boolean }>("/api/auth/me").catch(() => null);
    setCsrfToken(me?.csrfToken);
    setUser(me?.user ?? null);
    setGoogleEnabled(Boolean(me?.googleEnabled));
    setReady(true);
    return me?.user ?? null;
  }, []);

  /* Tienda */
  const [store, setStore] = useState<StoreInfo | null>(null);
  useEffect(() => {
    void refresh();
    api.get<StoreInfo>("/api/catalog/store").then(setStore).catch(() => undefined);
  }, [refresh]);

  /* Carrito: localStorage siempre; además en servidor si hay sesión. */
  const [lines, setLines] = useState<CartLine[]>(() => sanitize(readLocal(CART_KEY, [])));
  const [coupon, setCouponState] = useState<string>(() => readLocal(COUPON_KEY, ""));
  const userRef = useRef(user);
  userRef.current = user;
  const pushTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const persist = useCallback((next: CartLine[]) => {
    writeLocal(CART_KEY, next);
    if (userRef.current) {
      clearTimeout(pushTimer.current);
      pushTimer.current = setTimeout(() => {
        api.put("/api/cart", { items: next, mode: "replace" }).catch(() => undefined);
      }, 400);
    }
  }, []);

  const update = useCallback(
    (fn: (prev: CartLine[]) => CartLine[]) => {
      setLines((prev) => {
        const next = fn(prev);
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const syncFromServer = useCallback(async () => {
    const uid = userRef.current?.id;
    if (!uid) return;
    const owner = readLocal<number | null>(CART_OWNER_KEY, null);
    const local = sanitize(readLocal(CART_KEY, []));
    // Carrito de invitado → se fusiona con el de la cuenta. Si ya pertenece a la cuenta, manda el servidor.
    const res =
      owner === uid
        ? await api.get<{ items: CartLine[] }>("/api/cart").catch(() => null)
        : await api.put<{ items: CartLine[] }>("/api/cart", { items: local, mode: "merge" }).catch(() => null);
    if (res) {
      setLines(res.items);
      writeLocal(CART_KEY, res.items);
      writeLocal(CART_OWNER_KEY, uid);
    }
  }, []);

  const prevUserId = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    if (!ready) return;
    const id = user?.id ?? null;
    if (prevUserId.current !== undefined && prevUserId.current !== null && id === null) {
      // Cerró sesión: se limpia el carrito local.
      setLines([]);
      writeLocal(CART_KEY, []);
      writeLocal(CART_OWNER_KEY, null);
    }
    if (id !== null && prevUserId.current !== id) void syncFromServer();
    prevUserId.current = id;
  }, [user, ready, syncFromServer]);

  const cart = useMemo<CartState>(
    () => ({
      lines,
      count: lines.reduce((n, l) => n + l.quantity, 0),
      coupon,
      setCoupon: (code) => {
        setCouponState(code);
        writeLocal(COUPON_KEY, code);
      },
      add: (productId, quantity = 1, max = CART_MAX_QTY) =>
        update((prev) => {
          const found = prev.find((l) => l.productId === productId);
          const limit = Math.min(max, CART_MAX_QTY);
          if (found) return prev.map((l) => (l.productId === productId ? { ...l, quantity: Math.min(l.quantity + quantity, limit) } : l));
          return [...prev, { productId, quantity: Math.min(quantity, limit) }];
        }),
      setQty: (productId, quantity) =>
        update((prev) => prev.map((l) => (l.productId === productId ? { ...l, quantity: Math.max(1, Math.min(quantity, CART_MAX_QTY)) } : l))),
      remove: (productId) => update((prev) => prev.filter((l) => l.productId !== productId)),
      clear: () => update(() => []),
      syncFromServer,
    }),
    [lines, coupon, update, syncFromServer],
  );

  const logout = useCallback(async () => {
    await api.post("/api/auth/logout").catch(() => undefined);
    await refresh();
  }, [refresh]);

  const session = useMemo(() => ({ user, ready, googleEnabled, refresh, logout }), [user, ready, googleEnabled, refresh, logout]);

  return (
    <ToastCtx.Provider value={toast}>
      <SessionCtx.Provider value={session}>
        <StoreCtx.Provider value={store}>
          <CartCtx.Provider value={cart}>
            {children}
            <div className="toasts" role="status" aria-live="polite">
              {toasts.map((t) => (
                <div key={t.id} className={`toast ${t.kind}`}>
                  <ToastIcon kind={t.kind} />
                  <span>{t.text}</span>
                </div>
              ))}
            </div>
          </CartCtx.Provider>
        </StoreCtx.Provider>
      </SessionCtx.Provider>
    </ToastCtx.Provider>
  );
}

function ToastIcon({ kind }: { kind: Toast["kind"] }) {
  return kind === "success" ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M20 6 9 17l-5-5" /></svg>
  ) : kind === "error" ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
  );
}
