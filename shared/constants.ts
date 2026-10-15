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

export const PAYMENT_PROVIDERS = ["mercadopago", "wompi", "manual"] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

export const CART_MAX_QTY = 10;
export const CURRENCY = "COP";
