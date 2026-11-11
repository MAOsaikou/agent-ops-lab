import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { serve } from "@hono/node-server";

import { memoryAgentRunStore } from "../src/server/agent-runs.js";
import { openLlmSettingsStore } from "../src/server/llm-settings.js";
import { openPlanStore } from "../src/server/plans.js";
import { createPricingApp } from "../src/server/pricing-app.js";

// E2E uses real HTTP and workflow execution without touching merchant dossiers or saved keys.
const app = createPricingApp({
  store: openPlanStore(mkdtempSync(path.join(tmpdir(), "agentops-e2e-"))),
  agentRuns: memoryAgentRunStore(),
  llmSettings: openLlmSettingsStore(null, {}),
});
const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 47321 });
const web = spawn(process.execPath, [path.resolve("web/node_modules/vite/bin/vite.js")], {
  cwd: path.resolve("web"),
  stdio: "inherit",
  windowsHide: true,
});
function stop(code: number): void {
  web.kill();
  server.close(() => process.exit(code));
}
web.on("exit", (code) => stop(code ?? 0));
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
