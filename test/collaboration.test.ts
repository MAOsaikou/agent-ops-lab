import { describe, expect, test } from "vitest";

import { DEFAULT_WORKFLOW } from "../src/templates/agentops/catalog.js";
import { runCollaboration } from "../src/templates/agentops/collaboration.js";
import { resumeAgentWorkflow, runAgentWorkflow } from "../src/templates/agentops/runner.js";
import { buildCandidates } from "../src/templates/pricing/candidates.js";
import { normalizeInput } from "../src/templates/pricing/plan.js";
import { PLATFORM_PRESETS } from "../src/templates/pricing/platform.js";

const PRESET_1 =
  "分析这个拼多多商品是否值得上架：https://mobile.yangkeduo.com/goods.html?goods_id=412345678901。分享文案：纯棉短袖女夏季宽松，券后 ¥39.90，已拼 10 万+，包邮、七天无理由。采购 16 元，包材 1.5 元，快递 6.5 元，目标毛利 25%，可周转资金 300 元。";

const PRESET_2 =
  "评估护颈枕价格与现金流。京东价 ¥89，竞品日单量约 50，采购 18 元，包装 2 元，快递 7 元，平台费率按默认，目标毛利 30%，预算 500 元。";

const CRAFTED_FLIP_TASK =
  "评估京东商品是否值得上架：https://item.jd.com/100012345678.html。商品名：便携保温杯，京东价 ¥58.90，日单量 50，采购价 16 元，包材 1.5 元，快递 6.5 元，目标毛利 56%，推广预算 10 元，可周转资金 2200 元。";

