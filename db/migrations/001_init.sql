-- NexiStore — esquema inicial (MySQL 8 / MariaDB 10.6+)
-- Todas las fechas se guardan en UTC. Los importes en COP como enteros (sin decimales).

CREATE TABLE users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(190) NOT NULL,
  password_hash VARCHAR(255) NULL,
  google_sub VARCHAR(64) NULL,
  name VARCHAR(120) NOT NULL,
  phone VARCHAR(30) NULL,
  document_id VARCHAR(30) NULL,
  role ENUM('customer','admin') NOT NULL DEFAULT 'customer',
  preferred_payment VARCHAR(30) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_google (google_sub)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE sessions (
  id CHAR(64) PRIMARY KEY,                 -- SHA-256 del token de la cookie
  user_id INT UNSIGNED NOT NULL,
  user_agent VARCHAR(255) NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_sessions_user (user_id),
  KEY ix_sessions_exp (expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE password_resets (
  token_hash CHAR(64) PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_resets_user (user_id),
  CONSTRAINT fk_resets_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE categories (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(80) NOT NULL,
  name VARCHAR(80) NOT NULL,
  description VARCHAR(255) NOT NULL DEFAULT '',
  icon VARCHAR(40) NOT NULL DEFAULT 'tag',
  color VARCHAR(9) NOT NULL DEFAULT '#e3122c',
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_categories_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE products (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(120) NOT NULL,
  category_id INT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  summary VARCHAR(160) NOT NULL DEFAULT '',     -- p. ej. "1 año · Perfil individual"
  description TEXT NOT NULL,
  includes_text TEXT NOT NULL,
  instructions TEXT NOT NULL,
  delivery_text TEXT NOT NULL,
  warranty_text TEXT NOT NULL,
  duration_label VARCHAR(60) NOT NULL DEFAULT '',
  account_label VARCHAR(60) NOT NULL DEFAULT '',
  price INT UNSIGNED NOT NULL,
  compare_at_price INT UNSIGNED NULL,
  stock INT NOT NULL DEFAULT 0,
  max_per_order INT UNSIGNED NOT NULL DEFAULT 5,
  art_glyph VARCHAR(4) NOT NULL DEFAULT '',
  art_color VARCHAR(9) NULL,
  image_url VARCHAR(500) NULL,
  is_featured TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  sales_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_products_slug (slug),
  KEY ix_products_cat (category_id),
  KEY ix_products_active (is_active, is_featured),
  FULLTEXT KEY ft_products (name, summary, description),
  CONSTRAINT fk_products_cat FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE reviews (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  product_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  rating TINYINT UNSIGNED NOT NULL,
  comment VARCHAR(600) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_review (product_id, user_id),
  CONSTRAINT fk_reviews_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT fk_reviews_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE cart_items (
  user_id INT UNSIGNED NOT NULL,
  product_id INT UNSIGNED NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, product_id),
  CONSTRAINT fk_cart_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_cart_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE coupons (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(40) NOT NULL,
  description VARCHAR(160) NOT NULL DEFAULT '',
  kind ENUM('percent','fixed') NOT NULL,
  value INT UNSIGNED NOT NULL,
  min_subtotal INT UNSIGNED NOT NULL DEFAULT 0,
  max_uses INT UNSIGNED NULL,
  used_count INT UNSIGNED NOT NULL DEFAULT 0,
  starts_at DATETIME NULL,
  ends_at DATETIME NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_coupons_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE orders (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(24) NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  status ENUM('pending_payment','paid','processing','completed','cancelled','refunded') NOT NULL DEFAULT 'pending_payment',
  payment_provider VARCHAR(30) NOT NULL,
  payment_ref VARCHAR(120) NULL,
  subtotal INT UNSIGNED NOT NULL,
  discount INT UNSIGNED NOT NULL DEFAULT 0,
  total INT UNSIGNED NOT NULL,
  coupon_code VARCHAR(40) NULL,
  buyer_name VARCHAR(120) NOT NULL,
  buyer_email VARCHAR(190) NOT NULL,
  buyer_phone VARCHAR(30) NOT NULL,
  buyer_document VARCHAR(30) NOT NULL,
  notes VARCHAR(500) NULL,
  stock_released TINYINT(1) NOT NULL DEFAULT 0,
  paid_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_orders_code (code),
  KEY ix_orders_user (user_id, created_at),
  KEY ix_orders_status (status, created_at),
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE order_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id INT UNSIGNED NOT NULL,
  product_id INT UNSIGNED NULL,
  product_name VARCHAR(120) NOT NULL,
  product_summary VARCHAR(160) NOT NULL DEFAULT '',
  art_glyph VARCHAR(4) NOT NULL DEFAULT '',
  art_color VARCHAR(9) NULL,
  unit_price INT UNSIGNED NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  delivery_content TEXT NULL,               -- credenciales / códigos entregados por el administrador
  KEY ix_items_order (order_id),
  CONSTRAINT fk_items_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_items_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE order_events (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id INT UNSIGNED NOT NULL,
  status VARCHAR(30) NOT NULL,
  note VARCHAR(500) NOT NULL DEFAULT '',
  actor VARCHAR(30) NOT NULL DEFAULT 'system',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_events_order (order_id),
  CONSTRAINT fk_events_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE payment_events (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  provider VARCHAR(30) NOT NULL,
  external_id VARCHAR(120) NOT NULL,
  order_id INT UNSIGNED NULL,
  status VARCHAR(40) NOT NULL,
  amount INT UNSIGNED NULL,
  payload JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_payment_event (provider, external_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE addresses (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  label VARCHAR(60) NOT NULL,
  line1 VARCHAR(160) NOT NULL,
  city VARCHAR(80) NOT NULL,
  region VARCHAR(80) NOT NULL,
  phone VARCHAR(30) NOT NULL DEFAULT '',
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_addr_user (user_id),
  CONSTRAINT fk_addr_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE support_tickets (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  order_code VARCHAR(24) NULL,
  subject VARCHAR(140) NOT NULL,
  message TEXT NOT NULL,
  status ENUM('open','answered','closed') NOT NULL DEFAULT 'open',
  admin_reply TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY ix_tickets_user (user_id),
  CONSTRAINT fk_tickets_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE posts (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(140) NOT NULL,
  title VARCHAR(160) NOT NULL,
  excerpt VARCHAR(300) NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  is_published TINYINT(1) NOT NULL DEFAULT 0,
  published_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_posts_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE settings (
  name VARCHAR(60) PRIMARY KEY,
  value JSON NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
