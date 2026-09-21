import { and, asc, eq } from "drizzle-orm";
import { db, organizationMembers, organizations } from "@uptimepulse/db";

export type OrganizationRole = "admin" | "editor" | "readonly";

// Jerarquía de roles (Fase 4.1): cada rol incluye los permisos del anterior.
// readonly: ver. editor: además crear/editar/borrar monitores, canales,
// status pages y ventanas. admin: además gestionar miembros, invitaciones y
// el plan de la organización.
const ROLE_RANK: Record<OrganizationRole, number> = { readonly: 0, editor: 1, admin: 2 };

export function roleSatisfies(actual: OrganizationRole, required: OrganizationRole): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

export interface Membership {
  organizationId: string;
  role: OrganizationRole;
}

export async function getMembership(userId: string, organizationId: string): Promise<Membership | null> {
  const row = await db.query.organizationMembers.findFirst({
    where: and(eq(organizationMembers.userId, userId), eq(organizationMembers.organizationId, organizationId)),
  });
  return row ? { organizationId: row.organizationId, role: row.role } : null;
}

/**
 * Organización "personal" del usuario: la que se creó en su registro (Fase
 * 1.1), identificada por `organizations.owner_user_id`.
 *
 * Hasta la Fase 4.1 era la ÚNICA organización posible y todas las rutas la
 * usaban implícitamente. Ahora un usuario puede pertenecer a varias
 * (invitaciones), así que las rutas autenticadas usan `request.organization`
 * (ver plugins/auth.ts, que respeta la cabecera X-Organization-Id) y esta
 * función queda para lo que de verdad es "personal": la URL pública
 * /status/<username>/<slug> (una URL por usuario, no por organización) y el
 * valor por defecto cuando el cliente no indica organización.
 *
 * Nota: NO vale "la más antigua de las que es miembro" — al aceptar una
 * invitación a una organización creada antes que la suya, esa pasaría a ser
 * la "personal" y el usuario actuaría sobre la equivocada sin saberlo (lo
 * detectó la verificación de la Fase 4.1).
 */
export async function getPrimaryOrganizationId(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ organizationId: organizations.id })
    .from(organizations)
    .innerJoin(
      organizationMembers,
      and(eq(organizationMembers.organizationId, organizations.id), eq(organizationMembers.userId, userId))
    )
    .where(eq(organizations.ownerUserId, userId))
    .orderBy(asc(organizations.createdAt))
    .limit(1);
  return row?.organizationId ?? null;
}

/**
 * Decide la organización sobre la que actúa una petición:
 * - Si llega `X-Organization-Id` y el usuario es miembro, esa (con su rol).
 * - Si llega y NO es miembro, null (la ruta responde 403: no se revela si
 *   la organización existe).
 * - Si no llega, la personal.
 */
export async function resolveOrganization(userId: string, requestedId: string | undefined): Promise<Membership | null> {
  if (requestedId !== undefined && requestedId !== "") {
    return getMembership(userId, requestedId);
  }
  const primaryId = await getPrimaryOrganizationId(userId);
  return primaryId ? getMembership(userId, primaryId) : null;
}
