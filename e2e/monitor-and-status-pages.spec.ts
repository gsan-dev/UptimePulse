import { expect, test } from "@playwright/test";

// Lo añadido en la Fase 6, sobre el stack real: etiquetas con filtro,
// formulario HTTP completo, edición completa del monitor, ventanas de
// mantenimiento, línea temporal de incidentes, rango "Todo", status pages
// editables con nombre público y la URL propia de la organización.
// Los usuarios que crea (e2e-pw-*) los borra e2e/global-teardown.ts.

const ts = Date.now();
const user = {
  fullName: "Prueba E2E Fase 6",
  username: `e2e-pw-f6-${ts}`,
  email: `e2e-pw-f6-${ts}@example.com`,
  password: "Password123!",
};

test.describe.configure({ mode: "serial" });

test("monitor completo, mantenimiento e incidentes → status page editable y URL de equipo", async ({
  page,
}) => {
  await test.step("registro", async () => {
    await page.goto("/register");
    await page.fill("#fullName", user.fullName);
    await page.fill("#username", user.username);
    await page.fill("#email", user.email);
    await page.fill("#password", user.password);
    await page.fill("#passwordConfirm", user.password);
    await page.click('button[type="submit"]');
    await page.waitForURL("**/monitors");
  });

  await test.step("crear un monitor con método, cabeceras, body y etiquetas", async () => {
    await page.goto("/monitors/new");
    await page.fill("#monitor-name", "Web E2E F6");
    await page.fill("#monitor-target", "https://example.com");
    await page.fill("#monitor-expected-status", "200");

    await page.getByRole("button", { name: /Petición HTTP/ }).click();
    await page.selectOption("#monitor-method", "POST");
    await page.getByRole("button", { name: "+ Añadir cabecera" }).click();
    await page.getByLabel("Nombre de la cabecera 1").fill("X-Demo");
    await page.getByLabel("Valor de la cabecera 1").fill("uno");
    await page.fill("#monitor-body", '{"ping":"pong"}');

    // "produccion" se confirma con Enter; "api" se deja a medio escribir a
    // propósito: enviar el formulario también tiene que guardarla.
    await page.fill("#monitor-tags", "produccion");
    await page.press("#monitor-tags", "Enter");
    await page.fill("#monitor-tags", "api");

    await page.click('button[type="submit"]');
    await page.waitForURL("**/monitors");
    await expect(page.getByText("Web E2E F6")).toBeVisible();
  });

  await test.step("las etiquetas se ven y filtran en el dashboard", async () => {
    await expect(page.getByRole("button", { name: "produccion", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "api", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "produccion", exact: true }).click();
    await expect(page.getByText("Web E2E F6")).toBeVisible();
    await page.getByRole("button", { name: "Quitar filtro" }).click();
  });

  await test.step("el detalle enseña la petición que se manda de verdad", async () => {
    await page.getByText("Web E2E F6").first().click();
    await page.waitForURL(/\/monitors\/[0-9a-f-]{36}$/);
    await expect(page.getByText("POST https://example.com")).toBeVisible();
    await expect(page.getByText("X-Demo: uno")).toBeVisible();
    await expect(page.getByText('{"ping":"pong"}')).toBeVisible();
    await expect(page.getByText("Status esperado: 200")).toBeVisible();
  });

  await test.step("edición completa: target, timeout, método y etiquetas", async () => {
    await page.getByRole("button", { name: "Editar" }).click();
    await expect(page.getByText(/el tipo no se puede cambiar/)).toBeVisible();

    await page.fill("#monitor-target", "https://example.org");
    await page.fill("#monitor-timeout", "9000");
    await page.selectOption("#monitor-method", "GET");
    await page.fill("#monitor-tags", "editado");
    await page.getByRole("button", { name: "Guardar", exact: true }).click();

    await expect(page.getByText("HTTP · https://example.org")).toBeVisible();
    await expect(page.getByText("9000ms")).toBeVisible();
    await expect(page.locator("header li", { hasText: "editado" })).toBeVisible();
    // Al volver a GET, el body se vacía (se manda null, no se conserva).
    await expect(page.getByText('{"ping":"pong"}')).toHaveCount(0);
  });

  await test.step("ventana de mantenimiento: crear y borrar", async () => {
    await expect(page.getByText("No hay ventanas programadas.")).toBeVisible();
    await page.fill("#maintenance-note", "Despliegue E2E");
    await page.getByRole("button", { name: "Programar ventana" }).click();
    await expect(page.getByText("Despliegue E2E")).toBeVisible();
    await expect(page.getByText("En curso")).toBeVisible();

    await page
      .locator("li", { hasText: "Despliegue E2E" })
      .getByRole("button", { name: "Borrar" })
      .click();
    await page.getByRole("dialog").getByRole("button", { name: /Borrar/ }).click();
    await expect(page.getByText("No hay ventanas programadas.")).toBeVisible();
  });

  await test.step("línea temporal de incidentes y rango 'Todo'", async () => {
    await expect(page.getByRole("heading", { name: "Incidentes" })).toBeVisible();
    await expect(page.getByText("Sin incidentes en este periodo.")).toBeVisible();
    await page.getByRole("button", { name: "Todo" }).click();
    await expect(page.getByRole("button", { name: "Todo" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  await test.step("status page con nombre público, por las dos URLs", async () => {
    await page.goto("/status-pages");
    await page.fill('input[placeholder="mi-empresa"]', "estado");
    await page.fill('input[placeholder="Estado de Mi Empresa"]', "Estado E2E F6");
    await page
      .locator("label", { hasText: "Web E2E F6" })
      .locator('input[type="checkbox"]')
      .check();
    await page.getByLabel("Nombre público de Web E2E F6").fill("Nuestra web");
    await page.click('button[type="submit"]');

    await expect(page.locator(`a:has-text("/status/${user.username}/estado")`)).toBeVisible();
    // La organización nace con el username como slug, así que también tiene
    // URL de equipo desde el primer momento.
    await expect(page.locator(`a:has-text("/status/team/${user.username}/estado")`)).toBeVisible();

    const anonymous = await page.context().browser()!.newContext();
    const publicPage = await anonymous.newPage();
    for (const url of [
      `/status/${user.username}/estado`,
      `/status/team/${user.username}/estado`,
    ]) {
      await publicPage.goto(url);
      await expect(publicPage.getByText("Estado E2E F6")).toBeVisible();
      // El nombre público sustituye al interno.
      await expect(publicPage.getByText("Nuestra web")).toBeVisible();
      await expect(publicPage.getByText("Web E2E F6")).toHaveCount(0);
    }
    await anonymous.close();
  });

  await test.step("editar la status page ya creada", async () => {
    await page.getByRole("button", { name: "Editar" }).click();
    await page.getByLabel("Nombre público de Web E2E F6").fill("Portal");
    await page.getByRole("button", { name: "Guardar cambios" }).click();

    const anonymous = await page.context().browser()!.newContext();
    const publicPage = await anonymous.newPage();
    await publicPage.goto(`/status/${user.username}/estado`);
    await expect(publicPage.getByText("Portal")).toBeVisible();
    await anonymous.close();
  });

  await test.step("cambiar el identificador público de la organización", async () => {
    await page.goto("/team");
    await page.fill("#organization-slug", `acme-${ts}`);
    await page.getByRole("button", { name: "Guardar identificador" }).click();
    await page.getByRole("dialog").getByRole("button", { name: /Cambiar/ }).click();
    await expect(page.getByText("Identificador guardado.")).toBeVisible();

    const anonymous = await page.context().browser()!.newContext();
    const publicPage = await anonymous.newPage();
    await publicPage.goto(`/status/team/acme-${ts}/estado`);
    await expect(publicPage.getByText("Estado E2E F6")).toBeVisible();
    // La URL antigua deja de resolver: el slug es único y se ha movido.
    await publicPage.goto(`/status/team/${user.username}/estado`);
    await expect(publicPage.getByText("Página no encontrada")).toBeVisible();
    await anonymous.close();
  });

  await test.step("limpieza: borrar el monitor (quita su scheduler de la cola)", async () => {
    await page.goto("/monitors");
    await page.getByText("Web E2E F6").first().click();
    await page.waitForURL(/\/monitors\/[0-9a-f-]{36}$/);
    await page.getByRole("button", { name: "Borrar" }).click();
    await page.getByRole("dialog").getByRole("button", { name: /Borrar/ }).click();
    await page.waitForURL("**/monitors");
  });
});
