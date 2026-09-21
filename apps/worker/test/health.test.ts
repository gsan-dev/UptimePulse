import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  checks,
  db,
  incidents,
  maintenanceWindows,
  monitors,
  organizations,
} from "@uptimepulse/db";
import { evaluateMonitorHealth } from "../src/lib/health.js";

// Motor de incidentes multi-región (Fase 4.2) contra la base de datos de
// test real: es una transacción con SELECT … FOR UPDATE y consultas
// DISTINCT ON, así que no tiene sentido probarlo con mocks.

async function createMonitor(): Promise<string> {
  const [org] = await db
    .insert(organizations)
    .values({ name: "org de test" })
    .returning({ id: organizations.id });
  const [monitor] = await db
    .insert(monitors)
    .values({
      organizationId: org!.id,
      name: "m",
      type: "http",
      target: "https://example.com",
      intervalSeconds: 60,
      timeoutMs: 5000,
    })
    .returning({ id: monitors.id });
  return monitor!.id;
}

let clock = Date.now() - 60 * 60_000;
function nextTimestamp(): Date {
  clock += 10_000;
  return new Date(clock);
}

async function addCheck(monitorId: string, region: string, status: "up" | "down"): Promise<Date> {
  const timestamp = nextTimestamp();
  await db.insert(checks).values({
    monitorId,
    region,
    status,
    timestamp,
    responseTimeMs: status === "up" ? 100 : null,
    httpStatus: status === "up" ? 200 : null,
    errorMessage: status === "up" ? null : "Timeout tras 5000ms",
  });
  return timestamp;
}

async function evaluate(monitorId: string, regions: string[], checkTimestamp: Date) {
  return evaluateMonitorHealth({
    monitorId,
    regions,
    failureThreshold: 2,
    checkTimestamp,
    errorMessage: "Timeout tras 5000ms",
  });
}

describe("evaluateMonitorHealth", () => {
  beforeEach(async () => {
    await db.execute(sql`truncate table users, organizations restart identity cascade`);
  });

  it("con una región: abre el incidente al 2º fallo consecutivo y lo cierra al recuperarse", async () => {
    const id = await createMonitor();
    let ts = await addCheck(id, "local", "up");
    let r = await evaluate(id, ["local"], ts);
    expect(r).toMatchObject({ previous: null, current: "up", incidentOpened: false, quorum: 1 });

    ts = await addCheck(id, "local", "down");
    r = await evaluate(id, ["local"], ts);
    // Estado "down" ya (último check), pero sin incidente: 1 fallo < umbral 2.
    expect(r).toMatchObject({ previous: "up", current: "down", incidentOpened: false });

    const secondFailure = await addCheck(id, "local", "down");
    r = await evaluate(id, ["local"], secondFailure);
    expect(r).toMatchObject({
      previous: "down",
      current: "down",
      incidentOpened: true,
      failingRegions: ["local"],
    });
    const [open] = await db.select().from(incidents).where(eq(incidents.monitorId, id));
    expect(open!.resolvedAt).toBeNull();
    expect(open!.causeSummary).toBe("Timeout tras 5000ms");
    // El incidente empieza en el PRIMER fallo de la racha, no en el segundo.
    expect(open!.startedAt.getTime()).toBe(ts.getTime());

    ts = await addCheck(id, "local", "up");
    r = await evaluate(id, ["local"], ts);
    expect(r).toMatchObject({ previous: "down", current: "up", incidentClosed: true });
    const [closed] = await db.select().from(incidents).where(eq(incidents.monitorId, id));
    expect(closed!.resolvedAt?.getTime()).toBe(ts.getTime());
  });

  it("con dos regiones: una caída = degradado sin incidente; las dos = caído con incidente que cita ambas", async () => {
    const id = await createMonitor();
    const regions = ["eu-west", "us-east"];
    await addCheck(id, "eu-west", "up");
    let ts = await addCheck(id, "us-east", "up");
    let r = await evaluate(id, regions, ts);
    expect(r).toMatchObject({ current: "up", quorum: 2, silentRegions: [] });

    await addCheck(id, "us-east", "down");
    ts = await addCheck(id, "us-east", "down");
    r = await evaluate(id, regions, ts);
    expect(r).toMatchObject({
      previous: "up",
      current: "degraded",
      downRegions: ["us-east"],
      incidentOpened: false,
    });
    expect(await db.select().from(incidents).where(eq(incidents.monitorId, id))).toHaveLength(0);

    await addCheck(id, "eu-west", "down");
    ts = await addCheck(id, "eu-west", "down");
    r = await evaluate(id, regions, ts);
    expect(r).toMatchObject({ previous: "degraded", current: "down", incidentOpened: true });
    expect(r.failingRegions.sort()).toEqual(["eu-west", "us-east"]);

    // Se recupera una región: vuelve a degradado y el incidente se cierra
    // (el consolidado ya no es "down").
    ts = await addCheck(id, "us-east", "up");
    r = await evaluate(id, regions, ts);
    expect(r).toMatchObject({ previous: "down", current: "degraded", incidentClosed: true });
  });

  it("una región que aún no ha comprobado nada no cuenta como caída (silentRegions)", async () => {
    const id = await createMonitor();
    await addCheck(id, "eu-west", "down");
    const ts = await addCheck(id, "eu-west", "down");
    const r = await evaluate(id, ["eu-west", "us-east"], ts);
    expect(r).toMatchObject({
      current: "degraded",
      silentRegions: ["us-east"],
      incidentOpened: false,
    });
  });

  it("no abre incidentes dentro de una ventana de mantenimiento", async () => {
    const id = await createMonitor();
    await db.insert(maintenanceWindows).values({
      monitorId: id,
      startsAt: new Date(clock - 60_000),
      endsAt: new Date(clock + 60 * 60_000),
      note: "despliegue",
    });
    await addCheck(id, "local", "down");
    const ts = await addCheck(id, "local", "down");
    const r = await evaluate(id, ["local"], ts);
    expect(r.current).toBe("down");
    expect(r.incidentOpened).toBe(false);
    expect(await db.select().from(incidents).where(eq(incidents.monitorId, id))).toHaveLength(0);
  });
});
