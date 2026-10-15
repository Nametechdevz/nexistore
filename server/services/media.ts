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
export const MEDIA_URL_RE = /^\/media\/(\d+)-([a-f0-9]{16})\.(jpg|png|webp|gif)$/;

export async function saveMedia(buf: Buffer, userId: number | null): Promise<{ id: number; url: string }> {
  const mime = sniffImage(buf);
  if (!mime) throw new Error("Formato no admitido. Usa JPG, PNG, WebP o GIF.");
  const token = randomBytes(8).toString("hex");
  const r = await execute("INSERT INTO media (token, mime, size_bytes, data, created_by) VALUES (?, ?, ?, ?, ?)", [token, mime, buf.length, buf, userId]);
  return { id: r.insertId, url: mediaUrl(r.insertId, token, mime) };
}

export async function getMedia(id: number, token: string) {
  return queryOne<{ mime: string; data: Buffer }>("SELECT mime, data FROM media WHERE id = ? AND token = ?", [id, token]);
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
    ...(await query<{ t: string | null }>("SELECT CAST(value AS CHAR) AS t FROM settings")),
  ];
  const used = new Set<number>();
  for (const { t } of refs) for (const m of (t ?? "").matchAll(/\/media\/(\d+)-/g)) used.add(Number(m[1]));
  const orphan = old.map((o) => o.id).filter((id) => !used.has(id));
  if (orphan.length) await execute(`DELETE FROM media WHERE id IN (${orphan.map(() => "?").join(",")})`, orphan);
  return orphan.length;
}
