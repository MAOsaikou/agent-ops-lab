import { expect, test } from "@playwright/test";

const API = "http://127.0.0.1:47321";

const PLAN_INPUT = {
  platform: "pdd",
  name: "纯棉短袖 T 恤",
  category: "女装上衣",
  keywords: "纯棉,短袖,显瘦",
  buyCents: 1850,
  packagingCents: 50,
  shippingCents: 240,
  commissionRate: 0.006,
  payFeeRate: 0.006,
  returnRate: 0.22,
  returnSalvage: 0.5,
  adDailyBudgetCents: 5000,
  adCpcCents: 35,
  adCvr: 0.05,
  competitorCents: 3990,
  marketOrders: 120,
  elasticity: 2.6,
  targetMargin: 0.2,
  cashCents: 1500000,
  settleDays: 3,
  services: ["包邮", "七天无理由"],
  promoEnabled: true,
  promoDiscount: 0.9,
  seed: 11,
};

function parseSseDone(body: string): { id: string; status: string; loops: unknown[] } {
  const blocks = body.split("\n\n");
  for (const block of blocks) {
    const lines = block.split("\n");
    let eventName = "message";
    const data: string[] = [];
    for (const line of lines) {
      if (line.startsWith("event:")) eventName = line.slice("event:".length).trim();
      else if (line.startsWith("data:")) data.push(line.slice("data:".length).trim());
    }
    if (eventName === "done" && data.length > 0) {
      return JSON.parse(data.join("\n")) as { id: string; status: string; loops: unknown[] };
    }
  }
  throw new Error("SSE 流未包含 done 事件");
}

