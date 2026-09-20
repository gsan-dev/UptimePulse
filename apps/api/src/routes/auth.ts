import type { FastifyInstance } from "fastify";
import { eq, type InferSelectModel } from "drizzle-orm";
import { z } from "zod";
import { db, organizationMembers, organizations, plans, users } from "@uptimepulse/db";
import type { PublicUser } from "@uptimepulse/shared";
import { env } from "../env.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { requireAuth } from "../plugins/auth.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../lib/tokens.js";

const REFRESH_COOKIE = "uptimepulse_refresh";

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
  organizationName: z.string().min(1).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

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

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/auth/register", async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const { email, password, organizationName } = parsed.data;

    const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
    if (existing) {
      return reply.code(409).send({ error: "Ese email ya está registrado" });
    }

    const passwordHash = await hashPassword(password);

    const user = await db.transaction(async (tx) => {
      const [newUser] = await tx.insert(users).values({ email, passwordHash }).returning();
      const freePlan = await tx.query.plans.findFirst({ where: eq(plans.name, "free") });
      const [org] = await tx
        .insert(organizations)
        .values({ name: organizationName ?? `Organización de ${email}`, planId: freePlan?.id })
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

  app.post("/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const { email, password } = parsed.data;

    const user = await db.query.users.findFirst({ where: eq(users.email, email) });
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
}
