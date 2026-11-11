import { expect, test } from "@playwright/test";

test.describe("Phase 2: 无链接填单与诚实追问", () => {
  test("按项填写表单可以生成任务文本，运行后字段齐备且无缺失追问", async ({ page }) => {
    await page.goto("/");
    // 打开无链接按项填写折叠面板
    await page.getByText("没有链接？按项填写").click();
    await page.getByTestId("compose-name").fill("纯棉短袖 夏季宽松");
    await page.getByTestId("compose-competitor").fill("39.9");
    await page.getByTestId("compose-buy").fill("16");
    await page.getByTestId("compose-shipping").fill("6.5");
    await page.getByTestId("compose-orders").fill("50");
    await page.getByTestId("compose-submit").click();

    // 确认文本已填入输入区
    const taskBox = page.getByTestId("task-box");
    await expect(taskBox).toHaveValue(/纯棉短袖 夏季宽松/);
    await expect(taskBox).toHaveValue(/采购价 16 元/);
    await expect(taskBox).toHaveValue(/快递 6.5 元/);

    // 运行评审
    await page.getByTestId("run-button").click();
    await expect(page.getByTestId("status")).toHaveAttribute("data-status", "awaiting-approval");

    // 确认没有生成 ask-buy 或 ask-shipping 追问
    await expect(page.getByTestId("answer-input-ask-buy")).toHaveCount(0);
    await expect(page.getByTestId("answer-input-ask-shipping")).toHaveCount(0);
  });

  test("缺失采购价时生成诚实追问与演示值标注，在线补充后重新评审不再追问", async ({ page }) => {
    await page.goto("/");
    // 填入缺失采购价的描述
    await page
      .getByTestId("task-box")
      .fill("评估护颈枕价格与现金流。京东价 ¥89，快递 7 元，日单量 50，目标毛利 30%。");
    await page.getByTestId("run-button").click();
    await expect(page.getByTestId("status")).toHaveAttribute("data-status", "awaiting-approval");

    // Section 二标出采购价为「未提供，演示值」
    await expect(page.getByText("未提供，演示值")).toBeVisible();

    // Section 一显示 ask-buy 追问输入框
    const buyInput = page.getByTestId("answer-input-ask-buy");
    await expect(buyInput).toBeVisible();

    // 填入采购价并点击「补充并重评」
    await buyInput.fill("18.5");
    await page.getByTestId("answer-submit-ask-buy").click();

    // 应该发起新的评审并到达待拍板
    await expect(page.getByTestId("status")).toHaveAttribute("data-status", "awaiting-approval");

    // 追问已解决，不再显示 ask-buy
    await expect(page.getByTestId("answer-input-ask-buy")).toHaveCount(0);
    // 任务框里已追加采购价
    await expect(page.getByTestId("task-box")).toHaveValue(/采购价 18.5 元/);
  });
});
