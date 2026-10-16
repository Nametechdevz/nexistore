/**
 * Esquemas de validación compartidos (cliente y servidor).
 * El cliente los usa para mostrar errores al instante; el servidor los vuelve a aplicar siempre.
 */
import { z } from "zod";

// Sin compilación dinámica (new Function): compatible con la política CSP estricta del sitio.
z.config({ jitless: true });
import { CART_MAX_QTY, ORDER_STATUSES, PAYMENT_PROVIDERS, TOPUP_PROVIDERS, WALLET_MAX_TOPUP, WALLET_MIN_TOPUP } from "./constants.js";

const trimmed = (min: number, max: number, label: string) =>
  z
    .string({ error: `${label} es obligatorio.` })
    .trim()
    .min(min, min <= 1 ? `${label} es obligatorio.` : `${label} debe tener al menos ${min} caracteres.`)
    .max(max, `${label} no puede superar ${max} caracteres.`);

export const emailSchema = z
  .string({ error: "El correo es obligatorio." })
  .trim()
  .toLowerCase()
  .min(1, "El correo es obligatorio.")
  .max(190, "El correo es demasiado largo.")
  .pipe(z.email("Ingresa un correo válido."));

export const passwordSchema = z
  .string({ error: "La contraseña es obligatoria." })
  .min(8, "La contraseña debe tener al menos 8 caracteres.")
  .max(128, "La contraseña no puede superar 128 caracteres.")
  .regex(/[A-Za-zÁÉÍÓÚáéíóúñÑ]/, "Incluye al menos una letra.")
  .regex(/\d/, "Incluye al menos un número.");

export const phoneSchema = z
  .string({ error: "El celular es obligatorio." })
  .trim()
  .regex(/^\+?[0-9 ]{7,18}$/, "Ingresa un número de celular válido.");

export const documentSchema = z
  .string({ error: "El documento es obligatorio." })
  .trim()
  .regex(/^[0-9A-Za-z-]{5,20}$/, "Ingresa un número de documento válido.");

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "La contraseña es obligatoria.").max(128),
  remember: z.boolean().optional().default(false),
});

export const registerSchema = z
  .object({
    name: trimmed(2, 120, "El nombre"),
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
    acceptTerms: z.literal(true, { error: "Debes aceptar los términos y condiciones." }),
  })
  .refine((d) => d.password === d.confirmPassword, {
    path: ["confirmPassword"],
    message: "Las contraseñas no coinciden.",
  });

export const forgotSchema = z.object({ email: emailSchema });

export const resetSchema = z
  .object({
    token: z.string().regex(/^[a-f0-9]{64}$/, "Enlace inválido."),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    path: ["confirmPassword"],
    message: "Las contraseñas no coinciden.",
  });

export const profileSchema = z.object({
  name: trimmed(2, 120, "El nombre"),
  phone: phoneSchema.or(z.literal("")).optional(),
  documentId: documentSchema.or(z.literal("")).optional(),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Ingresa tu contraseña actual."),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    path: ["confirmPassword"],
    message: "Las contraseñas no coinciden.",
  });

export const addressSchema = z.object({
  label: trimmed(2, 60, "El nombre de la dirección"),
  line1: trimmed(5, 160, "La dirección"),
  city: trimmed(2, 80, "La ciudad"),
  region: trimmed(2, 80, "El departamento"),
  phone: phoneSchema.or(z.literal("")).optional().default(""),
  isDefault: z.boolean().optional().default(false),
});

export const cartLineSchema = z.object({
  productId: z.number().int().positive(),
  quantity: z.number().int().min(1).max(CART_MAX_QTY),
  variantId: z.number().int().positive().nullable().optional(),
});
export const cartSyncSchema = z.object({
  items: z.array(cartLineSchema).max(50),
  mode: z.enum(["replace", "merge"]).default("replace"),
});

export const couponCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9_-]{3,40}$/, "Código de cupón inválido.");

export const checkoutSchema = z.object({
  buyerName: trimmed(3, 120, "El nombre"),
  buyerEmail: emailSchema,
  buyerPhone: phoneSchema,
  // El documento ya no se pide en el checkout; se acepta vacío por compatibilidad.
  buyerDocument: documentSchema.or(z.literal("")).optional().default(""),
  paymentProvider: z.enum(PAYMENT_PROVIDERS, { error: "Selecciona un método de pago." }),
  couponCode: couponCodeSchema.optional().or(z.literal("")),
  notes: z.string().trim().max(500).optional().default(""),
  acceptTerms: z.literal(true, { error: "Debes aceptar los términos y condiciones." }),
});

