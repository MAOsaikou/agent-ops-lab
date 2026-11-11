import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

export default defineConfig({
  testDir: ".",
  testMatch: ["**/*.spec.ts"],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  outputDir: "../.data/playwright",
  use: {
    baseURL: "http://127.0.0.1:47322",
    viewport: { width: 1440, height: 900 },
    trace: "off",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    cwd: path.resolve(import.meta.dirname, ".."),
    command: "pnpm exec tsx e2e/server.ts",
    url: "http://127.0.0.1:47322",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
