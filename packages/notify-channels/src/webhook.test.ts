import http from "node:http";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sendGenericWebhook, signWebhookPayload } from "./webhook.js";

// Un receptor real (servidor HTTP local) que verifica la firma sobre los
// bytes exactos que recibe: es lo que haría un cliente del webhook.
let server: http.Server;
let url: string;
let received: {
  signature: string | undefined;
  rawBody: string;
  contentType: string | undefined;
}[] = [];
let respondWith = 200;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      received.push({
        signature: req.headers["x-uptimepulse-signature"] as string | undefined,
        rawBody: raw,
        contentType: req.headers["content-type"],
      });
      res.writeHead(respondWith);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe("webhook genérico firmado", () => {
  it("firma con HMAC-SHA256 en hex", () => {
    const expected = createHmac("sha256", "s3cret").update('{"a":1}').digest("hex");
    expect(signWebhookPayload("s3cret", '{"a":1}')).toBe(expected);
    expect(signWebhookPayload("otro", '{"a":1}')).not.toBe(expected);
  });

  it("el receptor puede verificar la firma sobre el cuerpo recibido", async () => {
    received = [];
    const result = await sendGenericWebhook(url, "s3cret", {
      title: "Caído: web",
      description: "Timeout tras 5000ms",
      tone: "down",
      fields: [{ name: "Región", value: "eu-west" }],
    });
    expect(result).toEqual({ ok: true });
    expect(received).toHaveLength(1);
    const { signature, rawBody, contentType } = received[0]!;
    expect(contentType).toBe("application/json");
    expect(signature).toBe(
      `sha256=${createHmac("sha256", "s3cret").update(rawBody).digest("hex")}`
    );
    const payload = JSON.parse(rawBody);
    expect(payload).toMatchObject({
      event: "down",
      title: "Caído: web",
      description: "Timeout tras 5000ms",
    });
    expect(payload.fields).toEqual([{ name: "Región", value: "eu-west" }]);
    expect(new Date(payload.timestamp).getTime()).not.toBeNaN();
  });

  it("informa del error si el receptor responde con fallo o no existe", async () => {
    respondWith = 500;
    const bad = await sendGenericWebhook(url, "s3cret", {
      title: "t",
      description: "d",
      tone: "up",
    });
    expect(bad).toEqual({ ok: false, error: "El endpoint respondió 500" });
    respondWith = 200;

    const unreachable = await sendGenericWebhook("http://127.0.0.1:1/hook", "s3cret", {
      title: "t",
      description: "d",
      tone: "up",
    });
    expect(unreachable.ok).toBe(false);
    expect(unreachable.error).toBeTruthy();
  });
});
