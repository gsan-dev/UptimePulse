import { describe, expect, it } from "vitest";
import { extractHostname, isValidPingTarget } from "./target.js";

describe("extractHostname", () => {
  it("saca el host según el tipo de monitor", () => {
    expect(extractHostname("http", "https://Example.com:8443/ruta?x=1")).toBe("example.com");
    expect(extractHostname("http", "http://[::1]:3000/")).toBe("[::1]");
    expect(extractHostname("tcp", "db.example.com:5432")).toBe("db.example.com");
    expect(extractHostname("ping", "1.1.1.1")).toBe("1.1.1.1");
  });

  it("falla con una URL HTTP inválida", () => {
    expect(() => extractHostname("http", "no es una url")).toThrow();
  });
});

describe("isValidPingTarget", () => {
  it.each([
    "1.1.1.1",
    "example.com",
    "sub.dominio-con-guion.example.",
    "::1",
    "2606:4700:4700::1111",
    "localhost",
  ])("acepta %s", (target) => {
    expect(isValidPingTarget(target)).toBe(true);
  });

  it.each([
    "-c 999 1.1.1.1", // flag para el proceso ping
    "1.1.1.1:53", // puerto
    "http://1.1.1.1", // esquema
    "1.1.1.1; whoami", // shell
    "host con espacios",
    "-example.com",
    "ejemplo..com",
    "",
    "a".repeat(254),
  ])("rechaza %j", (target) => {
    expect(isValidPingTarget(target)).toBe(false);
  });
});