export const ticketSchema = z.object({
  subject: trimmed(4, 140, "El asunto"),
  message: trimmed(10, 4000, "El mensaje"),
  orderCode: z.string().trim().max(24).optional().or(z.literal("")),
});

export const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(600).optional().default(""),
});

/* ---------- Administración ---------- */

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Usa minúsculas, números y guiones (ej. musica-premium).")
  .max(120);
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color hexadecimal inválido (#RRGGBB).");

export const categoryInputSchema = z.object({
  name: trimmed(2, 80, "El nombre"),
  slug: slugSchema,
  description: z.string().trim().max(255).default(""),
  icon: z.string().trim().min(1).max(40).default("tag"),
  color: colorSchema,
  sortOrder: z.number().int().min(0).max(9999).default(0),
  isActive: z.boolean().default(true),
  /** Imagen propia (reemplaza el ícono en la tienda). */
  imageUrl: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === "" || /^https:\/\/\S+$/.test(v) || /^\/media\/\d+-[a-f0-9]{16}\.(jpg|png|webp|gif)$/.test(v), "Imagen no válida.")
    .default(""),
});

export const MAX_PRODUCT_IMAGES = 8;
export const MAX_PRODUCT_VARIANTS = 20;

/** Opción de un producto (1 mes, 3 meses, perfil, cuenta completa…). */
export const variantInputSchema = z
  .object({
    id: z.number().int().positive().optional(),
    name: trimmed(1, 80, "El nombre de la opción"),
    price: z.number({ error: "El precio es obligatorio." }).int().min(100, "El precio mínimo es $100.").max(50_000_000),
    compareAtPrice: z.number().int().min(0).max(50_000_000).nullable().default(null),
    stock: z.number().int().min(0, "El inventario no puede ser negativo.").max(1_000_000).default(0),
    durationDays: z.number().int().min(1, "Mínimo 1 día.").max(3650).nullable().default(null),
  })
  .refine((v) => v.compareAtPrice === null || v.compareAtPrice === 0 || v.compareAtPrice > v.price, {
    path: ["compareAtPrice"],
    message: "Debe ser mayor que el precio.",
  });
export const imageRefSchema = z
  .string()
  .trim()
  .max(500)
  .refine((v) => /^https:\/\/\S+$/.test(v) || /^\/media\/\d+-[a-f0-9]{16}\.(jpg|png|webp|gif)$/.test(v), "Imagen no válida.");

export const productInputSchema = z
  .object({
    name: trimmed(2, 120, "El nombre"),
    slug: slugSchema,
    categoryId: z.number({ error: "Selecciona una categoría." }).int().positive("Selecciona una categoría."),
    summary: z.string().trim().max(160).default(""),
    description: trimmed(10, 5000, "La descripción"),
    includesText: z.string().trim().max(3000).default(""),
    instructions: z.string().trim().max(3000).default(""),
    deliveryText: z.string().trim().max(3000).default(""),
    warrantyText: z.string().trim().max(3000).default(""),
    durationLabel: z.string().trim().max(60).default(""),
    accountLabel: z.string().trim().max(60).default(""),
    price: z.number({ error: "El precio es obligatorio." }).int().min(100, "El precio mínimo es $100.").max(50_000_000),
    compareAtPrice: z.number().int().min(0).max(50_000_000).nullable().default(null),
    stock: z.number().int().min(0, "El inventario no puede ser negativo.").max(1_000_000),
    maxPerOrder: z.number().int().min(1).max(10).default(5),
    artGlyph: z.string().trim().max(4).default(""),
    artColor: colorSchema.nullable().default(null),
    imageUrl: z
      .string()
      .trim()
      .max(500)
      .refine((v) => v === "" || /^https:\/\//.test(v) || v.startsWith("/"), "Usa una URL https o una ruta local.")
      .default(""),
    /** Galería: imágenes subidas desde el panel (/media/…) o URLs https. La primera es la principal. */
    images: z.array(imageRefSchema).max(MAX_PRODUCT_IMAGES, `Máximo ${MAX_PRODUCT_IMAGES} imágenes por producto.`).default([]),
    /** Opciones del producto. Vacío = producto sin variaciones (usa precio e inventario propios). */
    variants: z
      .array(variantInputSchema)
      .max(MAX_PRODUCT_VARIANTS, `Máximo ${MAX_PRODUCT_VARIANTS} opciones.`)
      .default([])
      .refine((vs) => new Set(vs.map((v) => v.name.toLowerCase())).size === vs.length, "Hay opciones con el mismo nombre."),
    isFeatured: z.boolean().default(false),
    isActive: z.boolean().default(true),
    deliveryMode: z.enum(["manual", "auto"]).default("manual"),
    durationDays: z.number().int().min(1, "Mínimo 1 día.").max(3650).nullable().default(null),
    lowStockThreshold: z.number().int().min(0).max(100000).default(5),
  })
  .refine((p) => p.compareAtPrice === null || p.compareAtPrice === 0 || p.compareAtPrice > p.price, {
    path: ["compareAtPrice"],
    message: "El precio anterior debe ser mayor que el precio actual.",
  });

export const couponInputSchema = z
  .object({
    code: couponCodeSchema,
    description: z.string().trim().max(160).default(""),
    kind: z.enum(["percent", "fixed"]),
    value: z.number().int().min(1, "El valor debe ser mayor que 0."),
    minSubtotal: z.number().int().min(0).default(0),
    maxUses: z.number().int().min(1).nullable().default(null),
    startsAt: z.string().nullable().default(null),
    endsAt: z.string().nullable().default(null),
    isActive: z.boolean().default(true),
  })
  .refine((c) => c.kind !== "percent" || c.value <= 100, {
    path: ["value"],
    message: "El porcentaje no puede superar 100.",
  });

export const orderStatusUpdateSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  note: z.string().trim().max(500).optional().default(""),
  refundToWallet: z.boolean().optional().default(false),
});

