import type { OrderStatus, PaymentProvider } from "./constants.js";

export interface Category {
  id: number;
  slug: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  sortOrder: number;
  isActive: boolean;
  productCount?: number;
}

export interface ProductSummary {
  id: number;
  slug: string;
  name: string;
  summary: string;
  price: number;
  compareAtPrice: number | null;
  stock: number;
  maxPerOrder: number;
  artGlyph: string;
  artColor: string;
  imageUrl: string | null;
  categorySlug: string;
  categoryName: string;
  categoryIcon: string;
  isFeatured: boolean;
  ratingAvg: number | null;
  ratingCount: number;
  deliveryMode: "manual" | "auto";
  durationDays: number | null;
}

export interface ProductDetail extends ProductSummary {
  description: string;
  includesText: string;
  instructions: string;
  deliveryText: string;
  warrantyText: string;
  durationLabel: string;
  accountLabel: string;
  /** Imágenes del producto (la primera es la principal). Vacía = arte generado. */
  images: string[];
  categoryId: number;
  isActive: boolean;
  reviews: { id: number; rating: number; comment: string; author: string; createdAt: string }[];
}

export interface CartLine {
  productId: number;
  quantity: number;
}

export interface SessionUser {
  id: number;
  email: string;
  name: string;
  phone: string | null;
  documentId: string | null;
  role: "customer" | "admin";
  preferredPayment: string | null;
}

export interface OrderItem {
  id: number;
  productId: number | null;
  productSlug: string | null;
  productName: string;
  productSummary: string;
  artGlyph: string;
  artColor: string | null;
  unitPrice: number;
  quantity: number;
  deliveryContent: string | null;
  deliveryMode: "manual" | "auto";
  /** Cuentas del inventario entregadas (entrega automática). */
  deliveries: { id: number; status: string; content: string | null; serviceEndsAt: string | null; soldAt: string | null }[];
}

export interface OrderEvent {
  status: string;
  note: string;
  createdAt: string;
}

export interface Order {
  id: number;
  code: string;
  status: OrderStatus;
  paymentProvider: PaymentProvider;
  paymentRef: string | null;
  paymentCurrency: string | null;
  paymentAmountForeign: string | null;
  subtotal: number;
  discount: number;
  total: number;
  couponCode: string | null;
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string;
  buyerDocument: string;
  createdAt: string;
  paidAt: string | null;
  items: OrderItem[];
  events?: OrderEvent[];
  customerId?: number;
}

export interface PaymentMethodInfo {
  id: PaymentProvider;
  label: string;
  description: string;
  configured: boolean;
  /** Para pagos en moneda extranjera (cripto): moneda y tasa COP por unidad. */
  currency?: string;
  rate?: number | null;
  /** Texto que se muestra cuando falta configuración. */
  pendingReason?: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
