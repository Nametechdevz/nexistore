import { randomBytes } from "node:crypto";
import { execute, query, queryOne } from "../db.js";

/** Tamaño máximo por imagen (el panel ya las reduce antes de subirlas). */
export const MAX_MEDIA_BYTES = 3 * 1024 * 1024;

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

/** Detecta el tipo real por la firma del archivo (no se confía en la cabecera del navegador). SVG no se admite. */
export function sniffImage(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buf.toString("ascii", 0, 6) === "GIF87a" || buf.toString("ascii", 0, 6) === "GIF89a") return "image/gif";
  return null;
}

export const mediaUrl = (id: number, token: string, mime: string) => `/media/${id}-${token}.${EXT[mime] ?? "bin"}`;
/** Comprobantes de pago: solo los ve quien los subió y los administradores. */
export const privateUrl = (id: number, token: string, mime: string) => `/api/files/${id}-${token}.${EXT[mime] ?? "bin"}`;
export const MEDIA_URL_RE = /^\/media\/(\d+)-([a-f0-9]{16})\.(jpg|png|webp|gif)$/;
export const PRIVATE_URL_RE = /^\/api\/files\/(\d+)-([a-f0-9]{16})\.(jpg|png|webp|gif)$/;

export async function saveMedia(buf: Buffer, userId: number | null, opts: { private?: boolean } = {}): Promise<{ id: number; url: string }> {
  const mime = sniffImage(buf);
  if (!mime) throw new Error("Formato no admitido. Usa JPG, PNG, WebP o GIF.");
  const token = randomBytes(8).toString("hex");
  const r = await execute("INSERT INTO media (token, mime, size_bytes, data, created_by, is_private, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?)", [
    token, mime, buf.length, buf, userId, opts.private ? 1 : 0, opts.private ? userId : null,
  ]);
  return { id: r.insertId, url: (opts.private ? privateUrl : mediaUrl)(r.insertId, token, mime) };
}

export async function getMedia(id: number, token: string) {
  return queryOne<{ mime: string; data: Buffer }>("SELECT mime, data FROM media WHERE id = ? AND token = ? AND is_private = 0", [id, token]);
}

export async function getPrivateMedia(id: number, token: string) {
  return queryOne<{ mime: string; data: Buffer; owner_id: number | null }>("SELECT mime, data, owner_id FROM media WHERE id = ? AND token = ? AND is_private = 1", [id, token]);
}

/** Valida que la URL sea un comprobante privado del usuario y devuelve su id. */
export async function ownedProofId(url: string, userId: number): Promise<number | null> {
  const m = PRIVATE_URL_RE.exec(url);
  if (!m) return null;
  const row = await queryOne<{ id: number }>("SELECT id FROM media WHERE id = ? AND token = ? AND is_private = 1 AND owner_id = ?", [Number(m[1]), m[2], userId]);
  return row?.id ?? null;
}

/** URL privada de un comprobante guardado (para mostrarlo al cliente o al admin). */
export async function proofUrlFor(id: number | null): Promise<string | null> {
  if (!id) return null;
  const r = await queryOne<{ token: string; mime: string }>("SELECT token, mime FROM media WHERE id = ?", [id]);
  return r ? privateUrl(id, r.token, r.mime) : null;
}

/**
 * Borra las imágenes subidas que ya no usa ningún producto ni la configuración de la tienda.
 * Solo toca las de más de un día, para no borrar una recién subida que aún no se guardó.
 */
export async function cleanupMedia(): Promise<number> {
  const old = await query<{ id: number }>("SELECT id FROM media WHERE created_at < (UTC_TIMESTAMP() - INTERVAL 1 DAY)");
  if (!old.length) return 0;
  const refs = [
    ...(await query<{ t: string | null }>("SELECT CONCAT_WS(' ', image_url, gallery) AS t FROM products")),
    ...(await query<{ t: string | null }>("SELECT image_url AS t FROM categories WHERE image_url IS NOT NULL")),
    ...(await query<{ t: string | null }>("SELECT CAST(value AS CHAR) AS t FROM settings")),
  ];
  const used = new Set<number>();
  // Comprobantes de pago (se referencian por id).
  for (const r of await query<{ id: number | null }>("SELECT proof_media_id AS id FROM wallet_topups WHERE proof_media_id IS NOT NULL UNION SELECT proof_media_id FROM orders WHERE proof_media_id IS NOT NULL")) {
    if (r.id) used.add(Number(r.id));
  }
  for (const { t } of refs) for (const m of (t ?? "").matchAll(/\/media\/(\d+)-/g)) used.add(Number(m[1]));
  const orphan = old.map((o) => o.id).filter((id) => !used.has(id));
  if (orphan.length) await execute(`DELETE FROM media WHERE id IN (${orphan.map(() => "?").join(",")})`, orphan);
  return orphan.length;
}
