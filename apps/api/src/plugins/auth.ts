import type { FastifyReply, FastifyRequest } from "fastify";
import { verifyAccessToken } from "../lib/tokens.js";

export interface AuthenticatedUser {
  id: string;
  email: string;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
}

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
