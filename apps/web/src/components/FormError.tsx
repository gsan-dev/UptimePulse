import { ApiError } from "../api/client";

/** Mensaje de error de un formulario (acepta el ApiError tal cual o un texto). */
export function FormError({ error }: { error: ApiError | string | null }) {
  if (!error) return null;
  const message = typeof error === "string" ? error : error.message;
  return <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">{message}</p>;
}
