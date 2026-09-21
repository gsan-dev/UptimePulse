import { describe, expect, it } from "vitest";
import { DEFAULT_REGION, parseRegions, queueNameForRegion, quorumFor } from "./index.js";

describe("parseRegions", () => {
  it("devuelve la región por defecto si no hay valor", () => {
    expect(parseRegions(undefined)).toEqual([DEFAULT_REGION]);
    expect(parseRegions("")).toEqual([DEFAULT_REGION]);
    expect(parseRegions(" , ")).toEqual([DEFAULT_REGION]);
  });

  it("separa por comas, normaliza y elimina duplicados conservando el orden", () => {
    expect(parseRegions(" EU-West, us-east ,eu-west")).toEqual(["eu-west", "us-east"]);
  });

  it.each(["eu_west", "eu west", "eu:west", "-eu", "eu-"])(
    "rechaza la región inválida %j",
    (raw) => {
      expect(() => parseRegions(raw)).toThrow(/Región inválida/);
    }
  );
});

describe("quorumFor", () => {
  it("es la mayoría estricta", () => {
    expect(quorumFor(1)).toBe(1);
    expect(quorumFor(2)).toBe(2);
    expect(quorumFor(3)).toBe(2);
    expect(quorumFor(4)).toBe(3);
    expect(quorumFor(5)).toBe(3);
  });
});

describe("queueNameForRegion", () => {
  it("nunca contiene ':' (BullMQ lo prohíbe en nombres de cola)", () => {
    const name = queueNameForRegion("eu-west");
    expect(name).toBe("monitor-checks--eu-west");
    expect(name).not.toContain(":");
  });
});
