import type { FastifyInstance } from "fastify";
import { eq, or, type InferSelectModel } from "drizzle-orm";
import { z } from "zod";
import { db, organizationMembers, organizations, plans, users } from "@uptimepulse/db";
import { getUsernameError, normalizeUsername, type PublicUser } from "@uptimepulse/shared";
import { env } from "../env.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { requireAuth } from "../plugins/auth.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../lib/tokens.js";

const REFRESH_COOKIE = "uptimepulse_refresh";

// Misma regla que ve el formulario (packages/shared/src/username.ts): el
// navegador avisa al instante y la API es la que de verdad decide.
const usernameSchema = z
  .string()
  .transform(normalizeUsername)
  .superRefine((value, ctx) => {
    const error = getUsernameError(value);
    if (error) ctx.addIssue({ code: z.ZodIssueCode.custom, message: error });
  });

const registerSchema = z.object({
  username: usernameSchema,
  fullName: z.string().trim().min(1, "Indica tu nombre").max(100),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
  organizationName: z.string().trim().min(1).max(100).optional(),
});

// Se puede entrar con el email o con el nombre de usuario (el campo se llama
// "identifier" para no mentir sobre lo que acepta).
const loginSchema = z.object({
  identifier: z.string().trim().min(1),
  password: z.string().min(1),
});

const updateMeSchema = z
  .object({
    username: usernameSchema.optional(),
    fullName: z.string().trim().min(1, "Indica tu nombre").max(100).optional(),
  })
  .refine((data) => data.username !== undefined || data.fullName !== undefined, {
    message: "No hay nada que actualizar",
  });

const usernameAvailableSchema = z.object({ username: z.string().min(1).max(100) });

function toPublicUser(user: InferSelectModel<typeof users>): PublicUser {
  const { passwordHash: _passwordHash, oauthId: _oauthId, ...rest } = user;
  return rest;
}

function setRefreshCookie(reply: import("fastify").FastifyReply, token: string): void {
  reply.setCookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.nodeEnv === "production",
    sameSite: "strict",
    path: "/auth",
  });
}

async function isUsernameTaken(username: string, exceptUserId?: string): Promise<boolean> {
  const existing = await db.query.users.findFirst({ where: eq(users.username, username) });
  return existing !== undefined && existing.id !== exceptUserId;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/auth/register", async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const { username, fullName, email, password, organizationName } = parsed.data;

    const existingEmail = await db.query.users.findFirst({ where: eq(users.email, email) });
    if (existingEmail) {
      return reply.code(409).send({ error: "Ese email ya está registrado" });
    }
    if (await isUsernameTaken(username)) {
      return reply.code(409).send({ error: "Ese nombre de usuario ya está en uso" });
    }

    const passwordHash = await hashPassword(password);

    const user = await db.transaction(async (tx) => {
      const [newUser] = await tx.insert(users).values({ username, fullName, email, passwordHash }).returning();
      const freePlan = await tx.query.plans.findFirst({ where: eq(plans.name, "free") });
      const [org] = await tx
        .insert(organizations)
        .values({ name: organizationName ?? `Organización de ${fullName}`, planId: freePlan?.id })
        .returning();
      await tx.insert(organizationMembers).values({
        userId: newUser.id,
        organizationId: org.id,
        role: "admin",
      });
      return newUser;
    });

    const accessToken = signAccessToken({ sub: user.id, email: user.email });
    setRefreshCookie(reply, signRefreshToken({ sub: user.id, email: user.email }));

    return reply.code(201).send({ user: toPublicUser(user), accessToken });
  });

  // Público y sin sesión (lo usa el formulario de registro mientras se
  // escribe), por eso lleva su propio límite de peticiones como
  // /public/status (Fase 3.3): es el único otro endpoint alcanzable sin JWT
  // que consulta la base de datos.
  app.get(
    "/auth/username-available",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = usernameAvailableSchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: "username requerido" });
      }
      const username = normalizeUsername(parsed.data.username);
      const error = getUsernameError(username);
      if (error) {
        return reply.send({ username, available: false, reason: error });
      }
      const taken = await isUsernameTaken(username);
      return reply.send({
        username,
        available: !taken,
        reason: taken ? "Ese nombre de usuario ya está en uso" : undefined,
      });
    }
  );

  app.post("/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const { identifier, password } = parsed.data;
    const normalized = identifier.toLowerCase();

    const user = await db.query.users.findFirst({
      where: or(eq(users.email, normalized), eq(users.username, normalized)),
    });
    if (!user?.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
      return reply.code(401).send({ error: "Credenciales inválidas" });
    }

    const accessToken = signAccessToken({ sub: user.id, email: user.email });
    setRefreshCookie(reply, signRefreshToken({ sub: user.id, email: user.email }));

    return reply.send({ user: toPublicUser(user), accessToken });
  });

  app.post("/auth/refresh", async (request, reply) => {
    const token = request.cookies[REFRESH_COOKIE];
    if (!token) {
      return reply.code(401).send({ error: "No hay refresh token" });
    }
    try {
      const payload = verifyRefreshToken(token);
      const accessToken = signAccessToken({ sub: payload.sub, email: payload.email });
      return reply.send({ accessToken });
    } catch {
      return reply.code(401).send({ error: "Refresh token inválido o caducado" });
    }
  });

  app.post("/auth/logout", async (_request, reply) => {
    reply.clearCookie(REFRESH_COOKIE, { path: "/auth" });
    return reply.code(204).send();
  });

  app.get("/me", { preHandler: requireAuth }, async (request, reply) => {
    const user = await db.query.users.findFirst({ where: eq(users.id, request.user!.id) });
    if (!user) {
      return reply.code(404).send({ error: "Usuario no encontrado" });
    }
    return reply.send(toPublicUser(user));
  });

  // Editar perfil (nombre y username). Necesario, entre otras cosas, para los
  // usuarios anteriores a la migración 0008, que recibieron un username
  // derivado de su email y puede que quieran otro. Cambiar el username cambia
  // las URLs públicas de sus status pages — se avisa en el formulario.
  app.patch("/me", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = updateMeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const { username, fullName } = parsed.data;

    if (username !== undefined && (await isUsernameTaken(username, request.user!.id))) {
      return reply.code(409).send({ error: "Ese nombre de usuario ya está en uso" });
    }

    const [updated] = await db
      .update(users)
      .set({
        ...(username !== undefined ? { username } : {}),
        ...(fullName !== undefined ? { fullName } : {}),
      })
      .where(eq(users.id, request.user!.id))
      .returning();
    if (!updated) {
      return reply.code(404).send({ error: "Usuario no encontrado" });
    }
    return reply.send(toPublicUser(updated));
  });
}
