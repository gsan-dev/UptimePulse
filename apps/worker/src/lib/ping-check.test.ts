import { describe, expect, it } from "vitest";
import { describePingFailure, hasEchoReply, parsePingRtt, runPingCheck } from "./ping-check.js";

// Salidas REALES capturadas de `ping` en Windows (español) y Linux.
const WINDOWS_OK = `
Haciendo ping a 1.1.1.1 con 32 bytes de datos:
Respuesta desde 1.1.1.1: bytes=32 tiempo=15ms TTL=55

Estadísticas de ping para 1.1.1.1:
    Paquetes: enviados = 1, recibidos = 1, perdidos = 0
`;
const WINDOWS_IPV6_OK = `
Haciendo ping a ::1 con 32 bytes de datos:
Respuesta desde ::1: tiempo<1m
`;
const WINDOWS_TIMEOUT = `
Haciendo ping a 192.0.2.1 con 32 bytes de datos:
Tiempo de espera agotado para esta solicitud.

Estadísticas de ping para 192.0.2.1:
    Paquetes: enviados = 1, recibidos = 1, perdidos = 1
    (100% perdidos),
`;
const WINDOWS_UNREACHABLE = `
Haciendo ping a 10.99.99.99 con 32 bytes de datos:
Respuesta desde 192.168.1.1: Host de destino inaccesible.
`;
const WINDOWS_IPV6_NO_ROUTE = `
Haciendo ping a 2606:4700:4700::1111 con 32 bytes de datos:
PING: error en la transmisión. Error general.
`;
const WINDOWS_DNS =
  "La solicitud de ping no pudo encontrar el host no-existe.invalid. Compruebe el nombre y vuelva a intentarlo.";
const LINUX_OK = `
PING 1.1.1.1 (1.1.1.1) 56(84) bytes of data.
64 bytes from 1.1.1.1: icmp_seq=1 ttl=57 time=12.3 ms

--- 1.1.1.1 ping statistics ---
1 packets transmitted, 1 received, 0% packet loss, time 0ms
`;
const LINUX_TIMEOUT = `
PING 192.0.2.1 (192.0.2.1) 56(84) bytes of data.

--- 192.0.2.1 ping statistics ---
1 packets transmitted, 0 received, 100% packet loss, time 0ms
`;
const LINUX_DNS = "ping: no-existe.invalid: Name or service not known";

describe("hasEchoReply", () => {
  it("solo reconoce respuestas de echo reales", () => {
    expect(hasEchoReply(WINDOWS_OK)).toBe(true);
    expect(hasEchoReply(WINDOWS_IPV6_OK)).toBe(true);
    expect(hasEchoReply(LINUX_OK)).toBe(true);
    // "Host de destino inaccesible" viene de un router, con exit code 0 en
    // Windows: no es una respuesta del destino.
    expect(hasEchoReply(WINDOWS_UNREACHABLE)).toBe(false);
    expect(hasEchoReply(WINDOWS_TIMEOUT)).toBe(false);
    expect(hasEchoReply(WINDOWS_IPV6_NO_ROUTE)).toBe(false);
    expect(hasEchoReply(LINUX_TIMEOUT)).toBe(false);
  });
});

describe("parsePingRtt", () => {
  it("lee la latencia en los formatos de Windows (ms, <1m) y Linux (12.3 ms)", () => {
    expect(parsePingRtt(WINDOWS_OK)).toBe(15);
    expect(parsePingRtt(WINDOWS_IPV6_OK)).toBe(1);
    expect(parsePingRtt(LINUX_OK)).toBe(12);
    expect(parsePingRtt("Respuesta desde 1.1.1.1: bytes=32 tiempo=15,7ms TTL=55")).toBe(16);
    expect(parsePingRtt(WINDOWS_TIMEOUT)).toBeNull();
  });
});

describe("describePingFailure", () => {
  it("clasifica los fallos con errorKind", () => {
    expect(describePingFailure(null, WINDOWS_DNS, 2000)).toEqual({
      message: "No se pudo resolver el nombre de dominio (DNS)",
      kind: "dns",
    });
    expect(describePingFailure(null, LINUX_DNS, 2000)).toEqual({
      message: "No se pudo resolver el nombre de dominio (DNS)",
      kind: "dns",
    });
    expect(describePingFailure(null, WINDOWS_UNREACHABLE, 2000)).toEqual({
      message: "Host inalcanzable",
      kind: "connection",
    });
    expect(describePingFailure(null, WINDOWS_IPV6_NO_ROUTE, 2000)).toEqual({
      message: "Host inalcanzable",
      kind: "connection",
    });
    expect(describePingFailure(null, WINDOWS_TIMEOUT, 2000)).toEqual({
      message: "Sin respuesta ICMP en 2000ms",
      kind: "timeout",
    });
    expect(describePingFailure(null, LINUX_TIMEOUT, 2000)).toEqual({
      message: "Sin respuesta ICMP en 2000ms",
      kind: "timeout",
    });
    expect(
      describePingFailure({ name: "e", message: "", cmd: "ping", killed: true }, "", 2000)
    ).toEqual({ message: "Timeout tras 2000ms esperando la respuesta ICMP", kind: "timeout" });
    expect(
      describePingFailure({ name: "e", message: "", cmd: "ping", code: "ENOENT" }, "", 2000)
    ).toMatchObject({ kind: "other" });
  });
});

describe("runPingCheck", () => {
  it("rechaza targets que no son IP/hostname sin ejecutar nada", async () => {
    for (const target of ["-c 999 1.1.1.1", "1.1.1.1:53", "1.1.1.1; whoami", "http://1.1.1.1"]) {
      const outcome = await runPingCheck({ target, timeoutMs: 1000 });
      expect(outcome).toMatchObject({
        status: "down",
        responseTimeMs: null,
        errorKind: "invalid_target",
      });
    }
  });
});
