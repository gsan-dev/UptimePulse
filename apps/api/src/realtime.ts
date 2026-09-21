import type { Server as HttpServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { createRedisConnection } from "@uptimepulse/queue";
import { createLogger } from "@uptimepulse/shared";
import { verifyAccessToken } from "./lib/tokens.js";
import { getPrimaryOrganizationId } from "./lib/organizations.js";
import { env } from "./env.js";

const logger = createLogger("api");

interface SocketData {
  organizationId: string;
}

type AppSocketServer = SocketIOServer<Record<string, never>, Record<string, never>, Record<string, never>, SocketData>;

/**
 * El servidor de Socket.io vive en la API, pero quien de verdad sabe cuándo
 * cambió el estado de un monitor es el worker (proceso separado, Fase 2.1).
 * Por eso este adaptador usa Redis: el worker no abre sockets, solo publica
 * en Redis con un "Emitter" (`@socket.io/redis-emitter`, ver
 * apps/worker/src/lib/realtime-emitter.ts) y este adaptador reenvía ese
 * mensaje a los clientes conectados a la sala correspondiente. Es el mismo
 * patrón pub/sub que ya usa BullMQ, aplicado a WebSockets.
 */
export function attachRealtime(httpServer: HttpServer): AppSocketServer {
  const io: AppSocketServer = new SocketIOServer(httpServer, {
    cors: { origin: true, credentials: true },
  });

  const pubClient = createRedisConnection(env.redisUrl);
  const subClient = pubClient.duplicate();
  io.adapter(createAdapter(pubClient, subClient));

  // Autenticación con el mismo JWT de acceso que usa el resto de la API
  // (Fase 1.1) — no una sesión ni un mecanismo aparte. El cliente lo manda
  // en el "auth" del handshake, no en un header (el protocolo WebSocket no
  // tiene headers custom fáciles de mandar desde el navegador).
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      return next(new Error("No autenticado"));
    }
    try {
      const payload = verifyAccessToken(token);
      const organizationId = await getPrimaryOrganizationId(payload.sub);
      if (!organizationId) {
        return next(new Error("El usuario no pertenece a ninguna organización"));
      }
      socket.data.organizationId = organizationId;
      next();
    } catch {
      next(new Error("Token inválido o caducado"));
    }
  });

  io.on("connection", (socket) => {
    const room = `org:${socket.data.organizationId}`;
    void socket.join(room);
    logger.info("cliente conectado por websocket", { room, socketId: socket.id });

    socket.on("disconnect", (reason) => {
      logger.info("cliente desconectado del websocket", { socketId: socket.id, reason });
    });
  });

  return io;
}
