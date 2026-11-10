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
    await expect(page.getByTestId("scenario-3")).toContainText("细节待确认");
    await expect(page.getByTestId("scenario-3")).not.toContainText("改 1 轮就过关");
    await expect(page.getByTestId("three-strategies")).toBeVisible();
    await expect(page.getByTestId("task-box")).toBeVisible();
    await expect(page.getByTestId("run-button")).toBeVisible();
    await expect(page.getByRole("button", { name: "开始核算" })).toHaveCount(0);
    await expect(page.getByText("折叠水壶 · 淘宝")).toHaveCount(0);
    await expect(page.getByText("跳过动画")).toHaveCount(0);
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

    // 评审过程标题对商家可读，展开详情可查事件类型、工具标识与哈希链
    await expect(page.getByTestId("event-stream-panel")).toContainText("调用工具：拆解评审步骤与验收标准");
    const firstEvent = page.getByTestId("event-item-1");
    await firstEvent.locator("summary").click();
    await expect(firstEvent).toContainText("run.started");
    await expect(firstEvent).toContainText("00000000… →");

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

  test("场景 2：定向修正后可选策略拍板通过，并回放已封存事件", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("scenario-2").click();
    await page.getByTestId("run-button").click();
    await expect(page.getByTestId("status")).toHaveAttribute("data-status", "awaiting-approval", {
      timeout: 30_000,
    });
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
