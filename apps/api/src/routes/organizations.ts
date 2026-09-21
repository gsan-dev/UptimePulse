import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, organizationInvitations, organizationMembers, organizations, plans, users } from "@uptimepulse/db";
import { createMailer, organizationInvitationEmail } from "@uptimepulse/mailer";
import { createLogger } from "@uptimepulse/shared";
import { env } from "../env.js";
import { getMembership, type OrganizationRole } from "../lib/organizations.js";
import { requireAuth, requireOrganization, requireRole } from "../plugins/auth.js";

const logger = createLogger("api");

const mailer = createMailer({
  host: env.smtpHost,
  port: env.smtpPort,
  secure: env.smtpSecure,
  auth: env.smtpUser && env.smtpPass ? { user: env.smtpUser, pass: env.smtpPass } : undefined,
  from: env.mailFrom,
});

const roleSchema = z.enum(["admin", "editor", "readonly"]);
const idParamSchema = z.object({ id: z.string().uuid() });
const memberParamSchema = z.object({ id: z.string().uuid(), userId: z.string().uuid() });
const invitationParamSchema = z.object({ id: z.string().uuid(), invitationId: z.string().uuid() });
const tokenParamSchema = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) });

const createInvitationSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  role: roleSchema.default("readonly"),
});

const updateMemberSchema = z.object({ role: roleSchema });

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// El token que viaja en el email es aleatorio (32 bytes → 64 hex); en la base
// de datos solo se guarda su sha256, así que ni siquiera con acceso a la
// tabla se puede aceptar una invitación ajena.
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function countAdmins(organizationId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.role, "admin")));
  return row?.count ?? 0;
}

async function findPendingInvitationByToken(token: string) {
  return db.query.organizationInvitations.findFirst({
    where: and(
      eq(organizationInvitations.tokenHash, hashToken(token)),
      isNull(organizationInvitations.acceptedAt),
      gt(organizationInvitations.expiresAt, new Date())
    ),
  });
}

/**
 * Comprueba que la organización de la URL (`:id`) es la activa de la petición
 * (`X-Organization-Id`). Las rutas de equipo reciben el id en la URL para que
 * sean explícitas, pero la autorización (rol) ya la resolvió
 * requireOrganization sobre la cabecera — así no puede haber discrepancia
 * entre "sobre qué organización dices actuar" y "en cuál tienes permiso".
 */
function assertRouteOrganizationMatches(request: { organization?: { id: string } }, routeId: string): boolean {
  return request.organization?.id === routeId;
}

