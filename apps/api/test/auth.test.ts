import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { api, createTestApp, registerUser, truncateAll } from "./helpers.js";

describe("autenticación", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(truncateAll);
  afterAll(async () => {
    await app.close();
  });

  it("registra un usuario con su organización personal y devuelve access token + cookie de refresh", async () => {
    const res = await api(app, "POST", "/auth/register", {
      body: {
        username: "Ana-Lopez",
        fullName: "Ana López",
        email: "ANA@Example.com",
        password: "Password123!",
      },
    });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({
      username: "ana-lopez",
      email: "ana@example.com",
      fullName: "Ana López",
    });
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(typeof res.body.accessToken).toBe("string");
    const cookie = String(res.headers["set-cookie"]);
    expect(cookie).toMatch(/uptimepulse_refresh=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Path=\/auth/);

    const orgs = await api(app, "GET", "/organizations", { token: res.body.accessToken });
    expect(orgs.body).toHaveLength(1);
    expect(orgs.body[0]).toMatchObject({ role: "admin" });
  });

  it("rechaza usernames reservados o inválidos y duplicados de email/username", async () => {
    const bad = await api(app, "POST", "/auth/register", {
      body: { username: "admin", fullName: "X", email: "x@example.com", password: "Password123!" },
    });
    expect(bad.status).toBe(400);
    const badChars = await api(app, "POST", "/auth/register", {
      body: {
        username: "con espacios",
        fullName: "X",
        email: "x@example.com",
        password: "Password123!",
      },
    });
    expect(badChars.status).toBe(400);

    await registerUser(app, { username: "primero", email: "primero@example.com" });
    const dupEmail = await api(app, "POST", "/auth/register", {
      body: {
        username: "otro",
        fullName: "X",
        email: "primero@example.com",
        password: "Password123!",
      },
    });
    expect(dupEmail.status).toBe(409);
    const dupUser = await api(app, "POST", "/auth/register", {
      body: {
        username: "primero",
        fullName: "X",
        email: "otro@example.com",
        password: "Password123!",
      },
    });
    expect(dupUser.status).toBe(409);
  });

  it("permite entrar con email o con username, y rechaza contraseñas incorrectas", async () => {
    const user = await registerUser(app, { username: "login-test" });
    const byEmail = await api(app, "POST", "/auth/login", {
      body: { identifier: user.email, password: user.password },
    });
    expect(byEmail.status).toBe(200);
    const byUsername = await api(app, "POST", "/auth/login", {
      body: { identifier: "LOGIN-TEST", password: user.password },
    });
    expect(byUsername.status).toBe(200);
    const wrong = await api(app, "POST", "/auth/login", {
      body: { identifier: user.email, password: "nope" },
    });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error).toBe("Credenciales inválidas");
  });

  it("renueva el access token con la cookie de refresh y /me exige token", async () => {
    const res = await api(app, "POST", "/auth/register", {
      body: {
        username: "refresher",
        fullName: "R",
        email: "r@example.com",
        password: "Password123!",
      },
    });
    const cookie = /uptimepulse_refresh=([^;]+)/.exec(String(res.headers["set-cookie"]))![1];

    const refreshed = await api(app, "POST", "/auth/refresh", {
      cookies: { uptimepulse_refresh: cookie },
    });
    expect(refreshed.status).toBe(200);
    expect(typeof refreshed.body.accessToken).toBe("string");

    const me = await api(app, "GET", "/me", { token: refreshed.body.accessToken });
    expect(me.status).toBe(200);
    expect(me.body.username ?? me.body.user?.username).toBe("refresher");

    const noToken = await api(app, "GET", "/me");
    expect(noToken.status).toBe(401);
    const badToken = await api(app, "GET", "/me", { token: "no-es-un-jwt" });
    expect(badToken.status).toBe(401);
  });

  it("comprueba disponibilidad de username", async () => {
    await registerUser(app, { username: "ocupado" });
    const taken = await api(app, "GET", "/auth/username-available?username=ocupado");
    expect(taken.body.available).toBe(false);
    const free = await api(app, "GET", "/auth/username-available?username=libre");
    expect(free.body.available).toBe(true);
  });

  it("devuelve X-Request-Id y respeta el que manda el cliente", async () => {
    const res = await api(app, "GET", "/health", {
      headers: { "x-request-id": "peticion-de-prueba-1" },
    });
    expect(res.headers["x-request-id"]).toBe("peticion-de-prueba-1");
    const generated = await api(app, "GET", "/health");
    expect(String(generated.headers["x-request-id"])).toMatch(/^[0-9a-f-]{36}$/);
  });
});
