import { expect, test } from "@playwright/test";

test.describe("诚实仿真标注与证据贯通", () => {
  test("首屏标明仿真推演，跑完完整示例后可以拍板", async ({ page }) => {
    await page.goto("/");
    const disclaimer = page.getByTestId("simulation-disclaimer");
    await expect(disclaimer).toBeVisible();
    await expect(disclaimer).toContainText("仿真推演");
    await expect(disclaimer).toContainText("200");
    await expect(disclaimer).toContainText("不是确定能赚到的钱");
    await expect(disclaimer).toContainText("不是真实商户材料");
    await expect(page.getByText("未填经营数据将使用报告内列明的演示假设")).toHaveCount(0);

    await page.getByTestId("scenario-1").click();
    await page.getByTestId("run-button").click();
    await expect(page.getByTestId("status")).toHaveAttribute("data-status", "awaiting-approval", {
      timeout: 30_000,
    });
    const board = page.getByTestId("deliberation-board");
    if (await board.isVisible()) {
      await expect(board).toContainText("专业提案");
    }
    await expect(page.getByTestId("approve")).toBeVisible();
    await expect(page.getByTestId("approve")).toContainText("拍板通过");
  });

  test("320 宽下仿真标注可见且不横向溢出", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto("/");
    await expect.poll(async () => page.evaluate(() => window.innerWidth)).toBe(320);
    await expect(page.getByTestId("simulation-disclaimer")).toBeVisible();
    await expect
      .poll(async () =>
        page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
      )
      .toBe(0);
  });
});
