import { expect, test } from "@playwright/test";

test.describe("Phase 2: 无链接填单与诚实追问", () => {
  test("先补齐资料和确认假设，再只启动一次评审", async ({ page }) => {
    let runRequests = 0;
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().endsWith("/api/agentops/runs/stream")) runRequests += 1;
    });
    await page.goto("/");
    await page.getByTestId("task-box").fill("商品名：纯棉短袖，竞品价 39.9 元。");
    await page.getByTestId("prepare-intake").click();
    await expect(page.getByTestId("preflight-answer-buy")).toBeVisible();
    await expect(page.getByTestId("preflight-answer-shipping")).toBeVisible();
    expect(runRequests).toBe(0);
    await page.getByTestId("preflight-answer-buy").fill("16");
    await page.getByTestId("preflight-answer-shipping").fill("0");
    await page.getByTestId("intake-supplement").click();
    await expect(page.getByTestId("intake-ready")).toBeVisible();
    await expect(page.getByTestId("intake-start")).toBeDisabled();
    await page.screenshot({ path: "artifacts/intake-ready.png", fullPage: true });
    expect(runRequests).toBe(0);
    await page.getByTestId("intake-confirm").check();
    await page.getByTestId("intake-start").click();
    await expect(page.getByTestId("status")).toHaveAttribute("data-status", "awaiting-approval");
    expect(runRequests).toBe(1);
    await expect(page.getByTestId("task-box")).toHaveValue(/快递 0 元/);
  });

  test("窄屏无链接录入可访问且不横向溢出", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.getByLabel("商品名", { exact: false }).first()).toBeVisible();
    await page.getByTestId("task-box").fill("商品名：纯棉短袖，竞品价 39.9 元。");
    await page.getByTestId("prepare-intake").click();
    await expect(page.getByTestId("preflight-answer-buy")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: "artifacts/intake-mobile.png", fullPage: true });
  });

  test("修改任务后清除旧问题，旧回答不能写入新商品", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("task-box").fill("商品名：纯棉短袖，竞品价 39.9 元。");
    await page.getByTestId("prepare-intake").click();
    await expect(page.getByTestId("preflight-answer-buy")).toBeVisible();
    await page.getByTestId("preflight-answer-buy").fill("16");
    await page.getByTestId("task-box").fill("商品名：护颈枕，竞品价 89 元，采购价 18 元，快递 7 元。");
    await expect(page.getByTestId("intake-preflight")).toHaveCount(0);
    await page.getByTestId("prepare-intake").click();
    await expect(page.getByTestId("intake-ready")).toBeVisible();
    await expect(page.getByTestId("intake-preflight")).toContainText("护颈枕");
    await expect(page.getByTestId("task-box")).not.toHaveValue(/采购价 16 元/);
  });

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

  test("缺失采购价时先追问、不用演示值核算，在线补充后重新评审不再追问", async ({ page }) => {
    await page.goto("/");
    // 填入缺失采购价的描述
    await page
      .getByTestId("task-box")
      .fill("评估护颈枕价格与现金流。京东价 ¥89，快递 7 元，日单量 50，目标毛利 30%。");
    await page.getByTestId("run-button").click();
    await expect(page.getByTestId("status")).toHaveAttribute("data-status", "needs-info");

    // 缺采购价时先追问，不拿演示值算出一套可拍板方案；补充框在首屏，无需展开审计折叠项
    await expect(page.getByTestId("review-audit")).not.toHaveAttribute("open", "");
    await expect(page.getByText("未提供，演示值")).toHaveCount(0);
    await expect(page.getByTestId("followup-questions")).toBeVisible();
    await expect(page.getByTestId("followup-questions")).toContainText("先补齐再核算");

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


test("助手补答可以纠正原描述中无效的参考售价", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("task-box").fill("商品名：纯棉短袖，采购价 16 元，快递 0 元，竞品价 0.01 元。");
  await page.getByTestId("prepare-intake").click();
  await expect(page.getByTestId("preflight-answer-competitor")).toBeVisible();
  await page.getByTestId("preflight-answer-competitor").fill("39.9");
  await page.getByTestId("intake-supplement").click();
  await expect(page.getByTestId("intake-ready")).toBeVisible();
  await expect(page.getByTestId("intake-preflight")).toContainText("39.90 元");
});

test("手机上直接试算缺采购价：补充框首屏可见、能直接填写重评，不必展开审计折叠项", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page
    .getByTestId("task-box")
    .fill("评估护颈枕价格与现金流。京东价 ¥89，快递 7 元，日单量 50，目标毛利 30%。");
  await page.getByTestId("run-button").click();
  await expect(page.getByTestId("status")).toHaveAttribute("data-status", "needs-info");
  const input = page.getByTestId("answer-input-ask-buy");
  await expect(input).toBeInViewport();
  await expect(page.getByTestId("review-audit")).not.toHaveAttribute("open", "");
  await input.fill("18.5");
  await page.getByTestId("answer-submit-ask-buy").click();
  await expect(page.getByTestId("status")).toHaveAttribute("data-status", "awaiting-approval");
  await expect(page.getByTestId("answer-input-ask-buy")).toHaveCount(0);
  await expect(page.getByTestId("task-box")).toHaveValue(/采购价 18.5 元/);
});
