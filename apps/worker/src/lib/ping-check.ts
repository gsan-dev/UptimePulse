import { execFile, type ExecException } from "node:child_process";
import { isValidPingTarget } from "@uptimepulse/server-utils";
import type { CheckOutcome } from "./types.js";

export interface PingCheckInput {
  target: string; // host o IP, validado al crear el monitor y revalidado anti-SSRF antes de cada check
  timeoutMs: number;
}

// Un echo ICMP necesita sockets raw (privilegios) en Node, así que se invoca
// el `ping` del sistema operativo. La sintaxis cambia por plataforma:
//   Windows:  ping -n 1 -w <ms>  host
//   Linux:    ping -c 1 -W <s>   host   (-W en segundos enteros)
//   macOS:    ping -c 1 -W <ms>  host   (-W en milisegundos)
// Se usa execFile (sin shell) y el host pasa `isValidPingTarget` (IP o
// hostname, nunca algo que empiece por "-"), así que no hay forma de inyectar
// argumentos aunque el target venga del usuario.

function pingArgs(host: string, timeoutMs: number): string[] {
  if (process.platform === "win32") return ["-n", "1", "-w", String(timeoutMs), host];
  if (process.platform === "darwin") return ["-c", "1", "-W", String(timeoutMs), host];
  return ["-c", "1", "-W", String(Math.max(1, Math.ceil(timeoutMs / 1000))), host];
}

// Solo una respuesta de echo real trae "TTL=" (IPv4) o "time="/"tiempo="
// (Windows no imprime TTL en IPv6). El exit code no basta: en Windows un
// "Host de destino inaccesible" enviado por el propio router también
// devuelve 0, y esas líneas no llevan ni TTL ni tiempo.
const REPLY_REGEX = /ttl[=:]\s*\d+|(?:time|tiempo)[=<]\s*\d+/i;
// "time=15.3 ms" (Unix) · "tiempo=15ms" / "tiempo<1m" (Windows en español).
const RTT_REGEX = /(?:time|tiempo)[=<]\s*(\d+(?:[.,]\d+)?)\s*ms?/i;

export function runPingCheck(input: PingCheckInput): Promise<CheckOutcome> {
  const host = input.target.trim();
  if (!isValidPingTarget(host)) {
    return Promise.resolve({
      status: "down",
      responseTimeMs: null,
      httpStatus: null,
      errorMessage: `Host no válido para ping: ${host}`,
    });
  }

  const startedAt = Date.now();
  return new Promise((resolve) => {
    execFile(
      "ping",
      pingArgs(host, input.timeoutMs),
      // Margen sobre el timeout del propio ping por si el binario se cuelga
      // (p. ej. una resolución DNS lenta que ping no cuenta en su -w).
      { timeout: input.timeoutMs + 2000, windowsHide: true },
      (error, stdout, stderr) => {
        const elapsed = Date.now() - startedAt;
        const output = `${stdout}\n${stderr}`;

        if (REPLY_REGEX.test(output)) {
          const rtt = RTT_REGEX.exec(output);
          const responseTimeMs = rtt ? Math.round(Number(rtt[1].replace(",", "."))) : elapsed;
          resolve({ status: "up", responseTimeMs, httpStatus: null, errorMessage: null });
          return;
        }

        resolve({
          status: "down",
          responseTimeMs: elapsed,
          httpStatus: null,
          errorMessage: describePingFailure(error, output, input.timeoutMs),
        });
      }
    );
  });
}

function describePingFailure(
  error: ExecException | null,
  output: string,
  timeoutMs: number
): string {
  if (error?.code === "ENOENT") return "El comando 'ping' no está disponible en el worker";
  if (error?.killed) {
    return `Timeout tras ${timeoutMs}ms esperando la respuesta ICMP`;
  }
  if (
    /could not find host|no pudo encontrar el host|name or service not known|unknown host|temporary failure in name resolution/i.test(
      output
    )
  ) {
    return "No se pudo resolver el nombre de dominio (DNS)";
  }
  if (/unreachable|inaccesible|transmit failed|error en la transmisi/i.test(output)) {
    return "Host inalcanzable";
  }
  if (/timed out|agotado|100% packet loss|100% perdidos/i.test(output)) {
    return `Sin respuesta ICMP en ${timeoutMs}ms`;
  }
  const firstLine = output
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return firstLine ?? "Ping fallido";
}