export async function organizationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  // Todas mis organizaciones con mi rol en cada una — es lo que alimenta el
  // selector del frontend. No pasa por requireOrganization a propósito: es
  // justo la ruta que sirve para elegirla.
  app.get("/organizations", async (request, reply) => {
    const rows = await db
      .select({
        id: organizations.id,
        name: organizations.name,
        role: organizationMembers.role,
        createdAt: organizations.createdAt,
        planName: plans.name,
      })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
      .leftJoin(plans, eq(plans.id, organizations.planId))
      .where(eq(organizationMembers.userId, request.user!.id))
      .orderBy(organizations.createdAt);
    return reply.send(rows);
  });

  // --- Todo lo de abajo actúa sobre la organización activa ---
  app.register(async (scoped) => {
    scoped.addHook("preHandler", requireOrganization);

    scoped.get("/organizations/:id/members", async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success || !assertRouteOrganizationMatches(request, params.data.id)) {
        return reply.code(403).send({ error: "No perteneces a esa organización" });
      }
      const rows = await db
        .select({
          userId: users.id,
          username: users.username,
          fullName: users.fullName,
          email: users.email,
          role: organizationMembers.role,
        })
        .from(organizationMembers)
        .innerJoin(users, eq(users.id, organizationMembers.userId))
        .where(eq(organizationMembers.organizationId, params.data.id))
        .orderBy(users.createdAt);
      return reply.send(rows);
    });

    scoped.patch(
      "/organizations/:id/members/:userId",
      { preHandler: requireRole("admin") },
      async (request, reply) => {
        const params = memberParamSchema.safeParse(request.params);
        if (!params.success || !assertRouteOrganizationMatches(request, params.data.id)) {
          return reply.code(403).send({ error: "No perteneces a esa organización" });
        }
        const body = updateMemberSchema.safeParse(request.body);
        if (!body.success) {
          return reply.code(400).send({ error: body.error.flatten() });
        }

        const target = await getMembership(params.data.userId, params.data.id);
        if (!target) {
          return reply.code(404).send({ error: "Ese usuario no es miembro de la organización" });
        }
        // Una organización nunca puede quedarse sin administrador: si el
        // único admin se degradara a sí mismo, nadie podría volver a
        // gestionar miembros ni el plan.
        if (target.role === "admin" && body.data.role !== "admin" && (await countAdmins(params.data.id)) <= 1) {
          return reply.code(409).send({ error: "La organización necesita al menos un administrador" });
        }

        await db
          .update(organizationMembers)
          .set({ role: body.data.role })
          .where(
            and(
              eq(organizationMembers.organizationId, params.data.id),
              eq(organizationMembers.userId, params.data.userId)
            )
          );
        return reply.send({ userId: params.data.userId, role: body.data.role });
      }
    );

    scoped.delete(
      "/organizations/:id/members/:userId",
      { preHandler: requireRole("admin") },
      async (request, reply) => {
        const params = memberParamSchema.safeParse(request.params);
        if (!params.success || !assertRouteOrganizationMatches(request, params.data.id)) {
          return reply.code(403).send({ error: "No perteneces a esa organización" });
        }
        const target = await getMembership(params.data.userId, params.data.id);
        if (!target) {
          return reply.code(404).send({ error: "Ese usuario no es miembro de la organización" });
        }
        if (target.role === "admin" && (await countAdmins(params.data.id)) <= 1) {
          return reply.code(409).send({ error: "La organización necesita al menos un administrador" });
        }
        await db
          .delete(organizationMembers)
          .where(
            and(
              eq(organizationMembers.organizationId, params.data.id),
              eq(organizationMembers.userId, params.data.userId)
            )
          );
        return reply.code(204).send();
      }
    );

    scoped.get("/organizations/:id/invitations", { preHandler: requireRole("admin") }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success || !assertRouteOrganizationMatches(request, params.data.id)) {
        return reply.code(403).send({ error: "No perteneces a esa organización" });
      }
      const rows = await db
        .select({
          id: organizationInvitations.id,
          email: organizationInvitations.email,
          role: organizationInvitations.role,
          expiresAt: organizationInvitations.expiresAt,
          createdAt: organizationInvitations.createdAt,
        })
        .from(organizationInvitations)
        .where(
          and(
            eq(organizationInvitations.organizationId, params.data.id),
            isNull(organizationInvitations.acceptedAt),
            gt(organizationInvitations.expiresAt, new Date())
          )
        )
        .orderBy(organizationInvitations.createdAt);
      return reply.send(rows);
    });

    scoped.post("/organizations/:id/invitations", { preHandler: requireRole("admin") }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success || !assertRouteOrganizationMatches(request, params.data.id)) {
        return reply.code(403).send({ error: "No perteneces a esa organización" });
      }
      const body = createInvitationSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: body.error.flatten() });
      }
      const organizationId = params.data.id;

      // ¿Ya es miembro? (por email → usuario → membresía)
      const existingUser = await db.query.users.findFirst({ where: eq(users.email, body.data.email) });
      if (existingUser && (await getMembership(existingUser.id, organizationId))) {
        return reply.code(409).send({ error: "Ese usuario ya es miembro de la organización" });
      }

      // Una invitación pendiente al mismo email se reemplaza (nuevo token,
      // nueva caducidad, posiblemente nuevo rol) en vez de acumularse.
      await db
        .delete(organizationInvitations)
        .where(
          and(
            eq(organizationInvitations.organizationId, organizationId),
            eq(organizationInvitations.email, body.data.email),
            isNull(organizationInvitations.acceptedAt)
          )
        );

      const token = randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
      const [invitation] = await db
        .insert(organizationInvitations)
        .values({
          organizationId,
          email: body.data.email,
          role: body.data.role,
          tokenHash: hashToken(token),
          invitedByUserId: request.user!.id,
          expiresAt,
        })
        .returning();

      const [org, inviter] = await Promise.all([
        db.query.organizations.findFirst({ where: eq(organizations.id, organizationId) }),
        db.query.users.findFirst({ where: eq(users.id, request.user!.id) }),
      ]);
      const acceptUrl = `${env.appUrl}/invitations/${token}`;
      try {
        await mailer.sendMail({
          to: body.data.email,
          ...organizationInvitationEmail({
            organizationName: org?.name ?? "tu organización",
            invitedByName: inviter?.fullName ?? inviter?.username ?? inviter?.email ?? "Alguien",
            role: body.data.role,
            acceptUrl,
            expiresAt,
          }),
        });
      } catch (error) {
        // Si el correo no sale, la invitación no sirve de nada: se borra y
        // se avisa, en vez de dejar una fila "fantasma" que el admin cree
        // enviada.
        await db.delete(organizationInvitations).where(eq(organizationInvitations.id, invitation.id));
        logger.error("no se pudo enviar el email de invitación", {
          organizationId,
          error: error instanceof Error ? error.message : String(error),
        });
        return reply.code(502).send({ error: "No se pudo enviar el email de invitación, inténtalo de nuevo" });
      }

      return reply.code(201).send({
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
        createdAt: invitation.createdAt,
      });
    });

    scoped.delete(
      "/organizations/:id/invitations/:invitationId",
      { preHandler: requireRole("admin") },
      async (request, reply) => {
        const params = invitationParamSchema.safeParse(request.params);
        if (!params.success || !assertRouteOrganizationMatches(request, params.data.id)) {
          return reply.code(403).send({ error: "No perteneces a esa organización" });
        }
        const deleted = await db
          .delete(organizationInvitations)
          .where(
            and(
              eq(organizationInvitations.id, params.data.invitationId),
              eq(organizationInvitations.organizationId, params.data.id)
            )
          )
          .returning({ id: organizationInvitations.id });
        if (deleted.length === 0) {
          return reply.code(404).send({ error: "Invitación no encontrada" });
        }
        return reply.code(204).send();
      }
    );
  });
}

