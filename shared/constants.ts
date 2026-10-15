export const ORDER_STATUSES = [
  "pending_payment",
  "paid",
  "processing",
  "completed",
  "cancelled",
  "refunded",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending_payment: "Pendiente de pago",
  paid: "Pagado",
  processing: "Procesando",
  completed: "Completado",
  cancelled: "Cancelado",
  refunded: "Reembolsado",
};

/** Transiciones permitidas. Cualquier otra se rechaza en el servidor. */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending_payment: ["paid", "cancelled"],
  paid: ["processing", "completed", "refunded"],
  processing: ["completed", "refunded"],
  completed: ["refunded"],
  cancelled: [],
  refunded: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/** Filtros de "Mis pedidos" (pestañas) → estados que agrupan. */
export const ORDER_FILTERS = {
  todos: null,
  completados: ["completed"],
  pendientes: ["pending_payment", "paid", "processing"],
  cancelados: ["cancelled", "refunded"],
} as const satisfies Record<string, readonly OrderStatus[] | null>;
export type OrderFilter = keyof typeof ORDER_FILTERS;

export const PAYMENT_PROVIDERS = ["wompi", "mercadopago", "zenobank", "manual", "wallet"] as const;
/** Pasarelas con las que se puede recargar la billetera (no se recarga billetera con billetera). */
export const TOPUP_PROVIDERS = ["wompi", "mercadopago", "zenobank", "manual"] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

export const CART_MAX_QTY = 10;
export const CURRENCY = "COP";

export const INVENTORY_STATUSES = ["available", "reserved", "sold", "fallen", "expired", "disabled"] as const;
export type InventoryStatus = (typeof INVENTORY_STATUSES)[number];
export const INVENTORY_STATUS_LABEL: Record<InventoryStatus, string> = {
  available: "Disponible",
  reserved: "Reservada",
  sold: "Vendida",
  fallen: "Caída",
  expired: "Vencida",
  disabled: "Deshabilitada",
};

export const WALLET_TX_LABEL = {
  topup: "Recarga",
  purchase: "Compra",
  refund: "Reembolso",
  adjustment: "Ajuste",
} as const;

/** Días de anticipación para avisar vencimientos. */
export const EXPIRY_WARNING_DAYS = 7;
export const WALLET_MIN_TOPUP = 10_000;
export const WALLET_MAX_TOPUP = 2_000_000;
