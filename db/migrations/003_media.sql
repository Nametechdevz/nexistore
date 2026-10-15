-- Imágenes subidas desde el panel (productos y fondos de la tienda).
-- Se guardan en la base de datos para que sobrevivan a cada nuevo despliegue del ZIP.
CREATE TABLE media (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  token CHAR(16) NOT NULL,
  mime VARCHAR(30) NOT NULL,
  size_bytes INT UNSIGNED NOT NULL,
  data MEDIUMBLOB NOT NULL,
  created_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_media_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Galería del producto: lista JSON de URLs (la primera también queda en image_url).
ALTER TABLE products ADD COLUMN gallery TEXT NULL AFTER image_url;
