import { expect, test } from "@playwright/test";

// Verifica la pila completa de `docker compose up` a través de nginx:
// registro, creación de un monitor, check real ejecutado por el worker del
// contenedor y llegada por WebSocket, y el email de invitación capturado por
// Mailpit. Se ejecuta con playwright.docker.config.ts.

const ts = Date.now();
const user = {
  fullName: "Docker Stack",
  username: `e2e-pw-d${ts}`,
  email: `e2e-pw-d${ts}@example.com`,
  password: "Password123!",
};

const MAILPIT_UI = process.env.MAILPIT_UI ?? "http://localhost:8025";

test("la pila de docker compose sirve la web, la API, el WebSocket y el SMTP", async ({ page }) => {
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));

  await test.step("la SPA se sirve desde nginx", async () => {
    await page.goto("/");
    await page.waitForURL("**/login");
    await expect(page.getByRole("heading", { name: "Iniciar sesión" })).toBeVisible();
  });

  await test.step("registro (API a través de /api, mismo origen)", async () => {
    await page.goto("/register");
    await page.fill("#fullName", user.fullName);
    await page.fill("#username", user.username);
    await page.fill("#email", user.email);
    await page.fill("#password", user.password);
    await page.fill("#passwordConfirm", user.password);
    await page.click('button[type="submit"]');
    await page.waitForURL("**/monitors");
  });

  await test.step("crear un monitor", async () => {
    await page.goto("/monitors/new");
    await page.fill("#monitor-name", "Docker E2E");
    await page.fill("#monitor-target", "https://example.com");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/monitors");
    await expect(page.getByText("Docker E2E")).toBeVisible();
  });

  await test.step("el worker del contenedor ejecuta el check y llega por WebSocket", async () => {
    // Sin recargar: el estado cambia solo cuando el evento de Socket.io
    // atraviesa el proxy /socket.io de nginx.
    await expect(page.getByText("Operativo").first()).toBeVisible({ timeout: 60_000 });
  });

  await test.step("la sesión sobrevive a una recarga (cookie por /api/auth)", async () => {
    await page.reload();
    await expect(page.getByRole("heading", { name: "Monitores" })).toBeVisible();
  });

  await test.step("el email de invitación llega a Mailpit", async () => {
    await page.goto("/team");
    await page.fill("#invite-email", `invitado-${ts}@example.com`);
    await page.getByRole("button", { name: "Enviar invitación" }).click();
    await expect(page.getByText(`Invitación enviada a invitado-${ts}@example.com`)).toBeVisible();

    const inbox = await page.request.get(
      `${MAILPIT_UI}/api/v1/search?query=${encodeURIComponent(`invitado-${ts}@example.com`)}`
    );
    expect(inbox.ok()).toBeTruthy();
    const data = (await inbox.json()) as { messages: { Subject: string }[] };
    expect(data.messages.length).toBeGreaterThan(0);
  });

  await test.step("status page pública sin sesión", async () => {
    await page.goto("/status-pages");
    await page.fill('input[placeholder="mi-empresa"]', "estado");
    await page.fill('input[placeholder="Estado de Mi Empresa"]', "Estado Docker");
    await page.locator("label", { hasText: "Docker E2E" }).locator('input[type="checkbox"]').check();
    await page.click('button[type="submit"]');

    const anonymous = await page.context().browser()!.newContext();
    const publicPage = await anonymous.newPage();
    await publicPage.goto(`/status/${user.username}/estado`);
    await expect(publicPage.getByText("Estado Docker")).toBeVisible();
    await anonymous.close();
  });

  await test.step("limpieza", async () => {
    await page.goto("/monitors");
    await page.getByText("Docker E2E").first().click();
    await page.waitForURL(/\/monitors\/[0-9a-f-]{36}$/);
    await page.getByRole("button", { name: "Borrar" }).click();
    await page.getByRole("dialog").getByRole("button", { name: /Borrar/ }).click();
    await page.waitForURL("**/monitors");
  });
});
