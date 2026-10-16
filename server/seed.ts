import { execute, queryOne } from "./db.js";
import { seal, vaultConfigured } from "./lib/vault.js";
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
  // Producto de ejemplo con opciones (variaciones).
  const fam = await queryOne<{ id: number }>("SELECT id FROM products WHERE slug = 'cineplus-familiar'");
  if (fam) {
    for (const [i, [name, price, compare, stock, days]] of ([
      ["1 mes", 14900, 19900, 15, 30],
      ["3 meses", 39900, 54900, 10, 90],
      ["6 meses", 69900, 99900, 6, 180],
    ] as const).entries()) {
      await execute(
        "INSERT INTO product_variants (product_id, name, price, compare_at_price, stock, duration_days, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [fam.id, name, price, compare, stock, days, i],
      );
    }
    await execute("UPDATE products SET price = 14900, compare_at_price = 19900, stock = 31, summary = '4 pantallas · elige la duración' WHERE id = ?", [fam.id]);
  }
  // Productos de ejemplo con entrega automática e inventario de cuentas FICTICIAS (solo si hay llave de cifrado).
  if (vaultConfigured()) {
    for (const [slug, days, n] of [["cineplus-premium-anual", 365, 8], ["sonora-premium-anual", 365, 6], ["lumen-ai-pro", 30, 4]] as const) {
      const p = await queryOne<{ id: number }>("SELECT id FROM products WHERE slug = ?", [slug]);
      if (!p) continue;
      await execute("UPDATE products SET delivery_mode = 'auto', duration_days = ?, low_stock_threshold = 3 WHERE id = ?", [days, p.id]);
      for (let i = 1; i <= n; i++) {
        const label = `demo${i}@${slug.split("-")[0]}.test`;
        const expires = new Date(Date.now() + (i === 1 ? 5 : 400) * 86_400_000);
        await execute("INSERT INTO inventory_items (product_id, label, content, expires_at) VALUES (?, ?, ?, ?)", [
          p.id,
          `${label} · perfil ${i}`,
          seal(`Usuario: ${label}\nClave: Demo-${i}${i}${i}\nPerfil: ${i}`),
          expires,
        ]);
      }
      await execute("UPDATE products SET stock = ? WHERE id = ?", [n, p.id]);
    }
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
