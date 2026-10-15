import type { NextFunction, Request, Response } from "express";
import type { z } from "zod";
import { fieldErrors } from "../../shared/schemas.js";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public fields?: Record<string, string>,
    public code?: string,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, fields?: Record<string, string>) => new HttpError(400, msg, fields);
export const notFound = (msg = "No encontrado.") => new HttpError(404, msg);
export const forbidden = (msg = "No tienes permiso para esta acción.") => new HttpError(403, msg);
export const unauthorized = (msg = "Debes iniciar sesión.") => new HttpError(401, msg);
export const conflict = (msg: string, fields?: Record<string, string>) => new HttpError(409, msg, fields);

/** Valida y devuelve datos tipados; lanza 422 con errores por campo. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const res = schema.safeParse(data);
  if (!res.success) {
    throw new HttpError(422, "Revisa los datos del formulario.", fieldErrors(res.error));
  }
  return res.data;
}

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;
export const ah = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res, next).catch(next);
};

export function intParam(value: unknown, name = "id"): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`Parámetro ${name} inválido.`);
  return n;
}

export function pageParams(q: Request["query"], maxSize = 50) {
  const page = Math.max(1, Math.min(10_000, Number(q.page) || 1));
  const pageSize = Math.max(1, Math.min(maxSize, Number(q.pageSize) || 20));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

/** Escapa comodines de LIKE en búsquedas de usuario. */
export const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
