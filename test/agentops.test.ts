import { describe, expect, test } from "vitest";

import { AGENTS, DEFAULT_WORKFLOW, resolveAgent } from "../src/templates/agentops/catalog.js";
import { runAgentWorkflow } from "../src/templates/agentops/runner.js";

const task = `分析拼多多商品是否值得上架：https://mobile.yangkeduo.com/goods.html?goods_id=412345678901。纯棉短袖，券后价 ¥39.90，已拼 10 万+ 件。采购价 16 元，包材 1.5 元，快递 6.5 元，竞品主流价 39.90 元，日单量 50，目标毛利 25%，推广预算 30 元，可周转资金 300 元。`;

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
    expect(run.fingerprint).toHaveLength(64);
    for (let index = 1; index < run.events.length; index += 1) {
      expect(run.events[index]?.prevHash).toBe(run.events[index - 1]?.hash);
    }
  });

  test("演示模式下同一输入可复现", async () => {
    const input = { id: "same", taskText: task, autoApprove: true, createdAt: "2026-01-01T00:00:00.000Z" };
    expect(await runAgentWorkflow(input)).toEqual(await runAgentWorkflow(input));
  });

  test("风控失败会触发真实的反馈循环并留下调整记录", async () => {
    const strict = `分析这个商品是否值得上架：https://shop.example.com/products/unknown-item。采购价 16 元，包材 1.5 元，快递 6.5 元，目标毛利 30%。`;
    const run = await runAgentWorkflow({ id: "loop-run", taskText: strict, autoApprove: true, createdAt: "2026-01-01T00:00:00.000Z" });
    expect(run.events.some((event) => event.type === "loop.adjusted")).toBe(true);
    expect(run.loops.length).toBeGreaterThanOrEqual(1);
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
