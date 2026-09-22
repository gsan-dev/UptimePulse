import { expect, test } from "@playwright/test";

// Flujo crítico (TASK.md 5.3): registro → crear monitor → ver su estado.
// Además: la página pública de estado y el borrado con el diálogo propio
// (el confirm() nativo no funciona en todos los entornos, ver ADR).
// Los usuarios que crea (e2e-pw-*) los borra e2e/global-teardown.ts.

const API = "http://localhost:3000";
const ts = Date.now();
const user = {
  fullName: "Prueba E2E",
  username: `e2e-pw-${ts}`,
  email: `e2e-pw-${ts}@example.com`,
  password: "Password123!",
};

test.describe.configure({ mode: "serial" });

test("registro → crear monitor → estado 'Operativo' en tiempo real → status page pública → borrar", async ({
  page,
}) => {
  // Los diálogos nativos se descartan: así se reproduce el entorno donde
  // confirm() devuelve false sin preguntar (VS Code, iframes con sandbox).
  page.on("dialog", (dialog) => void dialog.dismiss());

  await test.step("registro con comprobación de username en vivo", async () => {
    await page.goto("/register");
    await page.fill("#fullName", user.fullName);
    await page.fill("#username", user.username);
    await expect(page.getByText("Disponible")).toBeVisible();
    await page.fill("#email", user.email);
    await page.fill("#password", user.password);
    await page.fill("#passwordConfirm", user.password);
    await page.click('button[type="submit"]');
    await page.waitForURL("**/monitors");
    await expect(page.getByText("Equipo")).toBeVisible();
  });

  await test.step("crear un monitor HTTP desde el formulario", async () => {
    await page.goto("/monitors/new");
    await page.locator("form input").first().fill("Web E2E");
    await page.fill('input[placeholder="https://ejemplo.com"]', "https://example.com");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/monitors");
    await expect(page.getByText("Web E2E")).toBeVisible();
  });

  await test.step("el estado llega por WebSocket sin recargar", async () => {
    // El worker ejecuta el check inmediato y la API lo emite por Socket.io.
    await expect(page.getByText("Operativo").first()).toBeVisible({ timeout: 30_000 });
  });

  await test.step("la vista de detalle muestra latencia y checks", async () => {
    await page.getByText("Web E2E").first().click();
    await page.waitForURL(/\/monitors\/[0-9a-f-]{36}$/);
    await expect(page.getByText("HTTP · https://example.com")).toBeVisible();
    await expect(page.getByText(/\d+ms/).first()).toBeVisible();
    await expect(page.getByText("Últimos checks")).toBeVisible();
  });

  await test.step("status page pública accesible sin sesión en /status/<username>/<slug>", async () => {
    await page.goto("/status-pages");
    await page.fill('input[placeholder="mi-empresa"]', "estado");
    await page.fill('input[placeholder="Estado de Mi Empresa"]', "Estado E2E");
    await page.locator("label", { hasText: "Web E2E" }).locator('input[type="checkbox"]').check();
    await page.click('button[type="submit"]');
    await expect(page.locator(`a:has-text("/status/${user.username}/estado")`)).toBeVisible();

    const anonymous = await page.context().browser()!.newContext();
    const publicPage = await anonymous.newPage();
    await publicPage.goto(`/status/${user.username}/estado`);
    await expect(publicPage.getByText("Estado E2E")).toBeVisible();
    await expect(publicPage.getByText("Web E2E")).toBeVisible();
    await anonymous.close();
  });

  await test.step("borrar el monitor con el diálogo propio", async () => {
    await page.goto("/monitors");
    await page.getByText("Web E2E").first().click();
    await page.waitForURL(/\/monitors\/[0-9a-f-]{36}$/);
    await page.getByRole("button", { name: "Borrar" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /Borrar/ }).click();
    await page.waitForURL("**/monitors");
    await expect(page.getByText("Web E2E")).toHaveCount(0);
  });

  await test.step("limpieza vía API: sin monitores ni status pages", async () => {
    const login = await page.request.post(`${API}/auth/login`, {
      data: { identifier: user.email, password: user.password },
    });
    const { accessToken } = await login.json();
    const headers = { Authorization: `Bearer ${accessToken}` };
    const pages = await (await page.request.get(`${API}/status-pages`, { headers })).json();
    for (const sp of pages) await page.request.delete(`${API}/status-pages/${sp.id}`, { headers });
    const monitors = await (await page.request.get(`${API}/monitors`, { headers })).json();
    expect(monitors).toEqual([]);
  });
});