export const orderDeliverySchema = z.object({
  items: z.array(z.object({ itemId: z.number().int().positive(), content: z.string().max(4000) })).min(1),
  complete: z.boolean().default(false),
});

export const postInputSchema = z.object({
  title: trimmed(3, 160, "El título"),
  slug: slugSchema,
  excerpt: z.string().trim().max(300).default(""),
  body: trimmed(10, 50_000, "El contenido"),
  isPublished: z.boolean().default(false),
});

export const campaignSchema = z.object({
  enabled: z.boolean(),
  titleLead: z.string().trim().max(80),
  titleAccent: z.string().trim().max(60),
  subtitle: z.string().trim().max(200),
  ctaLabel: z.string().trim().max(40),
  ctaHref: z.string().trim().max(200).regex(/^\//, "Usa una ruta interna, ej. /promociones"),
  sealTop: z.string().trim().max(20),
  sealValue: z.string().trim().max(8),
  sealBottom: z.string().trim().max(20),
  promoTitle: z.string().trim().max(80),
  promoText: z.string().trim().max(200),
  snow: z.boolean(),
  /** Fondos propios subidos desde el panel. Vacío = ilustración navideña incluida (o fondo liso sin campaña). */
  heroImage: imageRefSchema.or(z.literal("")).default(""),
  authImage: imageRefSchema.or(z.literal("")).default(""),
  promoImage: imageRefSchema.or(z.literal("")).default(""),
  /** Mostrar las tarjetas flotantes de productos sobre el fondo de la portada. */
  heroProducts: z.boolean().default(true),
});

export const storeSettingsSchema = z.object({
  storeName: trimmed(2, 60, "El nombre de la tienda"),
  supportEmail: emailSchema,
  supportWhatsapp: z.string().trim().max(30).default(""),
  manualPaymentInstructions: z.string().trim().max(2000).default(""),
  /** Datos del responsable que aparecen en Términos y Privacidad. */
  legalName: z.string().trim().max(120).default(""),
  legalId: z.string().trim().max(40).default(""),
  legalAddress: z.string().trim().max(160).default(""),
  legalCity: z.string().trim().max(80).default(""),
});

export const ticketReplySchema = z.object({
  reply: trimmed(2, 4000, "La respuesta"),
  status: z.enum(["open", "answered", "closed"]),
});

export const userAdminUpdateSchema = z.object({
  role: z.enum(["customer", "admin"]).optional(),
  isActive: z.boolean().optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type CheckoutInput = z.infer<typeof checkoutSchema>;
export type ProductInput = z.infer<typeof productInputSchema>;
export type CategoryInput = z.infer<typeof categoryInputSchema>;
export type CouponInput = z.infer<typeof couponInputSchema>;
export type CampaignSettings = z.infer<typeof campaignSchema>;
export type StoreSettings = z.infer<typeof storeSettingsSchema>;

/* ---------- Integraciones (configuradas desde el panel) ---------- */

const optSecret = z.string().trim().max(500).optional(); // undefined = conservar, "" = borrar
export const integrationsSchema = z.object({
  siteUrl: z
    .string()
    .trim()
    .max(200)
    .refine((v) => v === "" || /^https?:\/\/[^\s/]+$/.test(v.replace(/\/$/, "")), "Usa el formato https://tu-dominio.com")
    .optional(),
  smtpHost: z.string().trim().max(200).optional(),
  smtpPort: z.number().int().min(1).max(65535).optional(),
  smtpUser: z.string().trim().max(200).optional(),
  smtpPassword: optSecret,
  smtpFrom: z.string().trim().max(200).optional(),
  wompiPublicKey: z
    .string()
    .trim()
    .max(200)
    .refine((v) => v === "" || /^pub_(test|prod)_/.test(v), "La llave pública empieza por pub_test_ o pub_prod_.")
    .optional(),
  wompiIntegritySecret: optSecret,
  wompiEventsSecret: optSecret,
  mpAccessToken: optSecret,
  mpWebhookSecret: optSecret,
  zenoApiKey: optSecret,
  zenoWebhookSecret: optSecret,
  zenoCurrency: z.string().trim().toUpperCase().regex(/^[A-Z]{3,5}$/, "Moneda de 3 a 5 letras, ej. USD.").optional(),
  manualEnabled: z.boolean().optional(),
  googleClientId: z.string().trim().max(300).optional(),
  googleClientSecret: optSecret,
});

/* ---------- Billetera ---------- */

/* ---------- Pagos manuales con comprobante ---------- */

export const MANUAL_ACCOUNT_KINDS = {
  nequi: "Nequi",
  daviplata: "Daviplata",
  breb: "Bre-B (llave)",
  bancolombia: "Bancolombia",
  qr: "Código QR",
  otro: "Otra cuenta",
} as const;
export type ManualAccountKind = keyof typeof MANUAL_ACCOUNT_KINDS;

/** Cuenta donde el cliente transfiere (Nequi, llave Bre-B, QR…). Se configura en el panel. */
export const manualAccountSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]{6,16}$/).optional(),
    kind: z.enum(Object.keys(MANUAL_ACCOUNT_KINDS) as [ManualAccountKind, ...ManualAccountKind[]]),
    label: trimmed(2, 60, "El nombre"),
    holder: z.string().trim().max(80).default(""),
    number: z.string().trim().max(80).default(""),
    qrImage: imageRefSchema.or(z.literal("")).default(""),
    instructions: z.string().trim().max(400).default(""),
    enabled: z.boolean().default(true),
  })
  .refine((a) => a.number || a.qrImage, { path: ["number"], message: "Agrega el número, la llave o una imagen QR." });
