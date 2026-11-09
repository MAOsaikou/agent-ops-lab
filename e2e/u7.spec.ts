import { mkdirSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

const ARTIFACTS = path.resolve(import.meta.dirname, "../artifacts");

test.beforeAll(() => {
  mkdirSync(ARTIFACTS, { recursive: true });
});

async function openSetup(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("mode-banner")).toContainText("Mock LLM");
  await page.getByRole("button", { name: "开店", exact: true }).click();
}

async function startRun(
  page: Page,
  scenario: "spring" | "supplycut" | "pricewar",
  profile: "steady" | "stressed" = "steady",
): Promise<void> {
  await openSetup(page);
  await page.getByTestId(`scenario-${scenario}`).click();
  await page.getByTestId("seed-input").fill("7");
  await page
    .getByRole("button", { name: profile === "steady" ? "稳妥经营" : "激进经营（会被规则打回）" })
    .click();
  await page.getByTestId("start-run").click();
  await expect(page.getByRole("button", { name: "本回合" })).toBeVisible();
  await expect(page.getByText("本局档案")).toBeVisible();
}

async function settleRun(page: Page): Promise<void> {
  await page.getByTestId("skip-to-end").click();
  await expect(page.getByTestId("locked-count")).toHaveText("8/8");
}

test("顶部横幅说明这是演示模式，数字来自模拟对话", async ({ page }) => {
  await page.goto("/");
  const banner = page.getByTestId("mode-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("演示模式");
  await expect(banner).toContainText("Mock LLM");
  await expect(banner).toContainText("llmMode = mock");
  await expect(page.getByText("服务正常")).toBeVisible();
  await expect(page.getByText("手上的现金")).toBeVisible();

  await page.screenshot({
    path: path.join(ARTIFACTS, "u7-review-no-key.png"),
    clip: { x: 0, y: 0, width: 1440, height: 360 },
  });
});

test("一局 8 个回合走完，账本 8 行全部锁定", async ({ page }) => {
  await startRun(page, "supplycut");
  await settleRun(page);

  await page.getByRole("button", { name: "经营账本", exact: true }).click();
  await expect(page.getByTestId("ledger-locked-badge")).toHaveText("8/8 已锁定");
  const rows = page.locator("table tbody tr");
  await expect(rows).toHaveCount(8);
  await expect(page.getByText("账本和这一局的记录逐行对得上")).toBeVisible();

  await page.getByRole("button", { name: "本回合" }).click();
  await expect(page.getByTestId("locked-count")).toHaveText("8/8");
  await expect(page.getByText("这一回合的结果")).toBeVisible();
  await page.screenshot({ path: path.join(ARTIFACTS, "u7-review-full-run.png") });
});

test("并行提案阶段同时有三个角色在干活", async ({ page }) => {
  await startRun(page, "supplycut");
  await page.getByRole("button", { name: "慢", exact: true }).click();

  await page.waitForFunction(
    () => document.querySelectorAll('[data-status="running"]').length >= 3,
    undefined,
    { timeout: 20_000 },
  );
  const running = await page.locator('[data-status="running"]').count();
  expect(running).toBeGreaterThanOrEqual(3);
  await page.screenshot({ path: path.join(ARTIFACTS, "u7-review-parallel.png") });
});

test("断供谈判有至少两轮真实报价，并且能分清成交与谈崩", async ({ page }) => {
  await startRun(page, "supplycut");
  await settleRun(page);
  await page.getByRole("button", { name: "进货谈判" }).click();

  await expect(page.getByText("断供时怎么谈价")).toBeVisible();
  const rows = page.locator("table tbody tr");
  await expect(rows.first()).toBeVisible();
  const count = await rows.count();
  expect(count).toBeGreaterThanOrEqual(4);
  await expect(page.getByText("再讲讲价").first()).toBeVisible();
  await expect(page.getByText("成交").first()).toBeVisible();
  await page.screenshot({ path: path.join(ARTIFACTS, "u7-review-negotiation.png") });
});

test("价格战时广告与降价照实显示为 0", async ({ page }) => {
  await startRun(page, "pricewar");
  await settleRun(page);
  await page.getByRole("button", { name: "进货谈判" }).click();

  await expect(page.getByText("营销钱怎么花")).toBeVisible();
  await expect(page.getByText(/算下来会亏/).first()).toBeVisible();
  await expect(page.getByText("先不花").first()).toBeVisible();
  const zeroCells = await page.getByText("先不花").count();
  expect(zeroCells).toBeGreaterThanOrEqual(1);
  await page.screenshot({ path: path.join(ARTIFACTS, "u7-review-budget.png") });
});

test("账本没有重做入口，直接请求改账会被拒绝", async ({ page }) => {
  await startRun(page, "supplycut");
  await settleRun(page);
  await page.getByRole("button", { name: "经营账本", exact: true }).click();

  await expect(page.getByRole("button", { name: /重做|回滚|重新结算/ })).toHaveCount(0);
  await expect(page.getByText("没有重做入口")).toBeVisible();

  await page.getByTestId("probe-lock").click();
  await expect(page.getByTestId("probe-result")).toContainText("409");
  await expect(page.getByTestId("probe-result")).toContainText("round-locked");
  await page.screenshot({ path: path.join(ARTIFACTS, "u7-review-locked.png") });
});

test("375 像素窄屏走完一回合且无横向滚动", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await startRun(page, "spring");
  await settleRun(page);

  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth - doc.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.getByTestId("locked-count")).toHaveText("8/8");
  await page.screenshot({ path: path.join(ARTIFACTS, "u7-review-mobile.png"), fullPage: false });
});

test("激进经营会被打回重算，检查面板写清改到上限与兜底", async ({ page }) => {
  await startRun(page, "supplycut", "stressed");
  await settleRun(page);

  await expect(page.getByText("拍板前的检查")).toBeVisible();
  await expect(page.getByText("建议改改").first()).toBeVisible();
  await expect(page.getByText("改到次数上限").first()).toBeVisible();
  await expect(page.getByText("安全兜底").first()).toBeVisible();
  await page.screenshot({ path: path.join(ARTIFACTS, "u7-review-verify.png") });
});

test("店长拍板没有人工入口，界面如实置灰并写明原因", async ({ page }) => {
  await startRun(page, "spring");

  await expect(page.getByText("店长拍板")).toBeVisible();
  await expect(page.getByRole("button", { name: "退回", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "批准", exact: true })).toBeDisabled();
  await expect(page.getByText(/这三个按钮是灰的/)).toBeVisible();
  await page.screenshot({ path: path.join(ARTIFACTS, "u7-review-gate-disabled.png") });
});

test("结果对比显示现金、利润、兜底回合，并标注 U6 未做", async ({ page }) => {
  await startRun(page, "pricewar");
  await settleRun(page);
  await page.getByRole("button", { name: "结果对比", exact: true }).click();

  await expect(page.getByText("同一开局，不同经营结果")).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "最后现金" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "一共赚了" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "稳妥兜底" })).toBeVisible();
  await expect(page.getByText(/起点 7/).first()).toBeVisible();
  await expect(page.getByText(/店里出手 \d+ 次/).first()).toBeVisible();
  await expect(page.getByText(/U6/).first()).toBeVisible();
  await expect(page.locator("table tbody tr").first()).toBeVisible();
  await page.screenshot({ path: path.join(ARTIFACTS, "u7-review-compare.png") });
});
