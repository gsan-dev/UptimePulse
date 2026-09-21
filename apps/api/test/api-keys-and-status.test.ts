import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  api,
  createTestApp,
  httpMonitor,
  registerUser,
  truncateAll,
  type TestUser,
} from "./helpers.js";

describe("API keys", () => {
  let app: FastifyInstance;
  let user: TestUser;

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    await truncateAll();
    user = await registerUser(app);
  });
  afterAll(async () => {
    await app.close();
  });

  it("crea claves con scopes, las usa según el scope y las revoca", async () => {
    const read = await api(app, "POST", `/organizations/${user.organizationId}/api-keys`, {
      token: user.token,
      body: { name: "lectura", scopes: ["read"] },
    });
    expect(read.status).toBe(201);
    expect(read.body.key).toMatch(/^up_[a-f0-9]{64}$/);
    expect(read.body.keyPrefix).toBe(read.body.key.slice(0, 11));

    const write = await api(app, "POST", `/organizations/${user.organizationId}/api-keys`, {
      token: user.token,
      body: { name: "escritura", scopes: ["read", "write"] },
    });

    const list = await api(app, "GET", `/organizations/${user.organizationId}/api-keys`, {
      token: user.token,
    });
    expect(list.body).toHaveLength(2);
    expect(list.body.every((k: { key?: string }) => k.key === undefined)).toBe(true);

    expect((await api(app, "GET", "/monitors", { token: read.body.key })).status).toBe(200);
    expect(
      (await api(app, "POST", "/monitors", { token: read.body.key, body: httpMonitor("x") })).status
    ).toBe(403);
    const created = await api(app, "POST", "/monitors", {
      token: write.body.key,
      body: httpMonitor("desde-clave"),
    });
    expect(created.status).toBe(201);

    // Una clave nunca administra la organización.
    expect((await api(app, "GET", "/organizations", { token: write.body.key })).status).toBe(403);
    expect((await api(app, "GET", "/me", { token: write.body.key })).status).toBe(403);
    expect(
      (
        await api(app, "GET", `/organizations/${user.organizationId}/api-keys`, {
          token: write.body.key,
        })
      ).status
    ).toBe(403);

    // La organización la fija la clave, no la cabecera.
    const other = await registerUser(app);
    const spoof = await api(app, "GET", "/monitors", {
      token: write.body.key,
      headers: { "x-organization-id": other.organizationId },
    });
    expect(spoof.status).toBe(200);
    expect(spoof.body.map((m: { name: string }) => m.name)).toEqual(["desde-clave"]);

    expect((await api(app, "GET", "/monitors", { token: `up_${"0".repeat(64)}` })).status).toBe(
      401
    );
    const revoked = await api(
      app,
      "DELETE",
      `/organizations/${user.organizationId}/api-keys/${read.body.id}`,
      { token: user.token }
    );
    expect(revoked.status).toBe(204);
    expect((await api(app, "GET", "/monitors", { token: read.body.key })).status).toBe(401);

    // Solo un admin crea claves.
    expect(
      (
        await api(app, "POST", `/organizations/${other.organizationId}/api-keys`, {
          token: user.token,
          body: { name: "x", scopes: ["read"] },
        })
      ).status
    ).toBe(403);
    await api(app, "DELETE", `/monitors/${created.body.id}`, { token: user.token });
  });
});

describe("status pages públicas", () => {
  let app: FastifyInstance;
  let user: TestUser;

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    await truncateAll();
    user = await registerUser(app, { username: "gdev-test" });
  });
  afterAll(async () => {
    await app.close();
  });

  it("sirve /public/status/:username/:slug sin sesión y responde 404 idéntico para usuario o slug desconocidos", async () => {
    const monitor = await api(app, "POST", "/monitors", {
      token: user.token,
      body: httpMonitor("web pública"),
    });
    const page = await api(app, "POST", "/status-pages", {
      token: user.token,
      body: { slug: "estado", title: "Estado de mis servicios", monitorIds: [monitor.body.id] },
    });
    expect(page.status).toBe(201);

    const pub = await api(app, "GET", "/public/status/gdev-test/estado");
    expect(pub.status).toBe(200);
    expect(pub.body.title).toBe("Estado de mis servicios");
    expect(pub.body.monitors).toHaveLength(1);
    expect(pub.body.monitors[0].name).toBe("web pública");
    expect(pub.body.monitors[0].target).toBeUndefined();

    const noUser = await api(app, "GET", "/public/status/nadie/estado");
    const noSlug = await api(app, "GET", "/public/status/gdev-test/otra");
    expect(noUser.status).toBe(404);
    expect(noSlug.status).toBe(404);
    expect(noUser.body).toEqual(noSlug.body);

    // Mismo slug en otro usuario: no colisiona (unicidad por organización).
    const other = await registerUser(app, { username: "otro-user" });
    const samePage = await api(app, "POST", "/status-pages", {
      token: other.token,
      body: { slug: "estado", title: "Otra", monitorIds: [] },
    });
    expect(samePage.status).toBe(201);
    const dupSameOrg = await api(app, "POST", "/status-pages", {
      token: user.token,
      body: { slug: "estado", title: "Dup", monitorIds: [] },
    });
    expect(dupSameOrg.status).toBe(409);

    const priv = await api(app, "PATCH", `/status-pages/${page.body.id}`, {
      token: user.token,
      body: { isPublic: false },
    });
    expect(priv.status).toBe(200);
    expect((await api(app, "GET", "/public/status/gdev-test/estado")).status).toBe(404);
    await api(app, "DELETE", `/monitors/${monitor.body.id}`, { token: user.token });
  });
});
