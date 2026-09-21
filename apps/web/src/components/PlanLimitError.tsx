import { Link } from "react-router-dom";
import { ApiError } from "../api/client";
import { isPlanLimitError } from "../api/plans";

/**
 * Mensaje de error de formulario que, si la API rechazó la acción por un
 * límite del plan (422 con `limit` en el cuerpo, Fase 4.3), añade el enlace
 * a la página de planes. Para cualquier otro error, solo el mensaje.
 */
export function FormError({ error }: { error: ApiError | string | null }) {
  if (!error) return null;
  const message = typeof error === "string" ? error : error.message;
  const isLimit = error instanceof ApiError && isPlanLimitError(error.details);
  return (
    <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">
      {message}
      {isLimit && (
        <>
          {" "}
          <Link to="/pricing" className="underline hover:text-red-300">
            Ver planes
          </Link>
        </>
      )}
    </p>
  );
}
