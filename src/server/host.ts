import { serve } from "@hono/node-server";

import { SERVER_HOST, SERVER_PORT } from "./app.js";
import { openPlanStore, plansDirectory } from "./plans.js";
import { createPricingApp } from "./pricing-app.js";
import { agentRunsDirectory, openAgentRunStore } from "./agent-runs.js";
import { openLlmSettingsStore } from "./llm-settings.js";

export function buildServerApp(): ReturnType<typeof createPricingApp> {
  return createPricingApp({
    store: openPlanStore(plansDirectory()),
    agentRuns: openAgentRunStore(agentRunsDirectory()),
    llmSettings: openLlmSettingsStore(`${process.cwd()}/.data/llm-settings.json`, process.env),
  });
}

export function startServer(): ReturnType<typeof serve> {
  const app = buildServerApp();
  const server = serve({ fetch: app.fetch, hostname: SERVER_HOST, port: SERVER_PORT });
  process.stdout.write(`掌柜台服务已启动 http://${SERVER_HOST}:${String(SERVER_PORT)}\n`);
  return server;
}

const invokedDirectly = process.argv[1] !== undefined && process.argv[1].endsWith("host.ts");
if (invokedDirectly) {
  const server = startServer();
  const stop = (): void => {
    server.close(() => {
      process.exit(0);
    });
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}