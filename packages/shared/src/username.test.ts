import { describe, expect, it } from "vitest";
import { getUsernameError, normalizeUsername, RESERVED_USERNAMES } from "./username.js";

describe("username", () => {
  it("normaliza espacios y mayúsculas", () => {
    expect(normalizeUsername("  GDev ")).toBe("gdev");
  });

  it.each(["gdev", "ana-lopez", "user123", "a-b-c", "abc"])("acepta %s", (name) => {
    expect(getUsernameError(name)).toBeNull();
  });

  it("acepta el username en mayúsculas porque se normaliza antes de validar", () => {
    expect(getUsernameError("GDEV")).toBeNull();
  });

  it.each([
    ["ab", /Mínimo 3/],
    ["a".repeat(31), /Máximo 30/],
    ["con espacio", /Solo letras/],
    ["-empieza", /Solo letras/],
    ["acaba-", /Solo letras/],
    ["doble--guion", /Solo letras/],
    ["ñandu", /Solo letras/],
    ["user_name", /Solo letras/],
    ["admin", /reservado/],
    ["status", /reservado/],
    ["API", /reservado/],
  ])("rechaza %j", (name, message) => {
    expect(getUsernameError(name)).toMatch(message);
  });

  it("ningún nombre reservado se puede registrar", () => {
    for (const reserved of RESERVED_USERNAMES) {
      // "me" cae antes por longitud; el resto por estar reservado.
      expect(getUsernameError(reserved), reserved).not.toBeNull();
    }
  });
});
