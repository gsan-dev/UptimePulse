// Reglas del nombre de usuario, compartidas entre la API (validación real) y
// el frontend (aviso inmediato en el formulario, misma regla): así el
// navegador nunca acepta algo que la API vaya a rechazar, ni al revés.

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 30;

// Minúsculas, números y guiones; sin guion al principio ni al final y sin
// guiones seguidos — es lo que va en la URL (/status/<username>/<slug>), así
// que tiene que ser seguro para ella y fácil de teclear.
export const USERNAME_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Nombres que chocarían con rutas o que no deberían poder reclamarse. La
// lista es corta a propósito: solo lo que de verdad daría problemas o
// confundiría (parecer "oficial").
export const RESERVED_USERNAMES = new Set([
  "admin", "administrator", "root", "system", "support", "help",
  "api", "public", "status", "login", "register", "logout", "me",
  "monitors", "channels", "status-pages", "profile", "settings",
  "uptimepulse", "official", "null", "undefined",
]);

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Devuelve el motivo por el que el username no vale, o null si es válido. */
export function getUsernameError(raw: string): string | null {
  const username = normalizeUsername(raw);
  if (username.length < USERNAME_MIN_LENGTH) return `Mínimo ${USERNAME_MIN_LENGTH} caracteres`;
  if (username.length > USERNAME_MAX_LENGTH) return `Máximo ${USERNAME_MAX_LENGTH} caracteres`;
  if (!USERNAME_REGEX.test(username)) {
    return "Solo letras minúsculas, números y guiones (sin empezar ni acabar en guion)";
  }
  if (RESERVED_USERNAMES.has(username)) return "Ese nombre está reservado";
  return null;
}