test.describe("上架评审会签台", () => {
  test("默认停在需我拍板，且不再展示旧掌柜向导", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "商品上架评审会签台" })).toBeVisible();
    await expect(page.getByTestId("status")).toHaveAttribute("data-status", "idle");
    const gate = page.getByTestId("gate-toggle");
    await expect(gate).toHaveAttribute("aria-pressed", "true");
    await expect(gate).toHaveAttribute("data-auto-approve", "false");
    await expect(gate).toContainText("需我拍板");
    await expect(page.getByTestId("live-ledger")).toBeVisible();
    await expect(page.getByTestId("loop-comparison")).toBeVisible();
    await expect(page.getByTestId("loop-comparison")).toContainText("待核算");
    await expect(page.getByTestId("loop-comparison")).not.toContainText("还不用改");
    await expect(page.getByTestId("scenario-1")).toContainText("缺货与证据待拍板");
    await expect(page.getByTestId("scenario-1")).not.toContainText("不用改，等你拍板");
    await expect(page.getByTestId("scenario-2")).toContainText("改 2 轮预算，备货待拍板");
    await expect(page.getByTestId("scenario-3")).toContainText("细节待确认");
    await expect(page.getByTestId("scenario-3")).not.toContainText("改 1 轮就过关");
    await expect(page.getByTestId("scenario-4")).toContainText("提折扣保本，细节待确认");
    await expect(page.getByTestId("three-strategies")).toBeVisible();
    await expect(page.getByTestId("task-box")).toBeVisible();
    await expect(page.getByTestId("run-button")).toBeVisible();
    await expect(page.getByRole("button", { name: "开始核算" })).toHaveCount(0);
    await expect(page.getByText("折叠水壶 · 淘宝")).toHaveCount(0);
    await expect(page.getByText("跳过动画")).toHaveCount(0);

    // 窄屏（手机宽度）下预设徽章不撑破横向视口
    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test("场景 1：零轮经济修正后可驳回并如实封存", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("scenario-1").click();
    await page.getByTestId("run-button").click();
    // 后台评审本身只有几十毫秒，不必断言中间的 running，以免漏帧。
    await expect(page.getByTestId("status")).toHaveAttribute("data-status", "awaiting-approval", {
      timeout: 30_000,
    });
    await expect(page.getByTestId("live-ledger")).toContainText("商品证据与待确认项");
    await expect(page.getByTestId("break-even-price")).toBeVisible();
    await expect(page.getByTestId("loop-comparison")).toContainText("不用改价或预算，但仍有风险需你拍板");
    await expect(page.getByTestId("loop-comparison")).toContainText("30 天不缺货");
    await expect(page.getByTestId("loop-comparison")).toContainText("证据边界清晰");
    await expect(page.getByTestId("strategy-profit")).toBeVisible();
    await expect(page.getByTestId("strategy-match")).toBeVisible();
    await expect(page.getByTestId("strategy-volume")).toBeVisible();
    await expect(page.locator("svg.recharts-surface").first()).toBeVisible();
    await expect(page.getByTestId("llm-mode-badge")).toContainText(/规则 Harness|模型已启用|模型回退/);

    // 协作角色职责与工具按需展开可达
    const roleCard = page.getByTestId("role-card-cost-accountant");
    await roleCard.locator("summary").click();
    await expect(roleCard).toContainText("核算单件总成本");
    await expect(roleCard).toContainText("pricing.unit-cost");

    // 评审过程标题对商家可读，展开详情可查事件类型、工具标识与完整 64 位哈希链
    await expect(page.getByTestId("event-stream-panel")).toContainText("调用工具：拆解评审步骤与验收标准");
    const firstEvent = page.getByTestId("event-item-1");
    await firstEvent.locator("summary").click();
    await expect(firstEvent).toContainText("run.started");
    await expect(firstEvent).toContainText("00000000… →");
    const fullEventHashText = await page.getByTestId("event-hash-full-1").textContent();
    expect(fullEventHashText).toContain("prev: " + "0".repeat(64));
    expect(fullEventHashText).toMatch(/hash:\s*[0-9a-f]{64}/);

    // 页脚可展开查看完整 64 位运行指纹
    const runProof = page.getByTestId("run-proof");
    await runProof.locator("summary").click();
    const fullHash = await page.getByTestId("run-fingerprint-full").textContent();
    expect(fullHash?.trim()).toMatch(/^[0-9a-f]{64}$/);

    await page.getByTestId("reject").click();
    await expect(page.getByTestId("status")).toHaveAttribute("data-status", "rejected", {
      timeout: 15_000,
    });
    await expect(page.getByText("掌柜已驳回").first()).toBeVisible();
  });

  test("场景 2：无链接证据诚实提取、390px 首屏可读可拍板、定向修正后通过并回放已封存事件", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.getByTestId("scenario-2").click();
    await page.getByTestId("run-button").click();
    await expect(page.getByTestId("status")).toHaveAttribute("data-status", "awaiting-approval", {
      timeout: 30_000,
    });

    // Part A：无链接场景 2 证据诚实性（无子 agent 术语、商品名识别为护颈枕、无包装费伪价差）
    await expect(page.getByTestId("live-ledger")).toContainText("未附商品链接，已从粘贴文字提取商品资料");
    await expect(page.getByTestId("live-ledger")).toContainText("护颈枕");
    await expect(page.getByTestId("live-ledger")).toContainText("按默认费率");
    await expect(page.getByTestId("live-ledger")).toContainText("约 50 单/天（价格带日单量）");
    await expect(page.getByTestId("live-ledger")).not.toContainText("先把商品资料交给链接识别子 agent");
    await expect(page.getByTestId("live-ledger")).not.toContainText("这件商品叫什么");
    await expect(page.getByTestId("live-ledger")).not.toContainText("¥2.00 和 ¥89.00");

    // Part B：390×844 awaiting-approval 首屏可读性（核心结论、未消解风险、拍板动作与策略选择均在 y <= 844 内，且横向 0 溢出）
    await expect(page.getByText("七、等你拍板")).toHaveCount(0);
    await expect(page.getByTestId("gate-unresolved-risks")).toContainText("30 天不缺货");
    await expect(page.getByTestId("gate-unresolved-risks")).toContainText("推广占比");
    const mobileMeasures = await page.evaluate(() => {
      const rect = (sel: string) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
      };
      return {
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        threeStrategies: rect('[data-testid="three-strategies"]'),
        risks: rect('[data-testid="gate-unresolved-risks"]'),
        approve: rect('[data-testid="approve"]'),
        reject: rect('[data-testid="reject"]'),
        strategyMatch: rect('[data-testid="strategy-match"]'),
      };
    });
    expect(mobileMeasures.overflowX).toBe(0);
    expect(mobileMeasures.threeStrategies?.top).toBeLessThan(844);
    expect(mobileMeasures.risks?.bottom).toBeLessThanOrEqual(844);
    expect(mobileMeasures.approve?.bottom).toBeLessThanOrEqual(844);
    expect(mobileMeasures.reject?.bottom).toBeLessThanOrEqual(844);
    expect(mobileMeasures.strategyMatch?.bottom).toBeLessThanOrEqual(844);

    // 页脚默认表面不再暴露 autoApprove 开发者兼容说明，展开凭证后可见
    await expect(page.locator("footer > div").first()).not.toContainText("autoApprove");

    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.getByTestId("loop-comparison")).toContainText("已改 2 / 2 轮");
    await expect(page.getByTestId("loop-round-1")).toBeVisible();
    await expect(page.getByTestId("loop-round-2")).toBeVisible();
    await expect(page.getByTestId("loop-comparison")).toContainText("日推广预算");
    await page.getByTestId("strategy-profit").click();
    await expect(page.getByTestId("three-strategies")).toContainText("单件成本与净利拆解");
    await page.getByTestId("approve").click();
    await expect(page.getByTestId("status")).toHaveAttribute("data-status", "completed", {
      timeout: 15_000,
    });
    await expect(page.getByText("已拍板封存").first()).toBeVisible();

    await page.getByTestId("replay-sealed-button").click();
    await expect(page.getByTestId("sealed-replay-status")).toContainText("已封存回放（非实时工作）");
  });

  test("受控慢速 Mock 路径：文案等待期间提前展示证据、保本价、三套策略、风控与修正对比，且拍板按钮禁用直至 awaiting-approval", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByTestId("scenario-3").click();

    // 注入测试专用受控流拆分钩子（Mock）：真实请求后端 /api/agentops/runs/stream，
    // 先刷出 pre-copy 事件与 event: snapshot，模拟文案调用等待，待测试断言后再放行后续帧。
    await page.evaluate(() => {
      const win = window as unknown as {
        __releaseMockSlowStream?: () => void;
      };
      const origFetch = window.fetch.bind(window);
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (!url.endsWith("/api/agentops/runs/stream")) {
          return origFetch(input, init);
        }
        window.fetch = origFetch;
        const realRes = await origFetch(input, init);
        const fullText = await realRes.text();
        const snapIdx = fullText.indexOf("event: snapshot");
        const snapEnd = fullText.indexOf("\n\n", snapIdx);
        const firstHalf = fullText.slice(0, snapEnd + 2);
        const secondHalf = fullText.slice(snapEnd + 2);
        const encoder = new TextEncoder();

        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(firstHalf));
            win.__releaseMockSlowStream = () => {
              controller.enqueue(encoder.encode(secondHalf));
              controller.close();
            };
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      };
    });

    await page.getByTestId("run-button").click();

    // 处于 running（等待文案完成）阶段时，前五步实质产物已经可见
    await expect(page.getByTestId("status")).toHaveAttribute("data-status", "running");
    await expect(page.getByTestId("live-ledger")).toContainText("实时会签中 · 尚未封存");
    await expect(page.getByTestId("live-ledger")).toContainText("纯棉短袖");
    await expect(page.getByTestId("break-even-price")).toBeVisible();
    await expect(page.getByTestId("strategy-profit")).toBeVisible();
    await expect(page.getByTestId("strategy-match")).toBeVisible();
    await expect(page.getByTestId("strategy-volume")).toBeVisible();
    await expect(page.getByTestId("loop-comparison")).toContainText("已改 1 / 2 轮");
    await expect(page.getByTestId("loop-round-1")).toBeVisible();

    // 拍板门在 running 阶段必须禁用，文案标明规则初稿，按钮标明暂不可拍板，且不出现封存回放或已拍板封存标识
    await expect(page.getByTestId("approve")).toBeDisabled();
    await expect(page.getByTestId("approve")).toContainText("暂不可拍板（待文案完成）");
    await expect(page.getByTestId("reject")).toBeDisabled();
    await expect(page.getByTestId("live-ledger")).toContainText("规则初稿（文案节点完成后定稿）：");
    await expect(page.getByTestId("replay-sealed-button")).toHaveCount(0);
    await expect(page.getByTestId("live-ledger")).not.toContainText("已拍板封存");
    await expect(page.getByTestId("three-strategies")).not.toContainText("已拍板封存");
    await expect(page.getByTestId("three-strategies")).toContainText("会签进行中 · 暂不可拍板");

    // 放行受控 Mock 的后续帧，进入 awaiting-approval 后拍板按钮才可点击
    await page.evaluate(() => {
      const win = window as unknown as { __releaseMockSlowStream?: () => void };
      win.__releaseMockSlowStream?.();
    });

    await expect(page.getByTestId("status")).toHaveAttribute("data-status", "awaiting-approval");
    await expect(page.getByTestId("approve")).toBeEnabled();
    await expect(page.getByTestId("approve")).toContainText("拍板通过");
    await expect(page.getByTestId("live-ledger")).toContainText("主标题初稿：");
    await expect(page.getByTestId("reject")).toBeEnabled();
  });

  test("流式中途网络中断或报错时：不伪造完成态或封存报告，且掌柜可重新发起评审恢复", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("scenario-1").click();

    await page.evaluate(() => {
      const win = window as unknown as {
        __failMockSlowStream?: () => void;
      };
      const origFetch = window.fetch.bind(window);
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (!url.endsWith("/api/agentops/runs/stream")) {
          return origFetch(input, init);
        }
        window.fetch = origFetch;
        const realRes = await origFetch(input, init);
        const fullText = await realRes.text();
        const snapIdx = fullText.indexOf("event: snapshot");
        const snapEnd = fullText.indexOf("\n\n", snapIdx);
        const firstHalf = fullText.slice(0, snapEnd + 2);
        const encoder = new TextEncoder();

        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(firstHalf));
            win.__failMockSlowStream = () => {
              controller.enqueue(
                encoder.encode(
                  `event: error\ndata: ${JSON.stringify({ code: "run-failed", detail: "模拟文案阶段网络中断" })}\n\n`,
                ),
              );
              controller.close();
            };
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      };
    });

    await page.getByTestId("run-button").click();
    await expect(page.getByTestId("status")).toHaveAttribute("data-status", "running");
    await expect(page.getByTestId("break-even-price")).toBeVisible();
    await page.getByTestId("event-item-10").locator("summary").click();
    const abortedHashText = (await page.getByTestId("event-hash-full-10").textContent()) ?? "";
    const abortedHashMatch = /hash:\s*([0-9a-f]{64})/.exec(abortedHashText);
    expect(abortedHashMatch?.[1]).toBeDefined();

    // 触发中途失败
    await page.evaluate(() => {
      const win = window as unknown as { __failMockSlowStream?: () => void };
      win.__failMockSlowStream?.();
    });

    await expect(page.getByRole("alert")).toContainText("模拟文案阶段网络中断");
    await expect(page.getByTestId("status")).toHaveAttribute("data-status", "idle");
    await expect(page.getByTestId("approve")).toBeDisabled();
    await expect(page.getByTestId("approve")).toContainText("暂不可拍板（未开始）");
    await expect(page.getByTestId("reject")).toBeDisabled();
    await expect(page.getByTestId("live-ledger")).not.toContainText("已拍板封存");
    await expect(page.getByTestId("three-strategies")).not.toContainText("已拍板封存");
    await expect(page.getByTestId("run-button")).toBeEnabled();

    // 中断后卷宗、过程侧栏、凭证、候选策略选择、回放与底栏指纹必须全部清空归零
    await expect(page.getByTestId("event-stream-panel")).toContainText("开始后会按完成顺序出现在这里");
    await expect(page.getByTestId("event-stream-panel")).toContainText("还没有过程记录");
    await expect(page.locator('[data-testid^="event-item-"]')).toHaveCount(0);
    await expect(page.getByTestId("live-ledger").getByText("查看凭证")).toHaveCount(0);
    await expect(page.getByTestId("three-strategies")).not.toContainText("当前检视：");
    await expect(page.locator('[data-testid^="strategy-"]')).toHaveCount(0);
    await expect(page.getByTestId("replay-sealed-button")).toHaveCount(0);
    await expect(page.getByTestId("run-proof")).toHaveCount(0);

    // 掌柜切换到不同官方预设（场景 2：京东护颈枕）重跑，断言事件、哈希、产物、凭证、选择与状态均只属于新评审
    await page.getByTestId("scenario-2").click();
    await page.getByTestId("run-button").click();
    await expect(page.getByTestId("status")).toHaveAttribute("data-status", "awaiting-approval", {
      timeout: 30_000,
    });
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByTestId("live-ledger")).toContainText("护颈,枕");
    await expect(page.getByTestId("live-ledger")).toContainText("¥89.00");
    await expect(page.getByTestId("live-ledger")).not.toContainText("纯棉,短袖,宽松");
    await expect(page.getByTestId("loop-comparison")).toContainText("已改 2 / 2 轮");
    await expect(page.getByTestId("three-strategies")).toContainText("当前检视：跟价 · 对齐竞品（¥89.90）");
    await expect(page.getByTestId("approve")).toBeEnabled();
    await expect(page.getByTestId("approve")).toContainText("拍板通过（跟价 · 对齐竞品）");
    const retryEvent1 = page.getByTestId("event-item-1");
    await retryEvent1.locator("summary").click();
    await expect(page.getByTestId("event-hash-full-1")).toContainText("prev: " + "0".repeat(64));
    const retryEvent10 = page.getByTestId("event-item-10");
    await retryEvent10.locator("summary").click();
    await expect(page.getByTestId("event-hash-full-10")).not.toContainText(abortedHashMatch![1]!);
  });

  test("并发与交错点击防护：流式中点历史、历史连点竞态、历史读取中发起新评审、拍板中点历史、同帧双次拍板均不串台", async ({
    page,
    request,
  }) => {
    // 先通过 API 准备两条可区分的历史卷宗（场景 2 京东护颈枕 与 场景 4 加厚收纳箱）
    const seedResA = await request.post(`${API}/api/agentops/runs`, {
      data: {
        task: "评估护颈枕价格与现金流。京东价 ¥89，竞品日单量约 50，采购 18 元，包装 2 元，快递 7 元，平台费率按默认，目标毛利 30%，预算 500 元。",
        autoApprove: true,
      },
    });
    expect(seedResA.ok()).toBeTruthy();
    const runA = (await seedResA.json()) as { id: string; fingerprint: string };

    const seedResB = await request.post(`${API}/api/agentops/runs`, {
      data: {
        task: "分析拼多多商品是否值得上架：https://mobile.yangkeduo.com/goods.html?goods_id=412345678901。商品名：加厚收纳箱，售价 ¥38.90。采购价 25 元，包材 2 元，快递 6 元，竞品主流价 38.90 元，日单量 60，目标毛利 5%，推广预算 10 元，可周转资金 5000 元。",
        autoApprove: true,
      },
    });
    expect(seedResB.ok()).toBeTruthy();
    const runB = (await seedResB.json()) as { id: string; fingerprint: string };

    await page.goto("/");
    await expect(page.getByTestId(`history-run-${runA.id}`)).toBeVisible();
    await expect(page.getByTestId(`history-run-${runB.id}`)).toBeVisible();

    // 1) 流式等待期间历史按钮禁用并标明「会签进行中，完成后可查看历史」，防误触打断在途评审；完成后可正常切换历史
    await page.getByTestId("scenario-3").click();
    await page.evaluate(() => {
      const win = window as unknown as { __releaseSlowForHistory?: () => void };
      const origFetch = window.fetch.bind(window);
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (!url.endsWith("/api/agentops/runs/stream")) {
          return origFetch(input, init);
        }
        window.fetch = origFetch;
        const realRes = await origFetch(input, init);
        const fullText = await realRes.text();
        const snapIdx = fullText.indexOf("event: snapshot");
        const snapEnd = fullText.indexOf("\n\n", snapIdx);
        const firstHalf = fullText.slice(0, snapEnd + 2);
        const secondHalf = fullText.slice(snapEnd + 2);
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(firstHalf));
            win.__releaseSlowForHistory = () => {
              try {
                controller.enqueue(encoder.encode(secondHalf));
                controller.close();
              } catch {
                // 已被流取消则忽略
              }
            };
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      };
    });

    await page.getByTestId("run-button").click();
    await expect(page.getByTestId("status")).toHaveAttribute("data-status", "running");
    await expect(page.getByTestId("live-ledger")).toContainText("纯棉短袖");
    await expect(page.getByText("会签进行中，完成后可查看历史")).toBeVisible();
    await expect(page.getByTestId(`history-run-${runA.id}`)).toBeDisabled();

    // 即使通过脚本强行触发点击，openRunFromHistory 守卫也不中断在途流
    await page.evaluate((id: string) => {
      const btn = document.querySelector(`[data-testid="history-run-${id}"]`) as HTMLButtonElement | null;
      btn?.click();
    }, runA.id);
    await expect(page.getByTestId("status")).toHaveAttribute("data-status", "running");

    await page.evaluate(() => {
      const win = window as unknown as { __releaseSlowForHistory?: () => void };
      win.__releaseSlowForHistory?.();
    });
    await expect(page.getByTestId("status")).toHaveAttribute("data-status", "awaiting-approval");
    await expect(page.getByTestId(`history-run-${runA.id}`)).toBeEnabled();

    await page.getByTestId(`history-run-${runA.id}`).click();
    await expect(page.getByTestId("status")).toHaveAttribute("data-status", "completed");
    await expect(page.getByTestId("live-ledger")).toContainText("已封存历史卷宗");
    await expect(page.getByTestId("live-ledger")).toContainText("护颈,枕");
    await expect(page.getByTestId("live-ledger")).not.toContainText("纯棉短袖");
    await expect(page.getByTestId("run-proof")).toContainText(`卷宗 ${runA.id}`);
    await expect(page.getByRole("alert")).toHaveCount(0);

    // 2) 快速连点两条历史记录（runB 慢返回、runA 快返回）：先点 runB 再点 runA，晚到的 runB 响应不得覆盖 runA
    await page.evaluate((slowRunId: string) => {
      const win = window as unknown as { __releaseSlowHistoryFetch?: () => void };
      const origFetch = window.fetch.bind(window);
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (!url.endsWith(`/api/agentops/runs/${slowRunId}`)) {
          return origFetch(input, init);
        }
        window.fetch = origFetch;
        const realRes = await origFetch(input, init);
        await new Promise<void>((resolve) => {
          win.__releaseSlowHistoryFetch = resolve;
        });
        return realRes;
      };
    }, runB.id);

    await page.getByTestId(`history-run-${runB.id}`).click();
    await page.getByTestId(`history-run-${runA.id}`).click();
    await expect(page.getByTestId("run-proof")).toContainText(`卷宗 ${runA.id}`);

    await page.evaluate(() => {
      const win = window as unknown as { __releaseSlowHistoryFetch?: () => void };
      win.__releaseSlowHistoryFetch?.();
    });
    await expect(page.getByTestId("run-proof")).toContainText(`卷宗 ${runA.id}`);
    await expect(page.getByTestId("live-ledger")).toContainText("护颈,枕");
    await expect(page.getByTestId("live-ledger")).not.toContainText("加厚收纳箱");

    // 3) 历史卷宗处于封存回放或历史读取仍在途时直接点击「开始上架评审」：必须清空回放与历史标记，晚到的历史响应也不得覆盖新评审
    await page.getByTestId("replay-sealed-button").click();
    await expect(page.getByTestId("sealed-replay-status")).toBeVisible();

    await page.evaluate((slowRunId: string) => {
      const win = window as unknown as { __releaseHistoryBeforeNewRun?: () => void };
      const origFetch = window.fetch.bind(window);
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (!url.endsWith(`/api/agentops/runs/${slowRunId}`)) {
          return origFetch(input, init);
        }
        window.fetch = origFetch;
        const realRes = await origFetch(input, init);
        await new Promise<void>((resolve) => {
          win.__releaseHistoryBeforeNewRun = resolve;
        });
        return realRes;
      };
    }, runB.id);

    await page.getByTestId(`history-run-${runB.id}`).click();
    await page.getByTestId("scenario-1").click();
    await page.getByTestId("run-button").click();
    await page.evaluate(() => {
      const win = window as unknown as { __releaseHistoryBeforeNewRun?: () => void };
      win.__releaseHistoryBeforeNewRun?.();
    });

    await expect(page.getByTestId("status")).toHaveAttribute("data-status", "awaiting-approval", {
      timeout: 30_000,
    });
    await expect(page.getByTestId("sealed-replay-status")).toHaveCount(0);
    await expect(page.getByTestId("live-ledger")).toContainText("纯棉,短袖,宽松");
    await expect(page.getByTestId("live-ledger")).not.toContainText("加厚收纳箱");
    await expect(page.getByTestId("live-ledger")).not.toContainText("已封存历史卷宗");

    // 4) 同帧连续触发两次拍板点击（模拟极速双击）：只发一次决策请求，不因并发 409 弹出错误警告
    let decisionCalls = 0;
    await page.evaluate(() => {
      const win = window as unknown as {
        __decisionCount?: number;
        __releasePendingDecision?: () => void;
      };
      win.__decisionCount = 0;
      const origFetch = window.fetch.bind(window);
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (!url.includes("/api/agentops/runs/") || !url.endsWith("/decision")) {
          return origFetch(input, init);
        }
        win.__decisionCount = (win.__decisionCount ?? 0) + 1;
        const realRes = await origFetch(input, init);
        if (win.__decisionCount === 1) {
          await new Promise<void>((resolve) => {
            win.__releasePendingDecision = resolve;
          });
          window.fetch = origFetch;
        }
        return realRes;
      };
    });

    await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="approve"]') as HTMLButtonElement | null;
      btn?.click();
      btn?.click();
    });

    decisionCalls = await page.evaluate(
      () => (window as unknown as { __decisionCount?: number }).__decisionCount ?? 0,
    );
    expect(decisionCalls).toBe(1);

    // 5) 拍板请求仍在途时：历史按钮禁用并标明「拍板已送出，请稍候完成后再看历史记录」，避免后台已落库而界面误以为未提交
    await expect(page.getByText("拍板已送出，请稍候完成后再看历史记录")).toBeVisible();
    await expect(page.getByTestId(`history-run-${runB.id}`)).toBeDisabled();
    await page.evaluate((id: string) => {
      const btn = document.querySelector(`[data-testid="history-run-${id}"]`) as HTMLButtonElement | null;
      btn?.click();
    }, runB.id);

    await page.evaluate(() => {
      const win = window as unknown as { __releasePendingDecision?: () => void };
      win.__releasePendingDecision?.();
    });

    await expect(page.getByTestId("status")).toHaveAttribute("data-status", "completed");
    await expect(page.getByTestId(`history-run-${runB.id}`)).toBeEnabled();
    await page.getByTestId(`history-run-${runB.id}`).click();
    await expect(page.getByTestId("run-proof")).toContainText(`卷宗 ${runB.id}`);
    await expect(page.getByTestId("live-ledger")).toContainText("加厚收纳箱");
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
});