/**
 * Rutas de invitación que ve el INVITADO. `GET /invitations/:token` es
 * pública (quien tiene el enlace todavía puede no tener cuenta) y solo
 * revela lo imprescindible para decidir: organización, rol y a qué email se
 * envió. Aceptar exige sesión, y que el email de la sesión coincida con el
 * de la invitación — el enlace por sí solo no basta para colarse en una
 * organización con otra cuenta.
 */
export async function invitationRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/invitations/:token",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const params = tokenParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(404).send({ error: "Invitación no válida o caducada" });
      }
      const invitation = await findPendingInvitationByToken(params.data.token);
      if (!invitation) {
        return reply.code(404).send({ error: "Invitación no válida o caducada" });
      }
      const org = await db.query.organizations.findFirst({ where: eq(organizations.id, invitation.organizationId) });
      return reply.send({
        organizationName: org?.name ?? "",
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
      });
    }
  );

  app.post("/invitations/:token/accept", { preHandler: requireAuth }, async (request, reply) => {
    const params = tokenParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(404).send({ error: "Invitación no válida o caducada" });
    }
    const invitation = await findPendingInvitationByToken(params.data.token);
    if (!invitation) {
      return reply.code(404).send({ error: "Invitación no válida o caducada" });
    }
    if (invitation.email !== request.user!.email.toLowerCase()) {
      return reply
        .code(403)
        .send({ error: `Esta invitación es para ${invitation.email}; inicia sesión con esa cuenta para aceptarla` });
    }

    const role: OrganizationRole = invitation.role;
    await db.transaction(async (tx) => {
      const existing = await tx.query.organizationMembers.findFirst({
        where: and(
          eq(organizationMembers.userId, request.user!.id),
          eq(organizationMembers.organizationId, invitation.organizationId)
        ),
      });
      if (!existing) {
        await tx
          .insert(organizationMembers)
          .values({ userId: request.user!.id, organizationId: invitation.organizationId, role });
      }
      await tx
        .update(organizationInvitations)
        .set({ acceptedAt: new Date() })
        .where(eq(organizationInvitations.id, invitation.id));
    });

    const org = await db.query.organizations.findFirst({ where: eq(organizations.id, invitation.organizationId) });
    return reply.send({ organizationId: invitation.organizationId, organizationName: org?.name ?? "", role });
  });
}
