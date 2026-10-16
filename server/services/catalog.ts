import type { PoolConnection } from "mysql2/promise";
import { query, queryOne, toBool, toIso } from "../db.js";
import { likeEscape } from "../lib/http.js";
import type { Category, ProductDetail, ProductSummary, ProductVariant } from "../../shared/types.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const PRODUCT_COLUMNS = `
  p.id, p.slug, p.name, p.summary, p.price, p.compare_at_price, p.stock, p.max_per_order,
  p.art_glyph, p.art_color, p.image_url, p.is_featured, p.is_active, p.category_id,
  p.delivery_mode, p.duration_days, p.low_stock_threshold,
  c.slug AS category_slug, c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
  (SELECT ROUND(AVG(r.rating), 1) FROM reviews r WHERE r.product_id = p.id) AS rating_avg,
  (SELECT COUNT(*) FROM reviews r WHERE r.product_id = p.id) AS rating_count,
  (SELECT COUNT(*) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = 1) AS variant_count`;

export function mapProduct(r: any): ProductSummary {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    summary: r.summary,
    price: Number(r.price),
    compareAtPrice: r.compare_at_price ? Number(r.compare_at_price) : null,
    stock: Number(r.stock),
    maxPerOrder: Number(r.max_per_order),
    artGlyph: r.art_glyph || r.name.slice(0, 1).toUpperCase(),
    artColor: r.art_color || r.category_color || "#e3122c",
    imageUrl: r.image_url || null,
    categorySlug: r.category_slug,
    categoryName: r.category_name,
    categoryIcon: r.category_icon,
    isFeatured: toBool(r.is_featured),
    ratingAvg: r.rating_avg === null || r.rating_avg === undefined ? null : Number(r.rating_avg),
    ratingCount: Number(r.rating_count ?? 0),
    deliveryMode: r.delivery_mode === "auto" ? "auto" : "manual",
    durationDays: r.duration_days === null || r.duration_days === undefined ? null : Number(r.duration_days),
    hasVariants: Number(r.variant_count ?? 0) > 0,
  };
}

/**
 * Opciones de varios productos. En entrega automática el inventario de cada opción son sus cuentas
 * disponibles más las compartidas (variant_id NULL); en manual, el stock propio de la opción.
 */
export async function getVariants(productIds: number[], opts: { conn?: PoolConnection; includeInactive?: boolean; lock?: boolean } = {}): Promise<Map<number, ProductVariant[]>> {
  const map = new Map<number, ProductVariant[]>();
  if (!productIds.length) return map;
  const sql = `SELECT v.*, p.delivery_mode,
          (SELECT COUNT(*) FROM inventory_items i WHERE i.product_id = v.product_id AND i.status = 'available'
             AND (i.variant_id = v.id OR i.variant_id IS NULL)) AS auto_stock
       FROM product_variants v JOIN products p ON p.id = v.product_id
      WHERE v.product_id IN (${productIds.map(() => "?").join(",")}) ${opts.includeInactive ? "" : "AND v.is_active = 1"}
      ORDER BY v.sort_order, v.id ${opts.lock ? "FOR UPDATE" : ""}`;
  const rows = opts.conn ? ((await opts.conn.query(sql, productIds))[0] as any[]) : await query<any>(sql, productIds);
  for (const r of rows) {
    const list = map.get(r.product_id) ?? [];
    list.push({
      id: r.id,
      name: r.name,
      price: Number(r.price),
      compareAtPrice: r.compare_at_price ? Number(r.compare_at_price) : null,
      stock: r.delivery_mode === "auto" ? Number(r.auto_stock) : Number(r.stock),
      durationDays: r.duration_days === null ? null : Number(r.duration_days),
      isActive: toBool(r.is_active),
    });
    map.set(r.product_id, list);
  }
  return map;
}

/**
 * Con opciones activas, el producto refleja la más barata (precio «Desde» en el catálogo) y el
 * inventario total. Sin opciones no cambia nada.
 */
export async function syncProductFromVariants(conn: PoolConnection, productId: number) {
  const [rows] = (await conn.query(
    "SELECT price, compare_at_price, stock FROM product_variants WHERE product_id = ? AND is_active = 1 ORDER BY price, sort_order, id",
    [productId],
  )) as unknown as [any[]];
  if (!rows.length) return;
  const cheapest = rows[0];
  const manualStock = rows.reduce((s: number, r: any) => s + Number(r.stock), 0);
  await conn.execute(
    `UPDATE products SET price = ?, compare_at_price = ?,
            stock = IF(delivery_mode = 'auto', (SELECT COUNT(*) FROM inventory_items WHERE product_id = ? AND status = 'available'), ?)
      WHERE id = ?`,
    [cheapest.price, cheapest.compare_at_price, productId, manualStock, productId],
  );
}

/** Galería guardada como JSON; los productos antiguos solo tienen image_url. */
export function parseGallery(raw: string | null, main: string | null): string[] {
  try {
    const arr = raw ? JSON.parse(raw) : [];
    if (Array.isArray(arr) && arr.every((x) => typeof x === "string") && arr.length) return arr;
  } catch {
    /* JSON dañado: se usa la imagen principal */
  }
  return main ? [main] : [];
}

export function mapCategory(r: any): Category {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    icon: r.icon,
    color: r.color,
    sortOrder: r.sort_order,
    isActive: toBool(r.is_active),
    imageUrl: r.image_url || null,
    productCount: r.product_count === undefined ? undefined : Number(r.product_count),
  };
}

export async function listCategories(includeInactive = false): Promise<Category[]> {
  const rows = await query(
    `SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.is_active = 1) AS product_count
       FROM categories c ${includeInactive ? "" : "WHERE c.is_active = 1"}
      ORDER BY c.sort_order, c.name`,
  );
  return rows.map(mapCategory);
}

export interface ProductFilters {
  q?: string;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  onSale?: boolean;
  featured?: boolean;
  sort?: "popular" | "price_asc" | "price_desc" | "newest" | "discount";
  limit?: number;
  offset?: number;
  includeInactive?: boolean;
}

const SORTS: Record<NonNullable<ProductFilters["sort"]>, string> = {
  popular: "p.is_featured DESC, p.sales_count DESC, p.id",
  price_asc: "p.price ASC, p.id",
  price_desc: "p.price DESC, p.id",
  newest: "p.created_at DESC, p.id DESC",
  discount: "(COALESCE(p.compare_at_price, p.price) - p.price) / COALESCE(p.compare_at_price, p.price) DESC, p.id",
};

export async function listProducts(f: ProductFilters): Promise<{ items: ProductSummary[]; total: number }> {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (!f.includeInactive) where.push("p.is_active = 1 AND c.is_active = 1");
  if (f.q) {
    const like = `%${likeEscape(f.q)}%`;
    where.push("(p.name LIKE ? OR p.summary LIKE ? OR p.description LIKE ? OR c.name LIKE ?)");
    params.push(like, like, like, like);
  }
  if (f.category) {
    where.push("c.slug = ?");
    params.push(f.category);
  }
  if (f.minPrice !== undefined) {
    where.push("p.price >= ?");
    params.push(f.minPrice);
  }
  if (f.maxPrice !== undefined) {
    where.push("p.price <= ?");
    params.push(f.maxPrice);
  }
  if (f.onSale) where.push("p.compare_at_price IS NOT NULL AND p.compare_at_price > p.price");
  if (f.featured) where.push("p.is_featured = 1");
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const order = SORTS[f.sort ?? "popular"] ?? SORTS.popular;
  const limit = Math.min(Math.max(f.limit ?? 24, 1), 100);
  const offset = Math.max(f.offset ?? 0, 0);

  const rows = await query(
    `SELECT ${PRODUCT_COLUMNS} FROM products p JOIN categories c ON c.id = p.category_id
      ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  const countRow = await queryOne<{ n: number }>(
    `SELECT COUNT(*) AS n FROM products p JOIN categories c ON c.id = p.category_id ${whereSql}`,
    params,
  );
  return { items: rows.map(mapProduct), total: Number(countRow?.n ?? 0) };
}