export const manualAccountsSchema = z.object({ accounts: z.array(manualAccountSchema).max(12, "Máximo 12 cuentas.") });
export type ManualAccount = z.infer<typeof manualAccountSchema> & { id: string };

/** Comprobante privado subido por el cliente. */
export const privateProofSchema = z.string().regex(/^\/api\/files\/\d+-[a-f0-9]{16}\.(jpg|png|webp|gif)$/, "Sube la imagen del comprobante.");

export const paymentProofSchema = z.object({
  accountId: z.string({ error: "Elige la cuenta a la que transferiste." }).regex(/^[a-z0-9]{6,16}$/, "Elige la cuenta a la que transferiste."),
  reference: trimmed(4, 80, "La referencia o número de comprobante"),
  proofUrl: privateProofSchema,
});

export const rejectProofSchema = z.object({ reason: trimmed(4, 255, "El motivo") });

/** Logo y nombre que se muestran para cada método de pago. */
const methodDisplay = z.object({ logo: imageRefSchema.or(z.literal("")).default(""), label: z.string().trim().max(60).default("") });
export const paymentDisplaySchema = z.object({
  wallet: methodDisplay.optional(),
  wompi: methodDisplay.optional(),
  mercadopago: methodDisplay.optional(),
  zenobank: methodDisplay.optional(),
  manual: methodDisplay.optional(),
});
export type PaymentDisplay = z.infer<typeof paymentDisplaySchema>;

