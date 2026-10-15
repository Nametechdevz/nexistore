import { execute, queryOne } from "./db.js";
import { seedCategories, seedCoupons, seedPosts, seedProductDefaults, seedProducts } from "./seed-data.js";

export async function seedCatalog(): Promise<void> {
  for (const [i, c] of seedCategories.entries()) {
    await execute("INSERT INTO categories (slug, name, description, icon, color, sort_order) VALUES (?, ?, ?, ?, ?, ?)", [
      c.slug, c.name, c.description, c.icon, c.color, i,
    ]);
  }
  for (const p of seedProducts) {
    const cat = await queryOne<{ id: number }>("SELECT id FROM categories WHERE slug = ?", [p.category]);
    if (!cat) continue;
    await execute(
      `INSERT INTO products (slug, category_id, name, summary, description, includes_text, instructions, delivery_text, warranty_text,
                             duration_label, account_label, price, compare_at_price, stock, art_glyph, is_featured)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        p.slug, cat.id, p.name, p.summary, p.description, p.includes, p.instructions, seedProductDefaults.delivery,
        seedProductDefaults.warranty, p.duration, p.account, p.price, p.compareAt ?? null, p.stock, p.glyph, p.featured ? 1 : 0,
      ],
    );
  }
  for (const c of seedCoupons) {
    await execute("INSERT INTO coupons (code, description, kind, value, min_subtotal) VALUES (?, ?, ?, ?, ?)", [
      c.code, c.description, c.kind, c.value, c.minSubtotal,
    ]);
  }
  for (const p of seedPosts) {
    await execute("INSERT INTO posts (slug, title, excerpt, body, is_published, published_at) VALUES (?, ?, ?, ?, 1, UTC_TIMESTAMP())", [
      p.slug, p.title, p.excerpt, p.body,
    ]);
  }
}
