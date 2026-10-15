-- NexiStore — billetera, inventario de cuentas, soporte conversacional, alertas y pagos con cripto.

-- ---------- Billetera ----------
ALTER TABLE users ADD COLUMN wallet_balance INT NOT NULL DEFAULT 0;

CREATE TABLE wallet_transactions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  kind ENUM('topup','purchase','refund','adjustment') NOT NULL,
  amount INT NOT NULL,                       -- positivo = crédito, negativo = débito (COP)
  balance_after INT NOT NULL,
  reference VARCHAR(40) NULL,                -- código de pedido o recarga
  note VARCHAR(255) NOT NULL DEFAULT '',
  actor VARCHAR(30) NOT NULL DEFAULT 'system',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_wtx_user (user_id, created_at),
  CONSTRAINT fk_wtx_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE wallet_topups (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(24) NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  amount INT UNSIGNED NOT NULL,
  provider VARCHAR(30) NOT NULL,
  status ENUM('pending','paid','cancelled') NOT NULL DEFAULT 'pending',
  payment_ref VARCHAR(120) NULL,
  payment_currency VARCHAR(10) NULL,
  payment_amount_foreign DECIMAL(18,8) NULL,
  paid_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_topups_code (code),
  KEY ix_topups_user (user_id, created_at),
  KEY ix_topups_status (status),
  CONSTRAINT fk_topups_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Cotización en moneda extranjera (pagos con cripto).
ALTER TABLE orders ADD COLUMN payment_currency VARCHAR(10) NULL;
ALTER TABLE orders ADD COLUMN payment_amount_foreign DECIMAL(18,8) NULL;

-- ---------- Inventario de cuentas ----------
ALTER TABLE products ADD COLUMN delivery_mode ENUM('manual','auto') NOT NULL DEFAULT 'manual';
ALTER TABLE products ADD COLUMN duration_days INT UNSIGNED NULL;
ALTER TABLE products ADD COLUMN low_stock_threshold INT UNSIGNED NOT NULL DEFAULT 5;

CREATE TABLE inventory_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  product_id INT UNSIGNED NOT NULL,
  label VARCHAR(160) NOT NULL DEFAULT '',          -- identificador visible para el admin (ej. correo de la cuenta + perfil)
  content TEXT NOT NULL,                           -- credenciales cifradas (AES-256-GCM)
  status ENUM('available','reserved','sold','fallen','expired','disabled') NOT NULL DEFAULT 'available',
  expires_at DATETIME NULL,                        -- vencimiento de la cuenta en el proveedor
  order_item_id INT UNSIGNED NULL,
  customer_id INT UNSIGNED NULL,
  sold_at DATETIME NULL,
  service_ends_at DATETIME NULL,                   -- fin del servicio contratado por el cliente
  replaced_by INT UNSIGNED NULL,
  notes VARCHAR(500) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY ix_inv_product_status (product_id, status),
  KEY ix_inv_order_item (order_item_id),
  KEY ix_inv_customer (customer_id),
  KEY ix_inv_expires (expires_at),
  KEY ix_inv_service_end (service_ends_at),
  CONSTRAINT fk_inv_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
  CONSTRAINT fk_inv_order_item FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE SET NULL,
  CONSTRAINT fk_inv_customer FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Soporte conversacional ----------
ALTER TABLE support_tickets ADD COLUMN kind ENUM('general','account_issue') NOT NULL DEFAULT 'general';
ALTER TABLE support_tickets ADD COLUMN order_item_id INT UNSIGNED NULL;
ALTER TABLE support_tickets ADD COLUMN inventory_item_id INT UNSIGNED NULL;
ALTER TABLE support_tickets ADD COLUMN resolution VARCHAR(30) NULL;
ALTER TABLE support_tickets ADD COLUMN last_message_at DATETIME NULL;

CREATE TABLE ticket_messages (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ticket_id INT UNSIGNED NOT NULL,
  author_role ENUM('customer','admin','system') NOT NULL,
  author_id INT UNSIGNED NULL,
  body TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_tmsg_ticket (ticket_id, created_at),
  CONSTRAINT fk_tmsg_ticket FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Conserva las conversaciones existentes como mensajes.
INSERT INTO ticket_messages (ticket_id, author_role, author_id, body, created_at)
  SELECT id, 'customer', user_id, message, created_at FROM support_tickets;
INSERT INTO ticket_messages (ticket_id, author_role, author_id, body, created_at)
  SELECT id, 'admin', NULL, admin_reply, updated_at FROM support_tickets WHERE admin_reply IS NOT NULL AND admin_reply <> '';
UPDATE support_tickets SET last_message_at = updated_at;

-- ---------- Notificaciones y alertas ----------
CREATE TABLE notifications (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  audience ENUM('user','admin') NOT NULL,
  user_id INT UNSIGNED NULL,                 -- destinatario cuando audience = 'user'
  kind VARCHAR(40) NOT NULL,
  title VARCHAR(160) NOT NULL,
  body VARCHAR(500) NOT NULL DEFAULT '',
  link VARCHAR(200) NULL,
  dedupe_key VARCHAR(120) NULL,
  read_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_notif_dedupe (dedupe_key),
  KEY ix_notif_user (audience, user_id, read_at, created_at),
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