test("流式评审接口在人工门暂停，批准后状态为已完成", async ({ request }) => {
  const stream = await request.post(`${API}/api/agentops/runs/stream`, {
    data: {
      task: "评估护颈枕价格与现金流。京东价 ¥89，竞品日单量约 50，采购 18 元，包装 2 元，快递 7 元，平台费率按默认，目标毛利 30%，预算 500 元。",
      autoApprove: false,
    },
    headers: { accept: "text/event-stream", "content-type": "application/json" },
  });
  expect(stream.ok()).toBeTruthy();
  expect(stream.headers()["content-type"] ?? "").toContain("text/event-stream");
  const body = await stream.text();
  expect(body).toContain("event: event");
  expect(body).toContain("event: done");
  const done = parseSseDone(body);
  expect(done.status).toBe("awaiting-approval");
  expect(done.loops.length).toBeGreaterThan(0);

  const decided = await request.post(`${API}/api/agentops/runs/${done.id}/decision`, {
    data: { action: "approve", candidateId: "profit" },
  });
  expect(decided.ok()).toBeTruthy();
  const run = (await decided.json()) as { status: string; decidedCandidateId?: string };
  expect(run.status).toBe("completed");
  expect(run.decidedCandidateId).toBe("profit");
});

test("原定价接口仍能算出三套方案并导出 CSV", async ({ request }) => {
  const created = await request.post(`${API}/api/plans`, { data: PLAN_INPUT });
  expect(created.status()).toBe(201);
  const plan = (await created.json()) as {
    id: string;
    candidates: readonly { id: string; priceCents: number }[];
    recommendedId: string;
    trace: readonly unknown[];
  };
  expect(plan.candidates).toHaveLength(3);
  expect(plan.trace.length).toBeGreaterThan(6);

  const locked = await request.post(`${API}/api/plans/${plan.id}/lock`, {
    data: { candidateId: plan.recommendedId },
  });
  expect(locked.status()).toBe(200);

  const csv = await request.get(`${API}/api/plans/${plan.id}/export.csv`);
  expect(csv.status()).toBe(200);
  expect(await csv.text()).toContain("方案,售价(元)");
});
