import { createLogger, type Monitor } from "@uptimepulse/shared";

const logger = createLogger("api");

const exampleMonitor: Monitor = {
  id: "00000000-0000-0000-0000-000000000000",
  organizationId: "00000000-0000-0000-0000-000000000000",
  name: "API arrancada",
  type: "http",
  target: "https://example.com",
  method: null,
  headers: null,
  body: null,
  expectedStatus: null,
  intervalSeconds: 60,
  timeoutMs: 5000,
  isPaused: false,
  tags: [],
  createdAt: new Date(),
};

logger.info("servidor placeholder arrancado", { monitor: exampleMonitor });
