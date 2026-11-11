import { expect, test } from "@playwright/test";

const CRAFTED_FLIP_TASK =
  "评估京东商品是否值得上架。商品名：便携保温杯，京东价 ¥58.9，日单量 50，采购价 16 元，包材 1.5 元，快递 6.5 元，目标毛利 56%，推广预算 10 元，可周转资金 2200 元。";

const UNANIMOUS_TASK =
  "评估护颈枕价格与现金流。京东价 ¥89，竞品日单量约 50，采购 18 元，包装 2 元，快递 7 元，平台费率按默认，目标毛利 30%，预算 500 元。";

test.describe("Phase 3 & 4: 会签质询与封存态布局", () => {
  test("Phase 3: 精心设计任务发生决策裁决改动（Decision Flip），会签质询默认展开并追加风控待确认项", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByTestId("task-box").fill(CRAFTED_FLIP_TASK);
    await page.getByTestId("run-button").click();
    await expect(page.getByTestId("status")).toHaveAttribute("data-status", "awaiting-approval", {
      timeout: 30_000,
    });

    // 确认最终选中的方案被裁决改为稳价（profit）
    await expect(page.getByTestId("strategy-profit")).toContainText("推荐");

    // 会签质询折叠面板默认展开（因发生了裁决改动）
    const collabSection = page.getByTestId("collaboration-section");
    await expect(collabSection).toBeVisible();
    await expect(collabSection).toHaveAttribute("open", "");
    await expect(collabSection).toContainText("方案已裁决改动");
    await expect(collabSection).toContainText("原推荐");
    await expect(collabSection).toContainText("利益人提议方案与初衷");
    await expect(collabSection).toContainText("采购负责人");
    await expect(collabSection).toContainText("定价参谋");
    await expect(collabSection).toContainText("推广运营");
    await expect(collabSection).toContainText("交叉质询与压力测试记录");

    await expect(page.getByTestId("collaboration-comparison")).toContainText("采购压力 p10");
    await expect(page.getByTestId("collaboration-analyses")).toContainText("采购成本 +10%");
    await expect(page.getByTestId("collaboration-responses")).toContainText("市场分析师回应");
    for (const role of ["procurement-lead", "pricing-lead", "growth-operator"]) {
      await expect(page.getByTestId(`collab-calls-${role}`)).toContainText("本次已执行");
    }
    await page.getByTestId("collaboration-section").screenshot({ path: "artifacts/collaboration-review.png" });

    // 质询未消解的风险保留在门禁风控区
    const gateRisks = page.getByTestId("gate-unresolved-risks");
    await expect(gateRisks).toContainText("会签质询");
  });

  test("Phase 3: 存在分歧时如实展示，不将裁决维持伪装成一致", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("task-box").fill(UNANIMOUS_TASK);
    await page.getByTestId("run-button").click();
    await expect(page.getByTestId("status")).toHaveAttribute("data-status", "awaiting-approval", {
      timeout: 30_000,
    });

    const collabSection = page.getByTestId("collaboration-section");
    await expect(collabSection).toBeVisible();
    // 分歧和残余风险始终可见，不用推荐维持代替共识
    await expect(collabSection).toHaveAttribute("open", "");
    await expect(collabSection).toContainText("存在分歧，裁决维持");
  });

  test("Phase 4: 拍板批准后门禁标题变为「已拍板」，仅保留选中卡片，另外两套收拢在折叠项中", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByTestId("task-box").fill(UNANIMOUS_TASK);
    await page.getByTestId("run-button").click();
    await expect(page.getByTestId("status")).toHaveAttribute("data-status", "awaiting-approval", {
      timeout: 30_000,
    });

    // 待拍板状态下，门禁标题是「请你拍板」，面板标题是「三套策略」
    await expect(page.locator("span", { hasText: "请你拍板" }).first()).toBeVisible();
    await expect(page.getByTestId("three-strategies")).toContainText("三套策略");

    // 批准方案
    await page.getByTestId("approve").click();
    await expect(page.getByTestId("status")).toHaveAttribute("data-status", "completed");

    // 封存态：门禁标题变为「已拍板」，面板标题变为「已按「…」拍板」
    await expect(page.locator("span", { hasText: "已拍板" }).first()).toBeVisible();
    await expect(page.getByTestId("three-strategies")).toContainText(/已按「.*」拍板/);

    // 封存态仅直接可见选中的那张卡片，另外两套策略收拢进 <details data-testid="other-strategies">
    const otherDetails = page.getByTestId("other-strategies");
    await expect(otherDetails).toBeVisible();
    await expect(otherDetails).not.toHaveAttribute("open", "");
    await expect(otherDetails).toContainText("另外两套策略");

    // 键盘聚焦与展开
    await otherDetails.locator("summary").click();
    await expect(otherDetails).toHaveAttribute("open", "");
  });

  test("Phase 4: 驳回方案后门禁标题变为「已驳回」，面板标题变为「已驳回」", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByTestId("task-box").fill(UNANIMOUS_TASK);
    await page.getByTestId("run-button").click();
    await expect(page.getByTestId("status")).toHaveAttribute("data-status", "awaiting-approval", {
      timeout: 30_000,
    });

    // 驳回方案
    await page.getByTestId("reject").click();
    await expect(page.getByTestId("status")).toHaveAttribute("data-status", "rejected");

    // 驳回态：门禁标题变为「已驳回」，面板标题变为「已驳回」
    await expect(page.locator("span", { hasText: "已驳回" }).first()).toBeVisible();
    await expect(page.getByTestId("three-strategies")).toContainText("已驳回");
  });

  test("Phase 4: 390px 与 320px 窄屏全流程横向 0 溢出", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    // 空闲状态 390px
    const idleOverflow390 = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(idleOverflow390).toBe(0);

    // 空闲状态 320px
    await page.setViewportSize({ width: 320, height: 568 });
    await expect
      .poll(async () =>
        page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      )
      .toBe(0);

    // 运行至待拍板态
    await page.getByTestId("task-box").fill(UNANIMOUS_TASK);
    await page.getByTestId("run-button").click();
    await expect(page.getByTestId("status")).toHaveAttribute("data-status", "awaiting-approval", {
      timeout: 30_000,
    });

    // 待拍板 320px
    await expect
      .poll(async () =>
        page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      )
      .toBe(0);

    // 拍板封存 320px
    await page.getByTestId("approve").click();
    await expect(page.getByTestId("status")).toHaveAttribute("data-status", "completed");
    await expect
      .poll(async () =>
        page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      )
      .toBe(0);
  });
});
