import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { AGENTS, DEFAULT_WORKFLOW, resolveAgent } from "../src/templates/agentops/catalog.js";
import { runAgentWorkflow } from "../src/templates/agentops/runner.js";
import type { AgentRun, RunEvent } from "../src/templates/agentops/types.js";

const task = `分析拼多多商品是否值得上架：https://mobile.yangkeduo.com/goods.html?goods_id=412345678901。纯棉短袖，券后价 ¥39.90，已拼 10 万+ 件。采购价 16 元，包材 1.5 元，快递 6.5 元，竞品主流价 39.90 元，日单量 50，目标毛利 25%，推广预算 30 元，可周转资金 300 元。`;

const consoleExample1 =
  "分析这个拼多多商品是否值得上架：https://mobile.yangkeduo.com/goods.html?goods_id=412345678901。分享文案：纯棉短袖女夏季宽松，券后 ¥39.90，已拼 10 万+，包邮、七天无理由。采购 16 元，包材 1.5 元，快递 6.5 元，目标毛利 25%，可周转资金 300 元。";

describe("AgentOps 商品评审工作流", () => {
  test("执行多 Agent、并行分析、人工门、交叉验证和封存", async () => {
    const run = await runAgentWorkflow({ id: "test-run", taskText: task, autoApprove: true, createdAt: "2026-01-01T00:00:00.000Z" });
    expect(run.status).toBe("completed");
    expect(run.agents).toHaveLength(7);
    expect(new Set(run.dispatches.map((dispatch) => dispatch.chosen)).size).toBeGreaterThanOrEqual(5);
    expect(run.events.some((event) => event.type === "tool.called")).toBe(true);
    expect(run.events.some((event) => event.type === "verify.checked")).toBe(true);
    expect(run.events.some((event) => event.type === "gate.autoApproved")).toBe(true);
    expect(run.events.at(-1)?.type).toBe("run.completed");
    expect(run.artifacts.prices).toHaveLength(3);
    expect(run.llm.mode).toBe("rule");
    expect(run.llm.note).toContain("规则 Harness");
    expect(run.fingerprint).toHaveLength(64);
    for (let index = 1; index < run.events.length; index += 1) {
      expect(run.events[index]?.prevHash).toBe(run.events[index - 1]?.hash);
    }
  });

  test("演示模式下同一输入可复现", async () => {
    const input = { id: "same", taskText: task, autoApprove: true, createdAt: "2026-01-01T00:00:00.000Z" };
    expect(await runAgentWorkflow(input)).toEqual(await runAgentWorkflow(input));
  });

  test("account / market / copy 各自使用职责函数而非重复调用 buildPlan", async () => {
    const runnerSource = readFileSync(path.resolve(process.cwd(), "src/templates/agentops/runner.ts"), "utf8");
    expect(runnerSource).not.toContain("buildPlan");

    let accountSnapshot: AgentRun | null = null;
    const seenEvents: RunEvent[] = [];
    const run = await runAgentWorkflow(
      { id: "no-build-plan", taskText: task, autoApprove: false, createdAt: "2026-01-01T00:00:00.000Z" },
      null,
      (event, snapshot) => {
        seenEvents.push(event);
        if (event.nodeId === "account" && event.type === "node.output") {
          accountSnapshot = snapshot;
        }
      },
    );
    expect(accountSnapshot).not.toBeNull();
    expect(accountSnapshot!.artifacts.unit?.totalCents).toBeGreaterThan(0);
    expect(accountSnapshot!.artifacts.breakEvenCents).toBeGreaterThan(0);
    expect(accountSnapshot!.artifacts.prices).toHaveLength(0);
    expect(run.status).toBe("awaiting-approval");
    expect(run.events.at(-1)?.type).toBe("gate.awaiting");
    expect(seenEvents).toHaveLength(run.events.length);
  });

  test("控制台场景 1 遇到证据边界失败时不会空转砍推广预算", async () => {
    const run = await runAgentWorkflow({
      id: "console-ex1",
      taskText: consoleExample1,
      autoApprove: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(run.verifications.some((item) => item.title === "证据边界清晰" && item.status === "fail")).toBe(true);
    expect(run.loops).toHaveLength(0);
    expect(run.events.some((event) => event.type === "loop.adjusted")).toBe(false);
    expect(run.artifacts.product?.adDailyBudgetCents).toBe(3000);
  });

  test("真实推广占比冲突触发定向 Self-Loop、记录前后快照并拉低责任 Agent 下轮调度分", async () => {
    const adConflictTask =
      "分析拼多多商品是否值得上架：https://mobile.yangkeduo.com/goods.html?goods_id=412345678901。商品名：纯棉短袖，券后价 ¥39.90。采购价 16 元，包材 1.5 元，快递 6.5 元，竞品主流价 39.90 元，日单量 15，目标毛利 25%，推广预算 220 元，可周转资金 5000 元。";
    const run = await runAgentWorkflow({
      id: "ad-conflict",
      taskText: adConflictTask,
      autoApprove: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(run.loops.length).toBeGreaterThanOrEqual(1);
    expect(run.loops.length).toBeLessThanOrEqual(2);
    const firstLoop = run.loops[0]!;
    expect(firstLoop.action).toBe("ad-budget");
    expect(firstLoop.before.adDailyBudgetCents).toBe(22000);
    expect(firstLoop.after.adDailyBudgetCents).toBe(13200);
    expect(firstLoop.before.failTitles).toContain("推广占比");
    expect(firstLoop.after.failTitles).not.toContain("推广占比");
    expect(firstLoop.before.priceCents).toBeGreaterThan(0);
    expect(firstLoop.after.priceCents).toBeGreaterThan(0);

    const marketDispatches = run.dispatches.filter((item) => item.nodeId === "market");
    expect(marketDispatches.length).toBeGreaterThanOrEqual(2);
    const round1Score = marketDispatches[0]?.candidates.find((c) => c.agentId === "market-analyst")?.score ?? 0;
    const round2Candidate = marketDispatches[1]?.candidates.find((c) => c.agentId === "market-analyst");
    expect(round2Candidate).toBeDefined();
    expect(round2Candidate!.score).toBeLessThan(round1Score - 9);
    expect(round2Candidate!.note).toContain("失败 1");

    const actionableRows = run.artifacts.risk?.rows.filter((row) => row.id !== "evidence") ?? [];
    expect(actionableRows.length).toBeGreaterThan(0);
    expect(actionableRows.every((row) => row.status === "pass" || row.status === "warn")).toBe(true);
  });

  test("真实活动折扣破保本与冲量/跟价断货冲突分别按各自杠杆定向收敛", async () => {
    const promoConflictTask =
      "分析拼多多商品是否值得上架：https://mobile.yangkeduo.com/goods.html?goods_id=412345678901。商品名：加厚收纳箱，售价 ¥38.90。采购价 25 元，包材 2 元，快递 6 元，竞品主流价 38.90 元，日单量 60，目标毛利 5%，推广预算 10 元，可周转资金 5000 元。";
    const promoRun = await runAgentWorkflow({
      id: "promo-conflict",
      taskText: promoConflictTask,
      autoApprove: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(promoRun.loops).toHaveLength(1);
    expect(promoRun.loops[0]?.action).toBe("promo-discount");
    expect(promoRun.loops[0]?.before.failTitles).toContain("活动价不亏");
    expect(promoRun.loops[0]?.after.promoDiscount).toBeGreaterThan(promoRun.loops[0]!.before.promoDiscount);
    expect(promoRun.loops[0]?.after.promoPriceCents).toBeGreaterThanOrEqual(promoRun.artifacts.breakEvenCents);
    expect(promoRun.artifacts.risk?.rows.find((row) => row.id === "promo")?.status).toBe("pass");

    const switchCandidateTask =
      "评估京东商品是否值得上架：https://item.jd.com/100012345678.html。商品名：便携保温杯，京东价 ¥58.90，日单量 50，采购价 16 元，包材 1.5 元，快递 6.5 元，目标毛利 56%，推广预算 10 元，可周转资金 2200 元。";
    const switchRun = await runAgentWorkflow({
      id: "switch-conflict",
      taskText: switchCandidateTask,
      autoApprove: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(switchRun.loops).toHaveLength(1);
    expect(switchRun.loops[0]?.action).toBe("switch-candidate");
    expect(switchRun.loops[0]?.before.chosenId).toBe("match");
    expect(switchRun.loops[0]?.after.chosenId).toBe("profit");
    expect(switchRun.loops[0]?.after.stockoutDays).toBeLessThan(switchRun.loops[0]!.before.stockoutDays);
    const switchActionable = switchRun.artifacts.risk?.rows.filter((row) => row.id !== "evidence") ?? [];
    expect(switchActionable.every((row) => row.status === "pass" || row.status === "warn")).toBe(true);
  });

  test("风控失败会触发真实的反馈循环并留下调整记录", async () => {
    const strict = `分析这个商品是否值得上架：https://shop.example.com/products/unknown-item。采购价 16 元，包材 1.5 元，快递 6.5 元，目标毛利 30%。`;
    const run = await runAgentWorkflow({ id: "loop-run", taskText: strict, autoApprove: true, createdAt: "2026-01-01T00:00:00.000Z" });
    expect(run.events.some((event) => event.type === "loop.adjusted")).toBe(true);
    expect(run.loops.length).toBeGreaterThanOrEqual(1);
    expect(run.loops.length).toBeLessThanOrEqual(2);
    expect(run.loops[0]?.adjustment).not.toBeNull();
    expect(run.verifications.some((item) => item.title === "证据边界清晰" && item.status === "fail")).toBe(true);
    expect(run.status).toBe("completed");
  });

  test("调度考虑能力、运行负载和失败记录", () => {
    const preferred = resolveAgent("risk", {}, {}, {});
    expect(preferred.agent.id).toBe("risk-auditor");
    const adjusted = resolveAgent("risk", { "risk-auditor": 5 }, { "risk-auditor": 2 }, {});
    expect(adjusted.agent.id).toBe("cost-accountant");
    expect(AGENTS.some((agent) => agent.id === adjusted.agent.id)).toBe(true);
  });

  test("工作流定义显式包含并行、条件、循环、人审和最终验证", () => {
    expect(DEFAULT_WORKFLOW.nodes.some((node) => node.kind === "parallel")).toBe(true);
    expect(DEFAULT_WORKFLOW.nodes.some((node) => node.kind === "condition")).toBe(true);
    expect(DEFAULT_WORKFLOW.nodes.some((node) => node.kind === "loop")).toBe(true);
    expect(DEFAULT_WORKFLOW.nodes.some((node) => node.kind === "humanGate")).toBe(true);
    expect(DEFAULT_WORKFLOW.nodes.some((node) => node.kind === "verify")).toBe(true);
  });
});
