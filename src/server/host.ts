import { serve } from "@hono/node-server";

import { SERVER_HOST, SERVER_PORT, createApp, detectMode } from "./app.js";
import { runDirectory } from "./capture.js";
import { openRunStore } from "./store.js";

export function startServer(): ReturnType<typeof serve> {
  const store = openRunStore(runDirectory());
  const mode = detectMode(process.env);
  const app = createApp({ store, mode });
  const server = serve({ fetch: app.fetch, hostname: SERVER_HOST, port: SERVER_PORT });
  process.stdout.write(
    `U7 控制台服务已启动 http://${SERVER_HOST}:${String(SERVER_PORT)}\n${mode.badge}\n`,
  );
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
