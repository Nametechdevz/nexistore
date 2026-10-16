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
  imageUrl?: string | null;
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
  /** Tiene opciones (1 mes, 3 meses…): el precio mostrado es el más bajo («Desde»). */
  hasVariants: boolean;
}

export interface ProductVariant {
  id: number;
  name: string;
  price: number;
  compareAtPrice: number | null;
  /** Disponibles: unidades (entrega manual) o cuentas de la opción + compartidas (automática). */
  stock: number;
  durationDays: number | null;
  isActive: boolean;
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
  /** Opciones activas, en orden. Vacía = producto sin variaciones. */
  variants: ProductVariant[];
  categoryId: number;
  isActive: boolean;
  reviews: { id: number; rating: number; comment: string; author: string; createdAt: string }[];
}

export interface CartLine {
  productId: number;
  quantity: number;
  /** Opción elegida (obligatoria si el producto tiene variaciones). */
  variantId?: number | null;
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
  /** Opción comprada (p. ej. «3 meses»). */
  variantName: string | null;
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
  /** Pago por transferencia: comprobante enviado por el cliente. */
  proof?: { url: string | null; reference: string | null; account: string | null; submittedAt: string | null } | null;
}

export interface ManualAccountPublic {
  id: string;
  kind: string;
  kindLabel: string;
  label: string;
  holder: string;
  number: string;
  qrImage: string | null;
  instructions: string;
}

export interface PaymentMethodInfo {
  id: PaymentProvider;
  label: string;
  description: string;
  configured: boolean;
  /** Logo subido en el panel (null = ícono por defecto). */
  logo?: string | null;
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
