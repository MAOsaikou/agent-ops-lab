import { describe, expect, test } from "vitest";

import { analyzeProductInput } from "../src/templates/intake/agent.js";
import { appendClause, clauseForAnswer, cleanProductName, composeTaskText } from "../src/templates/agentops/compose.js";
import { runAgentWorkflow } from "../src/templates/agentops/runner.js";
import { parseTaskFacts } from "../src/templates/agentops/task-facts.js";

describe("Phase 2: 无链接填单与诚实追问", () => {
  test("cleanProductName 清理标点和过长文本", () => {
    expect(cleanProductName("纯棉短袖，夏季宽松！")).toBe("纯棉短袖 夏季宽松");
    expect(cleanProductName("  a  b  ")).toBe("a b");
    expect(cleanProductName("x".repeat(50))).toHaveLength(40);
  });

  test("composeTaskText 校验必填 4 项（名称、竞品价、采购价、快递）", () => {
    const emptyResult = composeTaskText({
      name: "",
      competitorYuan: "",
      buyYuan: "",
      shippingYuan: "",
    });
    expect(emptyResult.ok).toBe(false);
    if (!emptyResult.ok) {
      expect(emptyResult.errors.name).toBeDefined();
      expect(emptyResult.errors.competitorYuan).toBeDefined();
      expect(emptyResult.errors.buyYuan).toBeDefined();
      expect(emptyResult.errors.shippingYuan).toBeDefined();
    }

    const badResult = composeTaskText({
      name: "枕头",
      competitorYuan: "-5",
      buyYuan: "abc",
      shippingYuan: "0",
    });
    expect(badResult.ok).toBe(false);
    if (!badResult.ok) {
      expect(badResult.errors.competitorYuan).toBeDefined();
      expect(badResult.errors.buyYuan).toBeDefined();
      expect(badResult.errors.shippingYuan).toBeDefined();
    }
  });

  test("composeTaskText 生成可被现有解析器完整还原的语句", () => {
    const composed = composeTaskText({
      name: "记忆棉护颈枕",
      competitorYuan: "89.9",
      buyYuan: "18.5",
      shippingYuan: "7",
      packagingYuan: "2",
      targetMarginPct: "30",
      dailyOrders: "50",
      cashYuan: "5000",
      adBudgetYuan: "200",
    });
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;

    expect(composed.text).toContain("商品名：记忆棉护颈枕");
    expect(composed.text).toContain("竞品价 ¥89.9");
    expect(composed.text).toContain("采购价 18.5 元");
    expect(composed.text).toContain("快递 7 元");
    expect(composed.text).toContain("包材 2 元");
    expect(composed.text).toContain("目标毛利 30%");
    expect(composed.text).toContain("日单量 50");
    expect(composed.text).toContain("可周转资金 5000 元");
    expect(composed.text).toContain("推广预算 200 元");

    const facts = parseTaskFacts(composed.text);
    expect(facts.buyCents).toBe(1850);
    expect(facts.shippingCents).toBe(700);
    expect(facts.packagingCents).toBe(200);
    expect(facts.competitorCents).toBe(8990);
    expect(facts.targetMargin).toBe(0.3);
    expect(facts.marketOrders).toBe(50);
    expect(facts.cashCents).toBe(500000);
    expect(facts.adDailyBudgetCents).toBe(20000);

    const intake = analyzeProductInput({ text: composed.text });
    expect(intake.fields.find((f) => f.id === "name")?.display).toBe("记忆棉护颈枕");
  });

  test("clauseForAnswer 与 appendClause 生成追问补充子句", () => {
    const buyClause = clauseForAnswer("buy", "22.5");
    expect(buyClause.ok).toBe(true);
    if (buyClause.ok) {
      expect(buyClause.clause).toBe("采购价 22.5 元");
      const appended = appendClause("评估护颈枕价格与现金流。京东价 ¥89，快递 7 元。", buyClause.clause);
      expect(appended).toBe("评估护颈枕价格与现金流。京东价 ¥89，快递 7 元，采购价 22.5 元。");
      const parsed = parseTaskFacts(appended);
      expect(parsed.buyCents).toBe(2250);
    }
  });

  test("缺少采购价/快递费时生成诚实追问，已填时绝不生成重复追问", async () => {
    // 任务缺少采购价
    const missingBuy = "评估护颈枕价格与现金流。京东价 ¥89，快递 7 元，日单量 50，目标毛利 30%。";
    const run1 = await runAgentWorkflow({
      id: "test-missing-buy",
      taskText: missingBuy,
      autoApprove: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const questions1 = run1.scheduler.facts?.questions ?? [];
    expect(questions1.some((q) => q.id === "ask-buy")).toBe(true);
    expect(questions1.some((q) => q.id === "ask-shipping")).toBe(false);

    // 补充采购价后重新评审
    const supplemented = appendClause(missingBuy, "采购价 18 元");
    const run2 = await runAgentWorkflow({
      id: "test-supplemented-buy",
      taskText: supplemented,
      autoApprove: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const questions2 = run2.scheduler.facts?.questions ?? [];
    expect(questions2.some((q) => q.id === "ask-buy")).toBe(false);
  });
});
