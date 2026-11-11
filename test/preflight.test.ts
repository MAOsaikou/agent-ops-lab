import { describe, expect, test } from "vitest";

import { createPricingApp } from "../src/server/pricing-app.js";
import { openLlmSettingsStore } from "../src/server/llm-settings.js";
import { appendClause, clauseForAnswer, composeTaskText } from "../src/templates/agentops/compose.js";
import type { LiveLlm } from "../src/templates/agentops/llm.js";
import { inspectTask, prepareIntake } from "../src/templates/agentops/preflight.js";
import { parseTaskFacts } from "../src/templates/agentops/task-facts.js";

function mockLive(text: string): LiveLlm {
  return { model: "mock-intake", baseUrl: "http://mock.invalid", client: { complete: async () => ({ text, usage: { promptTokens: 1, completionTokens: 1 } }) } };
}

describe("评审前资料问询", () => {
  test("无链接说明只追问缺项，补齐前不产生价格和决策", () => {
    let task = "商品名：纯棉短袖，竞品价 39.9 元。";
    const first = inspectTask(task);
    expect(first.ready).toBe(false);
    expect(first.questions.map((q) => q.id)).toEqual(["buy", "shipping"]);
    const buy = clauseForAnswer("buy", "16");
    const shipping = clauseForAnswer("shipping", "0");
    if (!buy.ok || !shipping.ok) throw new Error("valid answers rejected");
    task = appendClause(appendClause(task, buy.clause), shipping.clause);
    const ready = inspectTask(task);
    expect(ready.ready).toBe(true);
    expect(ready.questions).toEqual([]);
    expect(ready.known).toContainEqual({ label: "快递费", value: "0.00 元" });
    expect(ready.assumptions.some((item) => item.includes("周转资金") && item.includes("300.00"))).toBe(true);
    expect(ready.assumptions.some((item) => item.includes("日推广预算") && item.includes("30.00"))).toBe(true);
  });

  test("零运费、包材和推广预算从表单贯穿解析，不会变成默认支出", () => {
    const composed = composeTaskText({ name: "纯棉短袖", competitorYuan: "39.9", buyYuan: "16", shippingYuan: "0", packagingYuan: "0", adBudgetYuan: "0" });
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    expect(parseTaskFacts(composed.text)).toMatchObject({ shippingCents: 0, packagingCents: 0, adDailyBudgetCents: 0 });
    expect(inspectTask(composed.text).assumptions.some((item) => item.includes("日推广预算"))).toBe(false);
    expect(clauseForAnswer("shipping", "-1").ok).toBe(false);
    expect(clauseForAnswer("competitor", "0.01").ok).toBe(false);
  });

  test("模型只改写已知缺项的问题，不能决定ready或提供经营值", async () => {
    const task = "商品名：纯棉短袖，竞品价 39.9 元，快递 0 元。";
    const prepared = await prepareIntake(task, mockLive(JSON.stringify({ questions: [{ id: "buy", ask: "这件商品每件拿货需要多少钱？" }] })));
    expect(prepared.mode).toBe("live");
    expect(prepared.ready).toBe(false);
    expect(prepared.questions[0]?.ask).toContain("拿货");
    expect(prepared.known).toEqual(inspectTask(task).known);
  });

  test.each([
    { questions: [] },
    { questions: [{ id: "buy", ask: "采购按16元可以吗？" }] },
    { questions: [{ id: "buy", ask: "每件进货多少元？" }], ready: true },
    { questions: [{ id: "name", ask: "这是什么商品？" }] },
    { questions: [{ id: "buy", ask: "每件进货多少元？" }, { id: "buy", ask: "拿货要多少元？" }] },
  ])("模型输出越权或不完整时诚实回退：%j", async (output) => {
    const task = "商品名：纯棉短袖，竞品价 39.9 元，快递 0 元。";
    const prepared = await prepareIntake(task, mockLive(JSON.stringify(output)));
    expect(prepared.mode).toBe("fallback");
    expect(prepared.questions).toEqual(inspectTask(task).questions);
    expect(prepared.ready).toBe(false);
  });

  test("接口不存档运行，拒绝空数据，未配置模型时只执行本地规则", async () => {
    const app = createPricingApp({ store: { load: () => undefined, list: () => [], save: () => { throw new Error("intake must not persist pricing plan"); } }, llmSettings: openLlmSettingsStore(null, {}) });
    const missing = await app.request("/api/agentops/intake", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ task: "商品名：纯棉短袖" }) });
    expect(missing.status).toBe(200);
    expect(await missing.json()).toMatchObject({ mode: "rule", ready: false });
    const runs = await app.request("/api/agentops/runs");
    expect(await runs.json()).toEqual({ runs: [] });
    const invalid = await app.request("/api/agentops/intake", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ task: "" }) });
    expect(invalid.status).toBe(400);
  });
});


describe("录入零值和金额上界", () => {
  test("零单量与零周转资金在表单、追问和预检中保留", () => {
    const result = composeTaskText({ name: "纯棉短袖", competitorYuan: "39.9", buyYuan: "16", shippingYuan: "0", dailyOrders: "0", cashYuan: "0", adBudgetYuan: "0" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("zero facts rejected");
    expect(parseTaskFacts(result.text)).toMatchObject({ marketOrders: 0, cashCents: 0, adDailyBudgetCents: 0 });
    const intake = inspectTask(result.text);
    expect(intake.known).toContainEqual({ label: "同类日单量", value: "0 单/天" });
    expect(intake.known).toContainEqual({ label: "周转资金", value: "0.00 元" });
    expect(intake.assumptions.some((item) => item.includes("周转资金未提供"))).toBe(false);
    expect(clauseForAnswer("orders", "0")).toEqual({ ok: true, clause: "日单量 0" });
    expect(clauseForAnswer("orders", "-1").ok).toBe(false);
    expect(clauseForAnswer("orders", "1.5").ok).toBe(false);
  });

  test("录入上界与解析一致，超出范围给出字段错误", () => {
    const form = { name: "测试商品", competitorYuan: "100000", buyYuan: "100000", shippingYuan: "10000", packagingYuan: "10000", dailyOrders: "1000000", cashYuan: "10000000", adBudgetYuan: "1000000" };
    const result = composeTaskText(form);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("upper bounds rejected");
    expect(parseTaskFacts(result.text)).toMatchObject({ competitorCents: 10_000_000, buyCents: 10_000_000, shippingCents: 1_000_000, packagingCents: 1_000_000, marketOrders: 1_000_000, cashCents: 1_000_000_000, adDailyBudgetCents: 100_000_000 });
    const invalid = composeTaskText({ ...form, dailyOrders: "1000001", cashYuan: "10000001", shippingYuan: "10001" });
    expect(invalid.ok).toBe(false);
    if (invalid.ok) throw new Error("out of range accepted");
    expect(invalid.errors).toHaveProperty("dailyOrders");
    expect(invalid.errors).toHaveProperty("cashYuan");
    expect(invalid.errors).toHaveProperty("shippingYuan");
  });
});
