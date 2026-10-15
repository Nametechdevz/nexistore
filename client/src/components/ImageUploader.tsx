import { useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { useToast } from "../lib/state";
import { Icon } from "./Icon";
import { Spinner } from "./ui";

const ACCEPT = "image/jpeg,image/png,image/webp,image/gif";
const MAX_INPUT = 15 * 1024 * 1024; // archivo original; se reduce antes de subir
const MAX_UPLOAD = 3 * 1024 * 1024;

/**
 * Reduce la imagen en el navegador (lado mayor ≤ maxSide) y la convierte a WebP/JPEG.
 * Así se sube rápido, ocupa poco en la base de datos y se eliminan los metadatos (GPS, cámara…).
 * Los GIF se suben tal cual para conservar la animación.
 */
async function prepare(file: File, maxSide: number): Promise<Blob> {
  if (file.type === "image/gif") return file;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("No se pudo leer la imagen."));
      i.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const toBlob = (type: string) => new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.86));
    const webp = await toBlob("image/webp");
    const out = webp && webp.type === "image/webp" ? webp : await toBlob("image/jpeg");
    if (!out) throw new Error("No se pudo procesar la imagen.");
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function uploadImage(file: File, maxSide = 1600): Promise<string> {
  if (!ACCEPT.split(",").includes(file.type)) throw new Error(`«${file.name}» no es JPG, PNG, WebP ni GIF.`);
  if (file.size > MAX_INPUT) throw new Error(`«${file.name}» pesa más de 15 MB.`);
  const blob = await prepare(file, maxSide);
  if (blob.size > MAX_UPLOAD) throw new Error(`«${file.name}» sigue pesando más de 3 MB después de reducirla.`);
  const r = await api.upload<{ url: string }>("/api/admin/media", blob);
  return r.url;
}

/** Galería editable: subir una o varias, reordenar (la primera es la principal) y quitar. */
export function ImageUploader({
  value,
  onChange,
  max = 8,
  label = "Imágenes",
  hint,
  maxSide,
  aspect = "1 / 1",
}: {
  value: string[];
  onChange: (urls: string[]) => void;
  max?: number;
  label?: string;
  hint?: string;
  maxSide?: number;
  aspect?: string;
}) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(0);
  const [drag, setDrag] = useState(false);
  const single = max === 1;

  const add = async (files: FileList | File[]) => {
    const list = [...files].slice(0, single ? 1 : Math.max(0, max - value.length));
    if (!list.length) {
      toast("error", `Máximo ${max} imágenes.`);
      return;
    }
    setBusy(list.length);
    let current = single ? [] : [...value];
    for (const f of list) {
      try {
        const url = await uploadImage(f, maxSide);
        current = [...current, url];
        onChange(current);
      } catch (e) {
        toast("error", e instanceof ApiError || e instanceof Error ? e.message : "No se pudo subir la imagen.");
      } finally {
        setBusy((n) => n - 1);
      }
    }
  };

  const move = (i: number, d: number) => {
    const next = [...value];
    const [it] = next.splice(i, 1);
    next.splice(i + d, 0, it!);
    onChange(next);
  };

  const canAdd = single || value.length < max;
  return (
    <div className="field">
      <span className="label">{label}</span>
      <div className={`uploader${single ? " is-single" : ""}`} style={{ ["--aspect" as string]: aspect }}>
        {value.map((url, i) => (
          <figure key={url} className="up-item">
            <img src={url} alt={`Imagen ${i + 1}`} loading="lazy" />
            {!single && i === 0 && <span className="up-badge">Principal</span>}
            <div className="up-actions">
              {!single && i > 0 && (
                <button type="button" onClick={() => move(i, -1)} aria-label="Mover a la izquierda" title={i === 1 ? "Hacer principal" : "Mover a la izquierda"}>
                  <Icon name="chevron-left" size={16} />
                </button>
              )}
              {!single && i < value.length - 1 && (
                <button type="button" onClick={() => move(i, 1)} aria-label="Mover a la derecha">
                  <Icon name="chevron-right" size={16} />
                </button>
              )}
              <button type="button" className="danger" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Quitar imagen">
                <Icon name="trash" size={16} />
              </button>
            </div>
          </figure>
        ))}
        {canAdd && (!single || !value.length) && (
          <button
            type="button"
            className={`up-drop${drag ? " is-drag" : ""}`}
            onClick={() => input.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              if (e.dataTransfer.files.length) void add(e.dataTransfer.files);
            }}
            disabled={busy > 0}
          >
            {busy > 0 ? <Spinner /> : <Icon name="image-plus" size={26} />}
            <span>{busy > 0 ? `Subiendo ${busy}…` : single ? "Subir imagen" : value.length ? "Agregar más" : "Subir imágenes"}</span>
            <small>Arrastra o haz clic</small>
          </button>
        )}
      </div>
      {single && value.length > 0 && (
        <button type="button" className="btn btn-outline btn-sm" style={{ justifySelf: "start" }} onClick={() => input.current?.click()} disabled={busy > 0}>
          {busy > 0 ? <Spinner /> : <Icon name="upload" />} Cambiar imagen
        </button>
      )}
      {hint && <span className="hint">{hint}</span>}
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        multiple={!single}
        hidden
        onChange={(e) => {
          if (e.target.files?.length) void add(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
