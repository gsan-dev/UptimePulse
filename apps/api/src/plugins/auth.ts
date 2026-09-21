import type { FastifyReply, FastifyRequest } from "fastify";
import { verifyAccessToken } from "../lib/tokens.js";
import { resolveOrganization, roleSatisfies, type OrganizationRole } from "../lib/organizations.js";

export interface AuthenticatedUser {
  id: string;
  email: string;
}

export interface RequestOrganization {
  id: string;
  role: OrganizationRole;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthenticatedUser;
    organization?: RequestOrganization;
  }
}

const ORGANIZATION_HEADER = "x-organization-id";
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * preHandler de Fastify: exige `Authorization: Bearer <accessToken>` válido.
 * Si falta o el token no verifica, corta la petición con 401 antes de llegar
 * al handler de la ruta.
 */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return reply.code(401).send({ error: "No autenticado" });
  }

  const token = header.slice("Bearer ".length);
  try {
    const payload = verifyAccessToken(token);
    request.user = { id: payload.sub, email: payload.email };
  } catch {
    return reply.code(401).send({ error: "Token inválido o caducado" });
  }
}

/**
 * preHandler (después de requireAuth): resuelve la organización activa de la
 * petición y el rol del usuario en ella, en `request.organization`.
 *
 * El frontend manda `X-Organization-Id` con la organización elegida en el
 * selector (Fase 4.1); sin cabecera se usa la personal, así que todo lo
 * anterior a la Fase 4 sigue funcionando igual. Un id de una organización de
 * la que el usuario no es miembro da 403 sin distinguir "no existe" de "no
 * eres miembro".
 */
export async function requireOrganization(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const raw = request.headers[ORGANIZATION_HEADER];
  const requested = Array.isArray(raw) ? raw[0] : raw;
  if (requested !== undefined && requested !== "" && !UUID_REGEX.test(requested)) {
    return reply.code(400).send({ error: "X-Organization-Id debe ser un UUID" });
  }

  const membership = await resolveOrganization(request.user!.id, requested);
  if (!membership) {
    return reply.code(403).send({ error: "No perteneces a esa organización" });
  }
  request.organization = { id: membership.organizationId, role: membership.role };
}

/**
 * Fabrica un preHandler que exige un rol mínimo en la organización activa
 * (readonly < editor < admin). Debe ir después de requireOrganization.
 */
export function requireRole(minimum: OrganizationRole) {
  return async function roleGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const role = request.organization?.role;
    if (!role || !roleSatisfies(role, minimum)) {
      return reply.code(403).send({
        error:
          minimum === "admin"
            ? "Solo un administrador de la organización puede hacer esto"
            : "Tu rol en esta organización es de solo lectura",
      });
    }
  };
}