export async function getProductBySlug(slug: string, includeInactive = false): Promise<ProductDetail | null> {
  const r = await queryOne<any>(
    `SELECT ${PRODUCT_COLUMNS}, p.description, p.includes_text, p.instructions, p.delivery_text, p.warranty_text,
            p.duration_label, p.account_label, p.gallery
       FROM products p JOIN categories c ON c.id = p.category_id
      WHERE p.slug = ? ${includeInactive ? "" : "AND p.is_active = 1 AND c.is_active = 1"}`,
    [slug],
  );
  if (!r) return null;
  const reviews = await query<any>(
    `SELECT r.id, r.rating, r.comment, r.created_at, u.name
       FROM reviews r JOIN users u ON u.id = r.user_id
      WHERE r.product_id = ? ORDER BY r.created_at DESC LIMIT 20`,
    [r.id],
  );
  return {
    ...mapProduct(r),
    description: r.description,
    includesText: r.includes_text,
    instructions: r.instructions,
    deliveryText: r.delivery_text,
    warrantyText: r.warranty_text,
    durationLabel: r.duration_label,
    accountLabel: r.account_label,
    images: parseGallery(r.gallery, r.image_url),
    variants: (await getVariants([r.id])).get(r.id) ?? [],
    categoryId: r.category_id,
    isActive: toBool(r.is_active),
    reviews: reviews.map((v) => ({
      id: v.id,
      rating: v.rating,
      comment: v.comment,
      // Solo nombre y la inicial del apellido.
      author: String(v.name).split(" ").map((w: string, i: number) => (i === 0 ? w : `${w[0]}.`)).join(" "),
      createdAt: toIso(v.created_at)!,
    })),
  };
}

export async function getProductsByIds(ids: number[], conn?: PoolConnection, lock = false): Promise<Map<number, ProductSummary & { isActive: boolean }>> {
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => "?").join(",");
  const sql = `SELECT ${PRODUCT_COLUMNS}, c.is_active AS cat_active FROM products p JOIN categories c ON c.id = p.category_id
                WHERE p.id IN (${placeholders}) ${lock ? "FOR UPDATE" : ""}`;
  const rows = conn ? ((await conn.query(sql, ids))[0] as any[]) : await query<any>(sql, ids);
  return new Map(rows.map((r) => [r.id, { ...mapProduct(r), isActive: toBool(r.is_active) && toBool(r.cat_active) }]));
}
