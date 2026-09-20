import { eq } from "drizzle-orm";
import { db, organizationMembers } from "@uptimepulse/db";

/**
 * Devuelve la organización "principal" del usuario.
 *
 * Simplificación deliberada para el MVP: cada registro (Fase 1.1) crea
 * exactamente una organización personal, así que basta con la primera
 * membresía encontrada. Cuando llegue la Fase 4 (equipos, un usuario en
 * varias organizaciones) esto deberá sustituirse por un organizationId
 * explícito (header o parámetro), elegido por el usuario en el frontend.
 */
export async function getPrimaryOrganizationId(userId: string): Promise<string | null> {
  const membership = await db.query.organizationMembers.findFirst({
    where: eq(organizationMembers.userId, userId),
  });
  return membership?.organizationId ?? null;
}
