import { describe, expect, it, vi } from "vitest";
import { runHttpCheck, type HttpCheckInput } from "./http-check.js";

// fetch simulado: cada llamada responde según la URL. Las redirecciones se
// prueban sin red y sin DNS; el anti-SSRF de cada salto se ejecuta de
// verdad (IPs literales, no necesita resolver nada).
type Route = { status: number; headers?: Record<string, string> };

function fakeFetch(routes: Record<string, Route>) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const impl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET", body: init?.body });
    const route = routes[url];
    if (!route)
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
    return new Response(null, { status: route.status, headers: route.headers });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const base: Omit<HttpCheckInput, "target" | "fetchImpl"> = {
  method: "GET",
  headers: null,
  body: null,
  expectedStatus: null,
  timeoutMs: 5000,
  region: "eu-west",
};

describe("runHttpCheck", () => {
  it("up con status < 400 y User-Agent con la región", async () => {
    const { impl, calls } = fakeFetch({ "https://example.com/": { status: 200 } });
    const outcome = await runHttpCheck({
      ...base,
      target: "https://example.com/",
      fetchImpl: impl,
    });
    expect(outcome).toMatchObject({ status: "up", httpStatus: 200, errorKind: null });
    const init = vi.mocked(impl).mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe(
      "UptimePulse/1.0 (+region=eu-west)"
    );
    expect(init.redirect).toBe("manual");
    expect(calls).toHaveLength(1);
  });

  it("respeta expectedStatus y clasifica el fallo como unexpected_status", async () => {
    const { impl } = fakeFetch({ "https://example.com/": { status: 200 } });
    const outcome = await runHttpCheck({
      ...base,
      target: "https://example.com/",
      expectedStatus: 204,
      fetchImpl: impl,
    });
    expect(outcome).toMatchObject({
      status: "down",
      httpStatus: 200,
      errorKind: "unexpected_status",
    });
    expect(outcome.errorMessage).toBe("Se esperaba status 204, se obtuvo 200");
  });

  it("sigue redirecciones públicas (relativas y absolutas) y devuelve el status final", async () => {
    const { impl, calls } = fakeFetch({
      "http://example.com/": { status: 301, headers: { location: "https://example.com/" } },
      "https://example.com/": { status: 302, headers: { location: "/inicio" } },
      "https://example.com/inicio": { status: 200 },
    });
    const outcome = await runHttpCheck({ ...base, target: "http://example.com/", fetchImpl: impl });
    expect(outcome).toMatchObject({ status: "up", httpStatus: 200 });
    expect(calls.map((c) => c.url)).toEqual([
      "http://example.com/",
      "https://example.com/",
      "https://example.com/inicio",
    ]);
  });

  it("bloquea una redirección hacia una IP privada sin hacer la petición interna", async () => {
    const { impl, calls } = fakeFetch({
      "https://example.com/": {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data/" },
      },
      "http://169.254.169.254/latest/meta-data/": { status: 200 },
    });
    const outcome = await runHttpCheck({
      ...base,
      target: "https://example.com/",
      fetchImpl: impl,
    });
    expect(outcome).toMatchObject({ status: "down", errorKind: "ssrf" });
    expect(outcome.errorMessage).toMatch(/Redirección bloqueada/);
    expect(calls).toHaveLength(1);
  });

  it("rechaza esquemas que no sean http/https y corta los bucles", async () => {
    const { impl } = fakeFetch({
      "https://example.com/file": { status: 302, headers: { location: "file:///etc/passwd" } },
      "https://example.com/loop": { status: 302, headers: { location: "/loop" } },
    });
    const file = await runHttpCheck({
      ...base,
      target: "https://example.com/file",
      fetchImpl: impl,
    });
    expect(file).toMatchObject({ status: "down", errorKind: "redirect" });
    expect(file.errorMessage).toMatch(/esquema no permitido: file:/);

    const loop = await runHttpCheck({
      ...base,
      target: "https://example.com/loop",
      fetchImpl: impl,
    });
    expect(loop).toMatchObject({ status: "down", errorKind: "redirect" });
    expect(loop.errorMessage).toMatch(/Demasiadas redirecciones/);
    expect(vi.mocked(impl).mock.calls.filter(([u]) => String(u).endsWith("/loop"))).toHaveLength(6);
  });

  it("303 (y 302 con POST) cambian a GET sin body; 307 conserva método y body", async () => {
    const { impl, calls } = fakeFetch({
      "https://example.com/post": { status: 303, headers: { location: "/done" } },
      "https://example.com/done": { status: 200 },
      "https://example.com/keep": { status: 307, headers: { location: "/kept" } },
      "https://example.com/kept": { status: 200 },
    });
    await runHttpCheck({
      ...base,
      target: "https://example.com/post",
      method: "POST",
      body: '{"a":1}',
      fetchImpl: impl,
    });
    expect(calls[1]).toMatchObject({
      url: "https://example.com/done",
      method: "GET",
      body: undefined,
    });
    await runHttpCheck({
      ...base,
      target: "https://example.com/keep",
      method: "POST",
      body: '{"a":1}',
      fetchImpl: impl,
    });
    expect(calls[3]).toMatchObject({
      url: "https://example.com/kept",
      method: "POST",
      body: '{"a":1}',
    });
  });

  it("clasifica errores de red: DNS, conexión rechazada, timeout", async () => {
    const dns = await runHttpCheck({
      ...base,
      target: "https://no-existe.invalid/",
      fetchImpl: fakeFetch({}).impl,
    });
    expect(dns).toMatchObject({
      status: "down",
      errorKind: "dns",
      errorMessage: "No se pudo resolver el nombre de dominio (DNS)",
    });

    const refused = vi.fn(async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    }) as unknown as typeof fetch;
    expect(
      await runHttpCheck({ ...base, target: "https://example.com/", fetchImpl: refused })
    ).toMatchObject({
      errorKind: "connection",
      errorMessage: "Conexión rechazada",
    });

    const timeout = vi.fn(async () => {
      throw Object.assign(new Error("The operation was aborted due to timeout"), {
        name: "TimeoutError",
      });
    }) as unknown as typeof fetch;
    expect(
      await runHttpCheck({ ...base, target: "https://example.com/", fetchImpl: timeout })
    ).toMatchObject({
      errorKind: "timeout",
      errorMessage: "Timeout tras 5000ms",
    });
  });
});