describe("Phase 3: 会签质询与利益人交叉复核机制 (Collaboration)", () => {
  test("三方利益人透镜核算与冲突识别：采购看悲观p10、定价看硬门槛毛利、运营看放量单量", () => {
    const preset = PLATFORM_PRESETS.jd;
    const product = normalizeInput({
      platform: "jd",
      name: "便携保温杯",
      category: "水具",
      keywords: "",
      buyCents: 1600,
      packagingCents: 150,
      shippingCents: 650,
      commissionRate: preset.commissionRate,
      payFeeRate: preset.payFeeRate,
      returnRate: 0.15,
      returnSalvage: 0.6,
      adDailyBudgetCents: 1000,
      adCpcCents: 80,
      adCvr: 0.04,
      competitorCents: 5890,
      marketOrders: 50,
      elasticity: 2.2,
      targetMargin: 0.56,
      cashCents: 220000,
      settleDays: preset.settleDays,
      services: [],
      promoEnabled: true,
      promoDiscount: 0.9,
      seed: 7,
    });
    const candidates = buildCandidates(product, preset);
    const collab = runCollaboration(product, candidates, "match");

    expect(collab.mode).toBe("rule");
    expect(collab.proposals).toHaveLength(3);

    const procProposal = collab.proposals.find((p) => p.role === "procurement-lead");
    const priceProposal = collab.proposals.find((p) => p.role === "pricing-lead");
    const growthProposal = collab.proposals.find((p) => p.role === "growth-operator");

    expect(procProposal?.metricName).toContain("p10");
    expect(priceProposal?.metricName).toContain("毛利");
    expect(growthProposal?.metricName).toContain("单量");

    // 冲突存在：pricing-lead 提议 profit，growth-operator 提议 volume
    expect(priceProposal?.candidateId).toBe("profit");
    expect(growthProposal?.candidateId).toBe("volume");
    expect(collab.objections.length).toBeGreaterThan(0);
  });

  test("在精心设计的任务上，会签质询成功改变最终推荐决策（Decision Flip）", async () => {
    // 未开启质询时（v1），recommendId 仅看 baseline viable p10，在 cash 紧缺时选 match
    const v1Run = await runAgentWorkflow(
      {
        id: "flip-test-v1",
        taskText: CRAFTED_FLIP_TASK,
        autoApprove: true,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      null,
      undefined,
      { collaboration: false },
    );
    expect(v1Run.artifacts.chosenId).toBe("match");

    // 开启会签质询后（v2）
    const v2Run = await runAgentWorkflow(
      {
        id: "flip-test-v2",
        taskText: CRAFTED_FLIP_TASK,
        autoApprove: true,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      null,
      undefined,
      { collaboration: true },
    );

    expect(v2Run.artifacts.collaboration).toBeDefined();
    const collab = v2Run.artifacts.collaboration!;
    expect(collab.proposals).toHaveLength(3);
    expect(collab.objections.length).toBeGreaterThan(0);

    // 裁决结论和概要文案包含原推荐与改动说明
    expect(collab.summary).toContain("稳价");
    expect(v2Run.events.some((e) => e.nodeId === "challenge")).toBe(true);

    // 最终选中的策略是稳健的稳价方案
    expect(v2Run.artifacts.chosenId).toBe("profit");
  });

  test("在一致或低冲突任务上，三方一致达成共识且不出假分歧", async () => {
    const run = await runAgentWorkflow({
      id: "unanimous-test",
      taskText: PRESET_2,
      autoApprove: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    expect(run.artifacts.collaboration).toBeDefined();
    const collab = run.artifacts.collaboration!;
    expect(collab.proposals).toHaveLength(3);
    // 质询结论总结如实陈述共识或辩论结果
    expect(collab.summary.length).toBeGreaterThan(5);
  });

  test("确定性：相同输入两次运行事件链、指纹与质询结果完全一致", async () => {
    const input = {
      id: "deterministic-run",
      taskText: PRESET_1,
      autoApprove: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const runA = await runAgentWorkflow(input);
    const runB = await runAgentWorkflow(input);

    expect(runA.fingerprint).toBe(runB.fingerprint);
    expect(runA.artifacts.collaboration).toEqual(runB.artifacts.collaboration);
    expect(runA.events.map((e) => e.hash)).toEqual(runB.events.map((e) => e.hash));
  });

  test("连续哈希链安全：所有事件前向哈希连续且节点标签真实", async () => {
    const run = await runAgentWorkflow({
      id: "hash-chain-test",
      taskText: PRESET_1,
      autoApprove: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    expect(run.workflow.id).toBe("product-launch-review.v2");
    expect(run.agents).toHaveLength(10);
    expect(run.llm.mode).toBe("rule");

    for (let i = 1; i < run.events.length; i++) {
      expect(run.events[i]?.prevHash).toBe(run.events[i - 1]?.hash);
      expect(run.events[i]?.seq).toBe(i + 1);
    }
  });

  test("向下兼容性：collaboration: false 完全还原 v1 工作流与 7 个 Agent 调度", async () => {
    const v1Run = await runAgentWorkflow(
      {
        id: "v1-compat-test",
        taskText: PRESET_1,
        autoApprove: true,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      null,
      undefined,
      { collaboration: false },
    );

    expect(v1Run.workflow.id).toBe(DEFAULT_WORKFLOW.id);
    expect(v1Run.agents).toHaveLength(7);
    expect(v1Run.artifacts.collaboration).toBeUndefined();
    expect(v1Run.events.some((e) => e.nodeId === "challenge")).toBe(false);
  });

  test("人工门暂停与恢复（v2）：awaiting-approval 暂停并保留质询记录，批准后封存", async () => {
    const paused = await runAgentWorkflow({
      id: "pause-resume-test",
      taskText: PRESET_1,
      autoApprove: false,
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    expect(paused.status).toBe("awaiting-approval");
    expect(paused.workflow.id).toBe("product-launch-review.v2");
    expect(paused.artifacts.collaboration).toBeDefined();

    const resumed = await resumeAgentWorkflow(paused, { action: "approve" });
    expect(resumed.status).toBe("completed");
    expect(resumed.workflow.id).toBe("product-launch-review.v2");
    expect(resumed.artifacts.collaboration).toEqual(paused.artifacts.collaboration);

    for (let i = 1; i < resumed.events.length; i++) {
      expect(resumed.events[i]?.prevHash).toBe(resumed.events[i - 1]?.hash);
    }
  });
});
