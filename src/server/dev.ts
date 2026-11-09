import { spawn } from "node:child_process";
import path from "node:path";

import { WEB_HOST, WEB_PORT } from "./app.js";
import { startServer } from "./host.js";

const server = startServer();
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const web = spawn(pnpm, ["--dir", "web", "dev"], {
  cwd: path.resolve(process.cwd()),
  stdio: "inherit",
  shell: process.platform === "win32",
});

process.stdout.write(`U7 界面 http://${WEB_HOST}:${String(WEB_PORT)}\n`);

function shutdown(code: number): void {
  if (!web.killed) {
    web.kill("SIGTERM");
  }
  server.close(() => {
    process.exit(code);
  });
}

web.on("exit", (code) => {
  shutdown(code ?? 0);
});
process.on("SIGINT", () => {
  shutdown(0);
});
process.on("SIGTERM", () => {
  shutdown(0);
});
