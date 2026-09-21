import type { FastifyReply, FastifyRequest } from "fastify";
import type { ApiKeyScope } from "@uptimepulse/db";
import { isApiKey, resolveApiKey, roleForScopes } from "../lib/api-keys.js";
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

export interface RequestApiKey {
  id: string;
  organizationId: string;
  scopes: ApiKeyScope[];
}

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthenticatedUser;
    organization?: RequestOrganization;
    /** Presente cuando la petición se autenticó con una API key (Fase 5.1), no con JWT. */
    apiKey?: RequestApiKey;
  }
}

const ORGANIZATION_HEADER = "x-organization-id";
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * preHandler de Fastify: exige `Authorization: Bearer <accessToken>` válido,
 * o `Authorization: Bearer up_<clave>` con una API key de la organización
 * (Fase 5.1). Si falta o no verifica, corta la petición con 401 antes de
 * llegar al handler de la ruta.
 */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return reply.code(401).send({ error: "No autenticado" });
  }

  const token = header.slice("Bearer ".length);
  if (isApiKey(token)) {
    const apiKey = await resolveApiKey(token);
    if (!apiKey) {
      return reply.code(401).send({ error: "API key inválida o revocada" });
    }
    request.apiKey = apiKey;
    // Una API key actúa en nombre de la organización, no de una persona:
    // `user` queda sin definir y las rutas que necesitan un usuario (perfil,
    // equipo, plan) lo rechazan con requireUserSession.
    request.organization = { id: apiKey.organizationId, role: roleForScopes(apiKey.scopes) };
    return;
  }
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
  // Con API key la organización viene fijada por la propia clave; la cabecera
  // se ignora (no se puede usar una clave de una organización en otra).
  if (request.apiKey) return;

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

/**
 * preHandler para rutas que solo tienen sentido para una persona con sesión
 * (perfil, equipo, plan, gestión de API keys): una API key da 403 aunque
 * tenga scope write.
 */
export async function requireUserSession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (request.apiKey || !request.user) {
    return reply.code(403).send({ error: "Esta operación requiere iniciar sesión; no se puede hacer con una API key" });
  }
}