export const topupSchema = z.object({
  amount: z
    .number({ error: "Ingresa un monto." })
    .int("Usa pesos sin decimales.")
    .min(WALLET_MIN_TOPUP, `La recarga mínima es $${WALLET_MIN_TOPUP.toLocaleString("es-CO")}.`)
    .max(WALLET_MAX_TOPUP, `La recarga máxima es $${WALLET_MAX_TOPUP.toLocaleString("es-CO")}.`),
  provider: z.enum(TOPUP_PROVIDERS, { error: "Selecciona un método de pago." }),
  /** Solo transferencias: cuenta usada, referencia y comprobante. */
  accountId: z.string().regex(/^[a-z0-9]{6,16}$/).optional(),
  reference: z.string().trim().max(80).optional(),
  proofUrl: privateProofSchema.optional(),
});

export const MANUAL_TOPUP_METHODS = {
  nequi: "Nequi",
  daviplata: "Daviplata",
  bancolombia: "Bancolombia",
  efectivo: "Efectivo",
  cripto: "Cripto",
  otro: "Otro",
} as const;

/** Recarga manual hecha por un administrador (dinero recibido por fuera de la tienda). */
export const adminTopupSchema = z.object({
  userId: z.number({ error: "Selecciona un cliente." }).int().positive("Selecciona un cliente."),
  amount: z
    .number({ error: "Ingresa un monto." })
    .int("Usa pesos sin decimales.")
    .min(1000, "El monto mínimo es $1.000.")
    .max(WALLET_MAX_TOPUP, `El máximo por recarga es $${WALLET_MAX_TOPUP.toLocaleString("es-CO")}.`),
  method: z.enum(Object.keys(MANUAL_TOPUP_METHODS) as [keyof typeof MANUAL_TOPUP_METHODS, ...(keyof typeof MANUAL_TOPUP_METHODS)[]], { error: "Selecciona cómo se recibió el dinero." }),
  reference: z.string().trim().max(80, "Máximo 80 caracteres.").default(""),
  note: z.string().trim().max(200).default(""),
});

export const walletAdjustSchema = z.object({
  amount: z.number().int().refine((v) => v !== 0, "El monto no puede ser 0.").refine((v) => Math.abs(v) <= 10_000_000, "Monto demasiado alto."),
  note: trimmed(3, 255, "El motivo"),
});

export const cryptoSettingsSchema = z.object({
  copPerUnit: z.number().positive("La tasa debe ser mayor que 0.").max(100_000).nullable(),
});

/* ---------- Soporte ---------- */

export const ticketMessageSchema = z.object({
  body: trimmed(2, 4000, "El mensaje"),
});

export const ISSUE_REASONS = {
  caida: "La cuenta no funciona / se cayó",
  clave: "La contraseña cambió o es incorrecta",
  perfil: "Problema con el perfil o pantallas",
  otro: "Otro problema",
} as const;

export const reportIssueSchema = z.object({
  inventoryItemId: z.number().int().positive().optional(),
  reason: z.enum(Object.keys(ISSUE_REASONS) as [keyof typeof ISSUE_REASONS, ...(keyof typeof ISSUE_REASONS)[]]),
  message: z.string().trim().max(2000).optional().default(""),
});

export const ticketAdminMessageSchema = z.object({
  body: trimmed(2, 4000, "El mensaje"),
  status: z.enum(["open", "answered", "closed"]).default("answered"),
});

export const resolveTicketSchema = z.object({
  action: z.enum(["replace", "refund"]),
  amount: z.number().int().min(1).max(50_000_000).optional(),
  message: z.string().trim().max(4000).optional().default(""),
});

/* ---------- Inventario ---------- */

export const inventoryBulkSchema = z.object({
  productId: z.number({ error: "Selecciona un producto." }).int().positive("Selecciona un producto."),
  /** Opción a la que pertenecen las cuentas. null = compartidas entre todas las opciones. */
  variantId: z.number().int().positive().nullable().default(null),
  lines: trimmed(3, 200_000, "Las cuentas"),
  expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (AAAA-MM-DD).").nullable().default(null),
});

export const inventoryUpdateSchema = z.object({
  label: z.string().trim().max(160).default(""),
  content: z.string().trim().max(4000).optional(),
  expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (AAAA-MM-DD).").nullable().default(null),
  status: z.enum(["available", "disabled"]).optional(),
  notes: z.string().trim().max(500).default(""),
});

export const inventoryFallSchema = z.object({
  replace: z.boolean().default(true),
  note: z.string().trim().max(300).default(""),
});

/** Convierte un ZodError en { campo: mensaje } (primer error por campo). */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
