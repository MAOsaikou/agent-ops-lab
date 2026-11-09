import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

const API = "http://127.0.0.1:47321";
const ARTIFACTS = path.resolve(import.meta.dirname, "../artifacts");

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) {
    return Number.NaN;
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[index] ?? Number.NaN;
}

function summarize(samples: readonly number[]): { count: number; p50: number; p95: number; max: number } {
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    count: sorted.length,
    p50: Number(quantile(sorted, 0.5).toFixed(1)),
    p95: Number(quantile(sorted, 0.95).toFixed(1)),
    max: Number((sorted.at(-1) ?? Number.NaN).toFixed(1)),
  };
}

async function firstNodeRendered(page: Page): Promise<number> {
  const handle = await page.waitForFunction(
    () => {
      if (document.querySelector('[data-testid="node-plan"]') === null) {
        return false;
      }
      return performance.now();
    },
    undefined,
    { timeout: 20_000 },
  );
  return (await handle.jsonValue()) as number;
}

test.beforeAll(async ({ request }) => {
  mkdirSync(ARTIFACTS, { recursive: true });
  const response = await request.post(`${API}/api/runs`, {
    data: { scenario: "spring", seed: 7, profile: "steady" },
  });
  expect(response.status()).toBe(201);
});

test("首屏可交互时间与事件到渲染延迟在预算内", async ({ page }) => {
  const firstScreen: number[] = [];
  const wire: number[] = [];
  const client: number[] = [];
  for (let run = 0; run < 10; run += 1) {
    await page.goto("/", { waitUntil: "commit" });
    const shown = await firstNodeRendered(page);
    const domContentLoaded = await page.evaluate(() => {
      const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      return entry?.domContentLoadedEventEnd ?? 0;
    });
    firstScreen.push(Math.max(0, shown - domContentLoaded));
    await page.waitForTimeout(1200);
    // The performance timeline is per document, so collect this load's frames before reloading.
    const sample = await page.evaluate(() => {
      const pick = (name: string): number[] =>
        performance
          .getEntriesByType("measure")
          .filter((entry) => entry.name === name)
          .map((entry) => entry.duration);
      return { wire: pick("u7-frame-wire"), client: pick("u7-frame-client") };
    });
    wire.push(...sample.wire);
    client.push(...sample.client);
  }

  const first = summarize(firstScreen);
  const wireStats = summarize(wire);
  const clientStats = summarize(client);
  expect(wireStats.count).toBeGreaterThan(30);
  expect(first.p95).toBeLessThan(2000);
  expect(wireStats.p95).toBeLessThan(300);

  writeFileSync(
    path.join(ARTIFACTS, "u7-perf.json"),
    `${JSON.stringify(
      {
        note: "10 次 reload 采样，视口 1440x900，本机无密钥 Mock 回放。首屏 = 页内 DOMContentLoaded 到首个工作流节点渲染。wire = 服务端写帧时间戳到浏览器下一帧渲染（验收指标）；client = 其中扣除网络与 SSE 传输的一段，作为对照，下限受 rAF 约 16.7 毫秒节拍约束。两者都不含 U5 模拟本身的耗时。",
        viewport: "1440x900",
        runs: 10,
        firstScreenMs: first,
        frameLatencyWireMs: wireStats,
        frameLatencyClientMs: clientStats,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
});
