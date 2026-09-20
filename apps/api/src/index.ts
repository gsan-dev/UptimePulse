import type { Monitor } from "@uptimepulse/shared";

const exampleMonitor: Monitor = {
  id: "placeholder",
  name: "API arrancada",
  type: "http",
  target: "https://example.com",
  intervalSeconds: 60,
  timeoutMs: 5000,
  isPaused: false,
};

console.log("[api] servidor placeholder arrancado. Monitor de ejemplo:", exampleMonitor);
