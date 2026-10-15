import { useCallback, useEffect, useRef, useState } from "react";
import type { z } from "zod";
import { fieldErrors } from "../../../shared/schemas";
import { ApiError } from "./api";

/** Carga de datos con estados de carga, error y recarga. */
export function useQuery<T>(fetcher: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const id = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const result = await fetcher();
      if (id === seq.current) setData(result);
    } catch (e) {
      if (id === seq.current) setError(e instanceof ApiError ? e : new ApiError(0, "Error inesperado."));
    } finally {
      if (id === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, loading, reload: load, setData };
}

/** Formulario con validación zod en cliente y errores por campo del servidor. */
export function useForm<S extends z.ZodType>(schema: S, initial: z.input<S>) {
  const [values, setValues] = useState<z.input<S>>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [touched, setTouched] = useState(false);

  const set = <K extends keyof z.input<S>>(key: K, value: z.input<S>[K]) => {
    setValues((v) => ({ ...(v as object), [key]: value }) as z.input<S>);
    if (touched) {
      const res = schema.safeParse({ ...(values as object), [key]: value });
      setErrors(res.success ? {} : fieldErrors(res.error));
    } else if (errors[key as string]) {
      setErrors((e) => {
        const next = { ...e };
        delete next[key as string];
        return next;
      });
    }
  };

  const submit = (fn: (data: z.output<S>) => Promise<void>) => async (e?: React.FormEvent) => {
    e?.preventDefault();
    setTouched(true);
    setFormError(null);
    const res = schema.safeParse(values);
    if (!res.success) {
      setErrors(fieldErrors(res.error));
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      await fn(res.data);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields ?? {});
        setFormError(err.message);
      } else {
        setFormError("Ocurrió un error inesperado.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return { values, set, setValues, errors, setErrors, formError, setFormError, submitting, submit };
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · NexiStore` : "NexiStore — Productos digitales";
  }, [title]);
}
