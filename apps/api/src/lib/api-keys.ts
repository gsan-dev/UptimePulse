import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { apiKeys, db, type ApiKeyScope } from "@uptimepulse/db";
import type { OrganizationRole } from "./organizations.js";

// Formato de la clave: "up_" + 32 bytes aleatorios en hex. El prefijo fijo
// permite distinguirla de un JWT en la misma cabecera Authorization sin
// intentar verificar la firma primero, y detectarla en escáneres de secretos.
export const API_KEY_PREFIX = "up_";
const API_KEY_REGEX = /^up_[a-f0-9]{64}$/;

export function isApiKey(token: string): boolean {
  return API_KEY_REGEX.test(token);
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function generateApiKey(): { key: string; hash: string; prefix: string } {
  const key = `${API_KEY_PREFIX}${randomBytes(32).toString("hex")}`;
  // Lo que se enseña en la lista para reconocer la clave ("up_3f9a…"), sin
  // revelar nada útil: 8 caracteres de 64 no permiten reconstruirla.
  return { key, hash: hashApiKey(key), prefix: key.slice(0, API_KEY_PREFIX.length + 8) };
}

export interface ResolvedApiKey {
  id: string;
  organizationId: string;
  scopes: ApiKeyScope[];
}

/**
 * Busca la clave por su hash. La comparación final se hace con
 * timingSafeEqual sobre los hashes para no filtrar por tiempo cuántos bytes
 * coinciden (la búsqueda por índice ya es exacta, esto es cinturón y
 * tirantes). Actualiza `last_used_at` sin esperar (no bloquea la petición).
 */
export async function resolveApiKey(key: string): Promise<ResolvedApiKey | null> {
  const hash = hashApiKey(key);
  const row = await db.query.apiKeys.findFirst({ where: eq(apiKeys.keyHash, hash) });
  if (!row) return null;
  if (!timingSafeEqual(Buffer.from(row.keyHash, "hex"), Buffer.from(hash, "hex"))) return null;

  void db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, row.id))
    .catch(() => undefined);

  return { id: row.id, organizationId: row.organizationId, scopes: row.scopes };
}

/** Rol equivalente en la organización: write → editor, read → readonly. Nunca admin. */
export function roleForScopes(scopes: ApiKeyScope[]): OrganizationRole {
  return scopes.includes("write") ? "editor" : "readonly";
}
