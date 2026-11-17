import { expect, test } from "@playwright/test";

test.describe("SimShop 8回合博弈沙盘与多Agent评测竞技场", () => {
  test("单品会签台向8回合沙盘桥接、断供三轮议价、热升级、回合步进与409不可逆账本边界", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/");
    await expect(page.getByTestId("nav-tab-review")).toHaveAttribute("aria-pressed", "true");

    // 1. 在单品会签台跑通场景 1 并通过结论区快捷按钮带入 SimShop 沙盘
    await page.getByTestId("scenario-1").click();
    await page.getByTestId("run-button").click();
    await expect(page.getByTestId("status")).toHaveAttribute("data-status", "awaiting-approval", {
      timeout: 30_000,
    });

    await page.getByTestId("bridge-to-simshop").click();
    await expect(page.getByTestId("simshop-arena")).toBeVisible();
    await expect(page.getByTestId("nav-tab-simshop")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("simshop-source-context")).toContainText("纯棉短袖");
    await expect(page.getByTestId("simshop-source-context")).toContainText("¥16.00");
    await expect(page.getByTestId("simshop-source-context")).toContainText("¥39.90");

    // 2. 启动 supplycut + steady + seed=7 8回合动态博弈
    await page.getByTestId("simshop-scenario-supplycut").click();
    await page.getByTestId("simshop-profile-steady").click();
    await page.getByTestId("simshop-seed-input").fill("7");
    await page.getByTestId("simshop-start-button").click();

    await expect(page.getByTestId("simshop-total-profit")).toContainText("+¥641.40", {
      timeout: 30_000,
    });
    await expect(page.getByTestId("simshop-arena")).toContainText("已从单品多维会签台带入上下文");

    // 3. 验证 Agent 动态版本热升级轨 (pricer@1.0.0 -> pricer@1.0.1)
    const upgrades = page.getByTestId("simshop-version-upgrades");
    await expect(upgrades).toContainText("pricer@1.0.0");
    await expect(upgrades).toContainText("pricer@1.0.1");
    await expect(upgrades).toContainText("toPromptHash:");

    // 4. 验证断供三轮议价走势表（含 accept / counter / walk 与底价脱敏话术）
    const negotiation = page.getByTestId("simshop-negotiation-panel");
    await expect(negotiation).toContainText("成交 (accept)");
    await expect(negotiation).toContainText("还价 (counter)");
    await expect(negotiation).toContainText("退出 (walk)");
    await expect(negotiation).toContainText("合规话术（未泄露底价）");

    // 5. 验证回合步进播放器（单步精查与全部展开）
    await page.getByTestId("simshop-round-tab-1").click();
    await expect(page.getByTestId("simshop-round-card-1")).toBeVisible();
    await expect(page.getByTestId("simshop-round-card-0")).toHaveCount(0);
    await page.getByTestId("simshop-round-next").click();
    await expect(page.getByTestId("simshop-round-card-2")).toBeVisible();
    await page.getByTestId("simshop-round-all").click();
    await expect(page.getByTestId("simshop-round-card-0")).toBeVisible();
    await expect(page.getByTestId("simshop-round-card-7")).toBeVisible();

    // 6. 验证 8 回合不可逆 SHA-256 账本：尝试篡改第 1 回合触发真实 HTTP 409 round-locked
    await page.getByTestId("simshop-tamper-round-0").click();
    const proof = page.getByTestId("simshop-tamper-proof");
    await expect(proof).toBeVisible();
    await expect(proof).toContainText("HTTP 409 (round-locked)");
    await expect(proof).toContainText("第 1 回合已结算并锁定");
    await expect(proof).toContainText("storedDecisionHash:");
    await expect(proof).toContainText("lockedRoundHash:");

    // 7. 320px 超窄屏在 SimShop 沙盘下保持横向 0 溢出
    await page.setViewportSize({ width: 320, height: 568 });
    await expect
      .poll(async () =>
        page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
      )
      .toBe(0);
    await page.setViewportSize({ width: 1440, height: 900 });

    // 8. 切换到 pricewar 剧本验证负边际 0 元分配仲裁
    await page.getByTestId("simshop-scenario-pricewar").click();
    await page.getByTestId("simshop-start-button").click();
    await expect(page.getByTestId("simshop-total-profit")).toContainText("+¥581.60", {
      timeout: 30_000,
    });
    const priceWarPanel = page.getByTestId("simshop-pricewar-panel");
    await expect(priceWarPanel).toContainText("负边际归零拦截（0 元分配）");
    await expect(priceWarPanel).toContainText("实配 ¥0.00");

    // 9. 切换到 stressed 画像验证 Critic 修正循环与兜底回退
    await page.getByTestId("simshop-scenario-supplycut").click();
    await page.getByTestId("simshop-profile-stressed").click();
    await page.getByTestId("simshop-start-button").click();
    await expect(page.getByTestId("simshop-orchestration-panel")).toContainText("Critic 修正循环", {
      timeout: 30_000,
    });
    await expect(page.getByTestId("simshop-orchestration-panel")).toContainText(
      "达到最大修正轮次上限",
    );

    expect(pageErrors).toEqual([]);
  });

  test("多Agent vs 单Agent 评测竞技场：12案4拓扑PK与8回合博弈Recharts趋势图及320px零溢出", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/");
    await page.getByTestId("nav-tab-arena").click();
    await expect(page.getByTestId("topology-benchmark-view")).toBeVisible();

    await page.getByTestId("arena-run-eval-button").click();
    await expect(page.getByTestId("arena-part-a")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId("arena-part-b")).toBeVisible({ timeout: 45_000 });

    // Part A：12 案 4 拓扑梯度通过率校验
    await expect(page.getByTestId("arena-part-a-card-rule")).toContainText("7/12 (58.3%)");
    await expect(page.getByTestId("arena-part-a-card-single-agent")).toContainText("7/12 (58.3%)");
    await expect(page.getByTestId("arena-part-a-card-collab-no-review")).toContainText(
      "10/12 (83.3%)",
    );
    await expect(page.getByTestId("arena-part-a-card-collab-with-review")).toContainText(
      "12/12 (100.0%)",
    );
    await expect(page.getByTestId("arena-case-table")).toContainText("cash-tight-volume-stockout");
    await expect(page.getByTestId("arena-case-table")).toContainText("Self-Loop");

    // Part B：8 回合动态博弈 4 拓扑汇总与 Recharts 图表渲染
    const summary = page.getByTestId("arena-campaign-summary");
    await expect(summary).toContainText("-¥889.10");
    await expect(summary).toContainText("+¥1354.20");
    await expect(summary).toContainText("+¥1614.60");
    await expect(summary).toContainText("+¥1793.00");
    await expect(summary).toContainText("4 / 16");
    await expect(summary).toContainText("100.0% 通过");

    const charts = page.getByTestId("arena-campaign-charts");
    await expect(charts.locator("svg.recharts-surface").first()).toBeVisible();

    // 切换单场景 pricewar 刷新 Part B
    await page.getByTestId("arena-scenario-scope-pricewar").click();
    await page.getByTestId("arena-compare-button").click();
    await expect(page.getByTestId("arena-part-b-row-collab-with-review")).toContainText(
      "+¥581.60",
      { timeout: 30_000 },
    );

    // 320px 超窄屏在竞技场视图保持横向 0 溢出
    await page.setViewportSize({ width: 320, height: 568 });
    await expect
      .poll(async () =>
        page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
      )
      .toBe(0);

    expect(pageErrors).toEqual([]);
  });

  test("评委演播推演模式：三大视图均展示多Agent实时编排追踪与一键跳过直达终局", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/");
    const toggle = page.getByTestId("pacing-toggle");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(toggle).toContainText("演播推演");

    // 1. 单品会签台演播推演与跳过
    await page.getByTestId("scenario-1").click();
    await page.getByTestId("run-button").click();
    await expect(page.getByTestId("live-orchestration-tracker")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("skip-pacing-button").click();
    await expect(page.getByTestId("status")).toHaveAttribute("data-status", "awaiting-approval", {
      timeout: 15_000,
    });

    // 2. 8 回合博弈沙盘演播推演与跳过
    await page.getByTestId("nav-tab-simshop").click();
    await page.getByTestId("simshop-scenario-supplycut").click();
    await page.getByTestId("simshop-start-button").click();
    await expect(page.getByTestId("simshop-live-pacing")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("simshop-skip-pacing").click();
    await expect(page.getByTestId("simshop-total-profit")).toContainText("+¥641.40");

    // 3. 多拓扑竞技场演播推演与跳过
    await page.getByTestId("nav-tab-arena").click();
    await page.getByTestId("arena-run-eval-button").click();
    await expect(page.getByTestId("arena-live-pacing")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("arena-skip-pacing").click();
    await expect(page.getByTestId("arena-part-a-card-collab-with-review")).toContainText(
      "12/12 (100.0%)",
    );

    expect(pageErrors).toEqual([]);
  });
});
