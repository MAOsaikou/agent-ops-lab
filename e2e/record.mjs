import { mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { chromium } from "@playwright/test";

const ROOT = path.resolve(import.meta.dirname, "..");
const VIDEO_DIR = path.join(ROOT, ".data", "u7-video");
const ARTIFACTS = path.join(ROOT, "artifacts");

rmSync(VIDEO_DIR, { recursive: true, force: true });
mkdirSync(VIDEO_DIR, { recursive: true });
mkdirSync(ARTIFACTS, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: VIDEO_DIR, size: { width: 1440, height: 900 } },
});
const page = await context.newPage();
page.setDefaultTimeout(30_000);

const step = (text) => console.log(`[record] ${text}`);

await page.goto("http://127.0.0.1:47322/");
await page.getByTestId("mode-banner").waitFor();
step("banner visible");
await page.waitForTimeout(1800);

await page.getByRole("button", { name: "开局", exact: true }).click();
await page.waitForTimeout(800);
await page.getByTestId("scenario-supplycut").click();
await page.getByTestId("seed-input").fill("7");
await page.getByRole("button", { name: "稳健策略" }).click();
await page.waitForTimeout(2200);
step("setup filled");
await page.getByTestId("start-run").click();
await page.getByRole("button", { name: "运行控制台" }).waitFor();
await page.getByRole("button", { name: "慢", exact: true }).click();
step("run started, slow replay");

const graph = await page.locator('[data-testid="node-plan"]').boundingBox();
if (graph !== null) {
  await page.mouse.move(graph.x + 60, graph.y + 20);
}
await page.waitForTimeout(6000);
await page.mouse.move(700, 320);
await page.waitForTimeout(400);
await page.mouse.move(760, 420);
await page.waitForTimeout(3000);

const buyer = await page.locator('[data-testid="node-buyer"]').boundingBox();
if (buyer !== null) {
  await page.mouse.move(buyer.x + 60, buyer.y + 20);
}
await page.waitForTimeout(4000);
step("graph replay watched");

await page.getByTestId("skip-to-end").click();
await page.waitForTimeout(1500);
await page.getByTestId("locked-count").waitFor();
step("ledger locked");

await page.getByRole("button", { name: "协商与预算" }).click();
await page.waitForTimeout(4500);
const chart = await page.locator("svg.recharts-surface").first().boundingBox();
if (chart !== null) {
  await page.mouse.move(chart.x + chart.width * 0.55, chart.y + 90);
}
await page.waitForTimeout(2500);
step("negotiation shown");

await page.getByRole("button", { name: "账本", exact: true }).click();
await page.waitForTimeout(2500);
await page.getByTestId("probe-lock").click();
await page.getByTestId("probe-result").waitFor();
await page.waitForTimeout(3000);
step("lock probe answered");

await page.getByRole("button", { name: "对比" }).click();
await page.waitForTimeout(3500);
step("compare shown");

await context.close();
await browser.close();

const files = readdirSync(VIDEO_DIR).filter((name) => name.endsWith(".webm"));
if (files.length === 0) {
  throw new Error("no webm was recorded");
}
const source = path.join(VIDEO_DIR, files[0]);
const target = path.join(ARTIFACTS, "u7-review.mp4");
execFileSync(
  "ffmpeg",
  ["-y", "-loglevel", "error", "-i", source, "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-pix_fmt", "yuv420p", "-movflags", "+faststart", target],
  { stdio: "inherit" },
);
step(`video written ${target}`);
