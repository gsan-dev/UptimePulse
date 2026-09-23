import { afterEach, describe, expect, it, vi } from "vitest";

// dns.lookup se sustituye para no depender de la red: lo que se prueba es la
// lógica de bloqueo, no el resolver del sistema.
vi.mock("node:dns/promises", () => ({
  default: { lookup: vi.fn() },
}));

import dns from "node:dns/promises";
import { assertPublicHost, SsrfBlockedError } from "./ssrf-guard.js";

const lookup = vi.mocked(dns.lookup);

function resolveTo(...addresses: string[]) {
  lookup.mockResolvedValueOnce(
    addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })) as never
  );
}

describe("assertPublicHost", () => {
  afterEach(() => {
    lookup.mockReset();
  });

  it.each([
    "127.0.0.1",
    "127.255.255.254",
    "10.0.0.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // metadatos de AWS/GCP/Azure
    "0.0.0.0",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "::ffff:127.0.0.1",
    "::ffff:10.1.2.3",
  ])("bloquea la IP privada/interna %s sin consultar DNS", async (ip) => {
    await expect(assertPublicHost(ip)).rejects.toBeInstanceOf(SsrfBlockedError);
    expect(lookup).not.toHaveBeenCalled();
  });

  it.each([
    "1.1.1.1",
    "8.8.8.8",
    "172.32.0.1",
    "172.15.0.1",
    "192.169.0.1",
    "2606:4700:4700::1111",
  ])("permite la IP pública %s", async (ip) => {
    await expect(assertPublicHost(ip)).resolves.toBeUndefined();
  });

  it("permite un dominio que resuelve solo a IPs públicas", async () => {
    resolveTo("93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946");
    await expect(assertPublicHost("example.com")).resolves.toBeUndefined();
    expect(lookup).toHaveBeenCalledWith("example.com", { all: true });
  });

  it("bloquea un dominio si CUALQUIERA de sus direcciones es privada (DNS rebinding / round-robin)", async () => {
    resolveTo("93.184.216.34", "10.0.0.5");
    await expect(assertPublicHost("rebinding.example")).rejects.toThrow(/10\.0\.0\.5.*privada/);
  });

  it("bloquea un dominio que no resuelve", async () => {
    lookup.mockRejectedValueOnce(new Error("ENOTFOUND"));
    await expect(assertPublicHost("no-existe.invalid")).rejects.toThrow(/No se pudo resolver/);
  });

  it("no comprueba nada con allowPrivateTargets (solo desarrollo)", async () => {
    await expect(
      assertPublicHost("127.0.0.1", { allowPrivateTargets: true })
    ).resolves.toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
  });
});
