// Reglas de los slugs que aparecen en una URL pública, compartidas entre la
// API (validación real) y el frontend (aviso inmediato en el formulario) —
// mismo criterio que `username.ts`, del que estas reglas son deliberadamente
// una copia relajada: aquí sí se permiten guiones seguidos, porque un slug
// nunca es un identificador de persona.

export const SLUG_MIN_LENGTH = 1;
export const SLUG_MAX_LENGTH = 60;

export const SLUG_REGEX = /^[a-z0-9-]+$/;

export function normalizeSlug(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Devuelve el motivo por el que el slug no vale, o null si es válido. */
export function getSlugError(raw: string): string | null {
  const slug = normalizeSlug(raw);
  if (slug.length < SLUG_MIN_LENGTH) return "No puede estar vacío";
  if (slug.length > SLUG_MAX_LENGTH) return `Máximo ${SLUG_MAX_LENGTH} caracteres`;
  if (!SLUG_REGEX.test(slug)) return "Solo letras minúsculas, números y guiones";
  return null;
}

/**
 * Propuesta de slug a partir de un texto libre (el nombre de la
 * organización, por ejemplo): quita acentos, cambia todo lo que no sea
 * [a-z0-9] por guiones y recorta. Es solo una sugerencia para rellenar el
 * formulario — quien decide sigue siendo la persona, y la API valida.
 */
export function suggestSlug(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LENGTH);
}
