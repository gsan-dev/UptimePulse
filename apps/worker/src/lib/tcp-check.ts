import net from "node:net";
import type { CheckErrorKind, CheckOutcome } from "./types.js";

export interface TcpCheckInput {
  target: string; // formato "host:puerto", validado al crear el monitor (Fase 1.2)
  timeoutMs: number;
}

export function runTcpCheck(input: TcpCheckInput): Promise<CheckOutcome> {
  const [host, portStr] = input.target.split(":");
  const port = Number(portStr);
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(input.timeoutMs);

    function finish(outcome: CheckOutcome): void {
      socket.destroy();
      resolve(outcome);
    }

    socket.once("connect", () => {
      finish({
        status: "up",
        responseTimeMs: Date.now() - startedAt,
        httpStatus: null,
        errorMessage: null,
        errorKind: null,
      });
    });

    socket.once("timeout", () => {
      finish({
        status: "down",
        responseTimeMs: Date.now() - startedAt,
        httpStatus: null,
        errorMessage: `Timeout tras ${input.timeoutMs}ms conectando a ${host}:${port}`,
        errorKind: "timeout",
      });
    });

    socket.once("error", (error: NodeJS.ErrnoException) => {
      finish({
        status: "down",
        responseTimeMs: Date.now() - startedAt,
        httpStatus: null,
        errorMessage: describeSocketError(error),
        errorKind: classifySocketError(error),
      });
    });
  });
}

function classifySocketError(error: NodeJS.ErrnoException): CheckErrorKind {
  if (error.code === "ENOTFOUND" || error.code === "EAI_AGAIN") return "dns";
  if (error.code === "ETIMEDOUT") return "timeout";
  if (error.code === "ECONNREFUSED" || error.code === "EHOSTUNREACH" || error.code === "ECONNRESET")
    return "connection";
  return "other";
}

function describeSocketError(error: NodeJS.ErrnoException): string {
  if (error.code === "ECONNREFUSED") return "Conexión rechazada";
  if (error.code === "ENOTFOUND") return "No se pudo resolver el nombre de dominio (DNS)";
  if (error.code === "EHOSTUNREACH") return "Host inalcanzable";
  if (error.code === "ETIMEDOUT") return "Tiempo de espera agotado";
  return error.message;
}
