import { sql } from "drizzle-orm";
import type { FastifyInstance, InjectOptions } from "fastify";
import { db } from "@uptimepulse/db";
import { buildServer } from "../src/server.js";

// Utilidades compartidas por los tests de integración de la API (Fase 5.3).
// El servidor se construye con buildServer() (el mismo de producción) y se
// ataca con app.inject(): sin puerto, sin red, misma pila de plugins.

export async function createTestApp(): Promise<FastifyInstance> {
  const app = await buildServer();
  await app.ready();
  return app;
}

/** Deja la base de test vacía. */
export async function truncateAll(): Promise<void> {
  await db.execute(sql`truncate table users, organizations restart identity cascade`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- los tests leen el JSON sin tipar cada respuesta
export type AnyJson = any;

export interface JsonResponse<T = AnyJson> {
  status: number;
  body: T;
  headers: Record<string, string | number | string[] | undefined>;
}

/** app.inject con JSON de ida y vuelta y cabeceras de autenticación opcionales. */
export async function api<T = AnyJson>(
  app: FastifyInstance,
  method: InjectOptions["method"],
  url: string,
  options: {
    token?: string;
    body?: unknown;
    headers?: Record<string, string>;
    cookies?: Record<string, string>;
  } = {}
): Promise<JsonResponse<T>> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  const response = await app.inject({
    method,
    url,
    headers,
    cookies: options.cookies,
    payload: options.body === undefined ? undefined : (options.body as Record<string, unknown>),
  });
  const text = response.body;
  let body: T | undefined;
  try {
    body = text ? (JSON.parse(text) as T) : undefined;
  } catch {
    body = text as unknown as T;
  }
  return { status: response.statusCode, body: body as T, headers: response.headers };
}

let counter = 0;

export interface TestUser {
  id: string;
  username: string;
  email: string;
  password: string;
  token: string;
  organizationId: string;
}

/** Registra un usuario nuevo (con su organización personal) y devuelve su token. */
export async function registerUser(
  app: FastifyInstance,
  overrides: Partial<{ username: string; email: string }> = {}
): Promise<TestUser> {
  counter += 1;
  const username = overrides.username ?? `tester${counter}`;
  const email = overrides.email ?? `${username}@example.com`;
  const password = "Password123!";
  const res = await api(app, "POST", "/auth/register", {
    body: { username, fullName: `Tester ${counter}`, email, password },
  });
  if (res.status !== 201) {
    throw new Error(`registro falló: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const orgs = await api(app, "GET", "/organizations", { token: res.body.accessToken });
  return {
    id: res.body.user.id,
    username,
    email,
    password,
    token: res.body.accessToken,
    organizationId: orgs.body[0].id,
  };
}

export const httpMonitor = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  type: "http",
  target: "https://example.com",
  intervalSeconds: 300,
  timeoutMs: 5000,
  ...extra,
});
