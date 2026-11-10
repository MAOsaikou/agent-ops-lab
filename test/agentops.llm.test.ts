import { describe, expect, test } from "vitest";

import type { LlmClient } from "../src/engine/llm/client.js";
import { copyPrompt, validateCopy } from "../src/templates/agentops/llm.js";
import { runAgentWorkflow } from "../src/templates/agentops/runner.js";

const task = "分析拼多多商品是否值得上架。采购价 16 元，快递 6.5 元，竞品主流价 39.90 元，日单量 50，目标毛利 30%。";

function fakeLlm(reply: () => Promise<string>): LlmClient {
  return {
    complete: () => reply().then((text) => ({ text, usage: { promptTokens: 1, completionTokens: 1 } })),
  };
}

describe("模型节点与验证回退", () => {
  test("模型输出通过校验后被采用，且 llm.completed 时序在 gate/report/final-check/run.completed 之前", async () => {
    const llm = fakeLlm(() => Promise.resolve(JSON.stringify({ titles: ["纯棉短袖 夏季宽松", "冰丝短袖 通勤上衣"], bullets: ["纯棉亲肤", "夏季不闷汗"] })));
    const run = await runAgentWorkflow({ id: "llm-ok", taskText: task, autoApprove: true, createdAt: "2026-01-01T00:00:00.000Z" }, { client: llm, model: "qwen-test", baseUrl: "http://localhost" });
    expect(run.llm.mode).toBe("live");
    expect(run.llm.model).toBe("qwen-test");
    const llmEvent = run.events.find((event) => event.type === "llm.completed");
    const gateEvent = run.events.find((event) => event.type === "gate.awaiting");
    const reportEvent = run.events.find((event) => event.nodeId === "report" && event.type === "node.output");
    const finalEvent = run.events.find((event) => event.nodeId === "final-check" && event.type === "verify.checked");
    const completedEvent = run.events.find((event) => event.type === "run.completed");
    expect(llmEvent).toBeDefined();
    expect(llmEvent?.nodeId).toBe("copy");
    expect(llmEvent!.seq).toBeLessThan(gateEvent!.seq);
    expect(llmEvent!.seq).toBeLessThan(reportEvent!.seq);
    expect(llmEvent!.seq).toBeLessThan(finalEvent!.seq);
    expect(llmEvent!.seq).toBeLessThan(completedEvent!.seq);
    expect(run.events.at(-1)?.type).toBe("run.completed");
    expect(run.artifacts.bullets).toEqual(["纯棉亲肤", "夏季不闷汗"]);
    expect(run.artifacts.copy?.titles[0]?.text).toBe("纯棉短袖 夏季宽松");
    expect(run.fingerprint).toHaveLength(64);
    for (let index = 1; index < run.events.length; index += 1) {
      expect(run.events[index]?.prevHash).toBe(run.events[index - 1]?.hash);
    }
  });

  test("模型输出含极限词时被验证器拒绝并回退规则文案，且 llm.fallback 时序在 run.completed 之前", async () => {
    const llm = fakeLlm(() => Promise.resolve(JSON.stringify({ titles: ["全网最低价短袖"], bullets: ["销量第一"] })));
    const run = await runAgentWorkflow({ id: "llm-bad", taskText: task, autoApprove: true, createdAt: "2026-01-01T00:00:00.000Z" }, { client: llm, model: "qwen-test", baseUrl: "http://localhost" });
    expect(run.llm.mode).toBe("fallback");
    const fallbackEvent = run.events.find((event) => event.type === "llm.fallback");
    const completedEvent = run.events.find((event) => event.type === "run.completed");
    expect(fallbackEvent).toBeDefined();
    expect(fallbackEvent?.nodeId).toBe("copy");
    expect(fallbackEvent!.seq).toBeLessThan(completedEvent!.seq);
    expect(run.events.at(-1)?.type).toBe("run.completed");
    expect(run.artifacts.bullets).not.toContain("销量第一");
    expect(run.artifacts.copy?.titles.some((title) => title.text.includes("全网最低"))).toBe(false);
  });

  test("模型调用异常时整条运行仍然完成，且 llm.fallback 在 run.completed 之前", async () => {
    const llm = fakeLlm(() => Promise.reject(new Error("gateway timeout")));
    const run = await runAgentWorkflow({ id: "llm-down", taskText: task, autoApprove: true, createdAt: "2026-01-01T00:00:00.000Z" }, { client: llm, model: "qwen-test", baseUrl: "http://localhost" });
    expect(run.status).toBe("completed");
    expect(run.llm.mode).toBe("fallback");
    const fallbackEvent = run.events.find((event) => event.type === "llm.fallback");
    const completedEvent = run.events.find((event) => event.type === "run.completed");
    expect(fallbackEvent).toBeDefined();
    expect(fallbackEvent!.seq).toBeLessThan(completedEvent!.seq);
    expect(run.events.at(-1)?.type).toBe("run.completed");
  });

  test("提示词只带事实并明确字数与风险词约束", () => {
    const prompt = copyPrompt({ name: "纯棉短袖", platform: "拼多多", maxTitle: 30, keywords: "纯棉,短袖", price: 4390 });
    expect(prompt).toContain("30");
    expect(prompt).toContain("纯棉短袖");
    expect(prompt).toContain("JSON");
  });

  test("校验器拒绝超长标题和非 JSON 输出", () => {
    expect(validateCopy("不是 json", 30).ok).toBe(false);
    expect(validateCopy(JSON.stringify({ titles: ["字".repeat(40)], bullets: ["卖点"] }), 30).ok).toBe(false);
    expect(validateCopy(JSON.stringify({ titles: ["正常标题"], bullets: ["卖点"] }), 30).ok).toBe(true);
  });
});
