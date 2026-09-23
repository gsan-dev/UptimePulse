import net from "node:net";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runTcpCheck } from "./tcp-check.js";

// Sockets reales contra un servidor local: es lo que hace el check.
let server: net.Server;
let port: number;

beforeAll(async () => {
  server = net.createServer((socket) => socket.end());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe("runTcpCheck", () => {
  it("up cuando el puerto acepta la conexión, con latencia medida", async () => {
    const outcome = await runTcpCheck({ target: `127.0.0.1:${port}`, timeoutMs: 2000 });
    expect(outcome).toMatchObject({
      status: "up",
      httpStatus: null,
      errorMessage: null,
      errorKind: null,
    });
    expect(outcome.responseTimeMs).toBeGreaterThanOrEqual(0);
  });

  it("down con 'Conexión rechazada' (errorKind connection) en un puerto cerrado", async () => {
    const closed = net.createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const closedPort = (closed.address() as AddressInfo).port;
    await new Promise((resolve) => closed.close(resolve));

    const outcome = await runTcpCheck({ target: `127.0.0.1:${closedPort}`, timeoutMs: 2000 });
    expect(outcome).toMatchObject({
      status: "down",
      errorMessage: "Conexión rechazada",
      errorKind: "connection",
    });
  });

  it("down por DNS en un host inexistente", async () => {
    const outcome = await runTcpCheck({
      target: "no-existe-uptimepulse.invalid:443",
      timeoutMs: 3000,
    });
    expect(outcome.status).toBe("down");
    expect(["dns", "other"]).toContain(outcome.errorKind);
  });
});
