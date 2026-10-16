-- Variaciones de producto, imagen de categorías, comprobantes de pagos manuales.

-- ---------- Variaciones ----------
-- Cada opción tiene su precio, precio anterior, inventario y duración. En entrega automática el
-- inventario son las cuentas de esa opción más las cuentas compartidas (variant_id NULL).
CREATE TABLE product_variants (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  product_id INT UNSIGNED NOT NULL,
  name VARCHAR(80) NOT NULL,
  price INT UNSIGNED NOT NULL,
  compare_at_price INT UNSIGNED NULL,
  stock INT NOT NULL DEFAULT 0,
  duration_days INT UNSIGNED NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_variants_product (product_id, is_active, sort_order),
  CONSTRAINT fk_variants_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE cart_items ADD COLUMN variant_id INT UNSIGNED NOT NULL DEFAULT 0 AFTER product_id;
ALTER TABLE cart_items ADD KEY ix_cart_user (user_id);
ALTER TABLE cart_items DROP PRIMARY KEY, ADD PRIMARY KEY (user_id, product_id, variant_id);

ALTER TABLE order_items ADD COLUMN variant_id INT UNSIGNED NULL AFTER product_id;
ALTER TABLE order_items ADD COLUMN variant_name VARCHAR(80) NULL AFTER product_name;

ALTER TABLE inventory_items ADD COLUMN variant_id INT UNSIGNED NULL AFTER product_id;
ALTER TABLE inventory_items ADD KEY ix_inv_variant (product_id, variant_id, status);

-- ---------- Categorías con imagen ----------
ALTER TABLE categories ADD COLUMN image_url VARCHAR(500) NULL;

-- ---------- Comprobantes (imágenes privadas) ----------
ALTER TABLE media ADD COLUMN is_private TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE media ADD COLUMN owner_id INT UNSIGNED NULL;

ALTER TABLE wallet_topups MODIFY status ENUM('pending','paid','cancelled','rejected') NOT NULL DEFAULT 'pending';
ALTER TABLE wallet_topups ADD COLUMN proof_media_id INT UNSIGNED NULL;
ALTER TABLE wallet_topups ADD COLUMN proof_reference VARCHAR(80) NULL;
ALTER TABLE wallet_topups ADD COLUMN manual_account VARCHAR(120) NULL;
ALTER TABLE wallet_topups ADD COLUMN review_note VARCHAR(255) NULL;
ALTER TABLE wallet_topups ADD COLUMN reviewed_at DATETIME NULL;
ALTER TABLE wallet_topups ADD KEY ix_topups_proof_ref (proof_reference);

ALTER TABLE orders ADD COLUMN proof_media_id INT UNSIGNED NULL;
ALTER TABLE orders ADD COLUMN proof_reference VARCHAR(80) NULL;
ALTER TABLE orders ADD COLUMN manual_account VARCHAR(120) NULL;
ALTER TABLE orders ADD COLUMN proof_submitted_at DATETIME NULL;
