import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { checks, db, organizationMembers } from "@uptimepulse/db";
import { regionQueues } from "../src/queue.js";
import {
  api,
  createTestApp,
  httpMonitor,
  registerUser,
  truncateAll,
  type TestUser,
} from "./helpers.js";

describe("monitores", () => {
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

  it("crea un monitor HTTP y programa su job scheduler en la cola", async () => {
    const res = await api(app, "POST", "/monitors", {
      token: user.token,
      body: httpMonitor("web"),
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: "web",
      type: "http",
      target: "https://example.com",
      intervalSeconds: 300,
    });

    const [queue] = regionQueues.all();
    const schedulers = await queue.getJobSchedulers(0, 100);
    expect(schedulers.map((s) => s.key ?? s.id)).toContain(`monitor:${res.body.id}:local`);

    const del = await api(app, "DELETE", `/monitors/${res.body.id}`, { token: user.token });
    expect(del.status).toBe(204);
    const after = await queue.getJobSchedulers(0, 100);
    expect(after.map((s) => s.key ?? s.id)).not.toContain(`monitor:${res.body.id}:local`);
  });

  it("bloquea targets internos (anti-SSRF) y targets de ping inválidos", async () => {
    for (const target of [
      "http://127.0.0.1:3000",
      "http://localhost/admin",
      "http://169.254.169.254/latest/meta-data",
      "http://10.0.0.1",
    ]) {
      const res = await api(app, "POST", "/monitors", {
        token: user.token,
        body: httpMonitor("interno", { target }),
      });
      expect(res.status, target).toBe(422);
      expect(res.body.error, target).toMatch(/privada|interna|resolver/);
    }
    const tcp = await api(app, "POST", "/monitors", {
      token: user.token,
      body: {
        name: "redis",
        type: "tcp",
        target: "127.0.0.1:6379",
        intervalSeconds: 300,
        timeoutMs: 5000,
      },
    });
    expect(tcp.status).toBe(422);
    for (const target of ["http://1.1.1.1", "1.1.1.1:53", "-c 999 1.1.1.1", "1.1.1.1; whoami"]) {
      const res = await api(app, "POST", "/monitors", {
        token: user.token,
        body: { name: "ping", type: "ping", target, intervalSeconds: 300, timeoutMs: 5000 },
      });
      expect(res.status, target).toBe(400);
    }
  });

  it("no hay límite de monitores ni de intervalo más allá de la validación (30 s)", async () => {
    const tooFast = await api(app, "POST", "/monitors", {
      token: user.token,
      body: httpMonitor("rápido", { intervalSeconds: 10 }),
    });
    expect(tooFast.status).toBe(400);
    for (let i = 1; i <= 8; i++) {
      const res = await api(app, "POST", "/monitors", {
        token: user.token,
        body: httpMonitor(`m${i}`, { intervalSeconds: 30 }),
      });
      expect(res.status, `monitor ${i}`).toBe(201);
    }
    const list = await api(app, "GET", "/monitors", { token: user.token });
    expect(list.body).toHaveLength(8);
  });

  it("aísla los monitores por organización y respeta el rol readonly", async () => {
    const created = await api(app, "POST", "/monitors", {
      token: user.token,
      body: httpMonitor("de-A"),
    });
    const other = await registerUser(app);

    const list = await api(app, "GET", "/monitors", { token: other.token });
    expect(list.body).toEqual([]);
    const detail = await api(app, "GET", `/monitors/${created.body.id}`, { token: other.token });
    expect(detail.status).toBe(404);
    const foreignOrg = await api(app, "GET", "/monitors", {
      token: other.token,
      headers: { "x-organization-id": user.organizationId },
    });
    expect(foreignOrg.status).toBe(403);

    // Se añade al segundo usuario como readonly en la organización del primero.
    await db
      .insert(organizationMembers)
      .values({ userId: other.id, organizationId: user.organizationId, role: "readonly" });
    const asReadonly = await api(app, "GET", "/monitors", {
      token: other.token,
      headers: { "x-organization-id": user.organizationId },
    });
    expect(asReadonly.status).toBe(200);
    expect(asReadonly.body).toHaveLength(1);
    const forbidden = await api(app, "POST", "/monitors", {
      token: other.token,
      headers: { "x-organization-id": user.organizationId },
      body: httpMonitor("no-puedo"),
    });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error).toMatch(/solo lectura/);
  });

  it("calcula el uptime % y el tiempo de respuesta medio sobre checks_hourly", async () => {
    const created = await api(app, "POST", "/monitors", {
      token: user.token,
      body: httpMonitor("con-historial"),
    });
    const monitorId = created.body.id as string;
    // Se borran los checks que el worker (si estuviera arrancado) pudiera
    // haber insertado y se escriben 10 en la última hora: 7 up y 3 down.
    await db.delete(checks).where(eq(checks.monitorId, monitorId));
    const now = Date.now();
    await db.insert(checks).values(
      Array.from({ length: 10 }, (_, i) => ({
        monitorId,
        timestamp: new Date(now - (i + 1) * 60_000),
        status: i < 7 ? ("up" as const) : ("down" as const),
        responseTimeMs: i < 7 ? 100 + i * 10 : null,
        httpStatus: i < 7 ? 200 : null,
        errorMessage: i < 7 ? null : "Timeout tras 5000ms",
        region: "local",
      }))
    );

    const metrics = await api(app, "GET", `/monitors/${monitorId}/metrics?range=24h`, {
      token: user.token,
    });
    expect(metrics.status).toBe(200);
    expect(metrics.body).toMatchObject({
      totalChecks: 10,
      upChecks: 7,
      downChecks: 3,
      uptimePercentage: 70,
    });
    // media de 100,110,...,160 = 130
    expect(metrics.body.avgResponseTimeMs).toBe(130);

    const series = await api(app, "GET", `/monitors/${monitorId}/timeseries?range=24h`, {
      token: user.token,
    });
    const total = series.body.reduce(
      (acc: number, p: { totalChecks: number }) => acc + p.totalChecks,
      0
    );
    expect(total).toBe(10);

    const badRange = await api(app, "GET", `/monitors/${monitorId}/metrics?range=1y`, {
      token: user.token,
    });
    expect(badRange.status).toBe(400);
  });
});
