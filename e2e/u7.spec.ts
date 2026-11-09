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
  await page.getByRole("button", { name: "开局", exact: true }).click();
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
    .getByRole("button", { name: profile === "steady" ? "稳健策略" : "压力策略（会被硬约束打回）" })
    .click();
  await page.getByTestId("start-run").click();
  await expect(page.getByRole("button", { name: "运行控制台" })).toBeVisible();
  await expect(page.getByText("运行元数据")).toBeVisible();
}

async function settleRun(page: Page): Promise<void> {
  await page.getByTestId("skip-to-end").click();
  await expect(page.getByTestId("locked-count")).toHaveText("8/8");
}

test("无密钥横幅在顶部标明当前模式", async ({ page }) => {
  await page.goto("/");
  const banner = page.getByTestId("mode-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("无密钥模式");
  await expect(banner).toContainText("Mock LLM");
  await expect(banner).toContainText("llmMode = mock");
  await expect(page.getByText("API 在线")).toBeVisible();

  await page.screenshot({
    path: path.join(ARTIFACTS, "u7-review-no-key.png"),
    clip: { x: 0, y: 0, width: 1440, height: 360 },
  });
});

test("完整 8 回合回放结束后账本 8 行全部锁定", async ({ page }) => {
  await startRun(page, "supplycut");
  await settleRun(page);

  await page.getByRole("button", { name: "账本", exact: true }).click();
  await expect(page.getByTestId("ledger-locked-badge")).toHaveText("8/8 已锁定");
  const rows = page.locator("table tbody tr");
  await expect(rows).toHaveCount(8);
  await expect(page.getByText("与本局运行哈希一致（fold 重算）")).toBeVisible();

  await page.getByRole("button", { name: "运行控制台" }).click();
  await expect(page.getByTestId("locked-count")).toHaveText("8/8");
  await page.screenshot({ path: path.join(ARTIFACTS, "u7-review-full-run.png") });
});

test("并行提案阶段同时有三个节点在运行", async ({ page }) => {
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

test("断供协商有至少两轮真实报价", async ({ page }) => {
  await startRun(page, "supplycut");
  await settleRun(page);
  await page.getByRole("button", { name: "协商与预算" }).click();

  await expect(page.getByText("断供协商报价走势")).toBeVisible();
  const rows = page.locator("table tbody tr");
  await expect(rows.first()).toBeVisible();
  const count = await rows.count();
  expect(count).toBeGreaterThanOrEqual(4);
  await expect(page.getByText("还价").first()).toBeVisible();
  await expect(page.getByText("接受").first()).toBeVisible();
  await page.screenshot({ path: path.join(ARTIFACTS, "u7-review-negotiation.png") });
});

test("价格战的广告与降价分配照实显示为 0", async ({ page }) => {
  await startRun(page, "pricewar");
  await settleRun(page);
  await page.getByRole("button", { name: "协商与预算" }).click();

  await expect(page.getByText("预算决定")).toBeVisible();
  await expect(page.getByText(/负边际，权重取 0/).first()).toBeVisible();
  await expect(page.getByText(/广告与降价都判为负边际/).first()).toBeVisible();
  const zeroCells = await page.getByText("广告与降价都判为负边际").count();
  expect(zeroCells).toBeGreaterThanOrEqual(1);
  await page.screenshot({ path: path.join(ARTIFACTS, "u7-review-budget.png") });
});

test("账本没有重做入口，直接调用提交接口返回冲突", async ({ page }) => {
  await startRun(page, "supplycut");
  await settleRun(page);
  await page.getByRole("button", { name: "账本", exact: true }).click();

  await expect(page.getByRole("button", { name: /重做|回滚|重新结算/ })).toHaveCount(0);
  await expect(page.getByText("重做入口：无")).toBeVisible();

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

test("压力画像被硬约束打回，验证面板出现退回修正与迭代上限", async ({ page }) => {
  await startRun(page, "supplycut", "stressed");
  await settleRun(page);

  await expect(page.getByText("分层验证与修正循环")).toBeVisible();
  await expect(page.getByText("退回修正").first()).toBeVisible();
  await expect(page.getByText("到达迭代上限").first()).toBeVisible();
  await expect(page.getByText("安全兜底").first()).toBeVisible();
  await page.screenshot({ path: path.join(ARTIFACTS, "u7-review-verify.png") });
});

test("店长审批退回入口未实现，界面如实置灰并写明原因", async ({ page }) => {
  await startRun(page, "spring");

  await expect(page.getByText("店长审批")).toBeVisible();
  await expect(page.getByRole("button", { name: "退回", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "批准", exact: true })).toBeDisabled();
  await expect(page.getByText(/审批按钮置灰是如实反映能力边界/)).toBeVisible();
  await page.screenshot({ path: path.join(ARTIFACTS, "u7-review-gate-disabled.png") });
});

test("对比页显示种子、调用量与 Fallback 回合，并标注 U6 未合入", async ({ page }) => {
  await startRun(page, "pricewar");
  await settleRun(page);
  await page.getByRole("button", { name: "对比", exact: true }).click();

  await expect(page.getByText("同种子运行对比")).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "种子" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Mock 调用" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Fallback 回合" })).toBeVisible();
  await expect(page.getByText(/U6 未合入/)).toBeVisible();
  await expect(page.locator("table tbody tr").first()).toBeVisible();
  await page.screenshot({ path: path.join(ARTIFACTS, "u7-review-compare.png") });
});
