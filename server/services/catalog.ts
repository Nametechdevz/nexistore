import type { PoolConnection } from "mysql2/promise";
import { query, queryOne, toBool, toIso } from "../db.js";
import { likeEscape } from "../lib/http.js";
import type { Category, ProductDetail, ProductSummary } from "../../shared/types.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const PRODUCT_COLUMNS = `
  p.id, p.slug, p.name, p.summary, p.price, p.compare_at_price, p.stock, p.max_per_order,
  p.art_glyph, p.art_color, p.image_url, p.is_featured, p.is_active, p.category_id,
  c.slug AS category_slug, c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
  (SELECT ROUND(AVG(r.rating), 1) FROM reviews r WHERE r.product_id = p.id) AS rating_avg,
  (SELECT COUNT(*) FROM reviews r WHERE r.product_id = p.id) AS rating_count`;

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
  };
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
            p.duration_label, p.account_label
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
