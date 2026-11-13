import { describe, expect, test } from "vitest";

import {
  dispatchToolCall,
  TOOL_NAMES,
  TOOL_WHITELIST,
  type ToolName,
} from "../src/templates/agentops/tools.js";
import { breakEvenCents, unitCost } from "../src/templates/pricing/economics.js";
import type { Candidate, CheckRow, ProductInput, SimResult, UnitCost } from "../src/templates/pricing/model.js";
import type { IntakeResult } from "../src/templates/intake/types.js";
import { SAMPLES } from "../src/templates/pricing/sample.js";
import { simulate } from "../src/templates/pricing/simulate.js";

describe("Task 2: Whitelisted Read-Only Tool Contracts & Dispatcher", () => {
  const sampleProduct: ProductInput = SAMPLES[0]!.input;
  const testPriceCents = 3990;

  test("defines exactly 7 whitelisted tool names", () => {
    expect(TOOL_NAMES).toHaveLength(7);
    expect(TOOL_NAMES).toEqual([
      "pricing.unit-cost",
      "pricing.break-even",
      "pricing.candidates",
      "pricing.simulate",
      "pricing.verify",
      "knowledge.search",
      "product.parse",
    ]);
    expect(TOOL_WHITELIST).toHaveLength(7);
    for (const tool of TOOL_WHITELIST) {
      expect(TOOL_NAMES).toContain(tool.name);
      expect(tool.title.length).toBeGreaterThan(0);
      expect(["compute", "simulate", "parse", "kb"]).toContain(tool.kind);
    }
  });

  test("pricing.unit-cost matches direct unitCost(input, priceCents) output", async () => {
    const directResult: UnitCost = unitCost(sampleProduct, testPriceCents);
    const toolResult = await dispatchToolCall<UnitCost>({
      tool: "pricing.unit-cost",
      params: { input: sampleProduct, priceCents: testPriceCents },
      callerRole: "cost-accountant",
      runId: "test-run-1",
    });

    expect(toolResult.ok).toBe(true);
    expect(toolResult.error).toBeUndefined();
    expect(toolResult.data).toBeDefined();
    expect(toolResult.data?.totalCents).toBe(directResult.totalCents);
    expect(toolResult.data?.buyCents).toBe(directResult.buyCents);
    expect(toolResult.data?.commissionCents).toBe(directResult.commissionCents);
    expect(toolResult.data?.payFeeCents).toBe(directResult.payFeeCents);
    expect(toolResult.data?.returnLossCents).toBe(directResult.returnLossCents);
  });

  test("pricing.break-even matches direct breakEvenCents(input) output", async () => {
    const directBreakEven: number = breakEvenCents(sampleProduct);
    const toolResult = await dispatchToolCall<{ breakEvenCents: number }>({
      tool: "pricing.break-even",
      params: { input: sampleProduct },
      callerRole: "cost-accountant",
      runId: "test-run-2",
    });

    expect(toolResult.ok).toBe(true);
    expect(toolResult.error).toBeUndefined();
    expect(toolResult.data?.breakEvenCents).toBe(directBreakEven);
    expect(toolResult.data?.breakEvenCents).toBeGreaterThan(sampleProduct.buyCents);
  });

  test("pricing.simulate matches direct simulate(input, priceCents) output", async () => {
    const directSim: SimResult = simulate(sampleProduct, testPriceCents);
    const toolResult = await dispatchToolCall<SimResult>({
      tool: "pricing.simulate",
      params: { input: sampleProduct, priceCents: testPriceCents },
      callerRole: "procurement-lead",
      runId: "test-run-3",
    });

    expect(toolResult.ok).toBe(true);
    expect(toolResult.error).toBeUndefined();
    expect(toolResult.data?.p10Cents).toBe(directSim.p10Cents);
    expect(toolResult.data?.p50Cents).toBe(directSim.p50Cents);
    expect(toolResult.data?.p90Cents).toBe(directSim.p90Cents);
    expect(toolResult.data?.stockoutDays).toBe(directSim.stockoutDays);
    expect(toolResult.data?.totalOrders).toBe(directSim.totalOrders);
  });

  test("pricing.candidates returns 3 candidate strategies with valid checks", async () => {
    const toolResult = await dispatchToolCall<readonly Candidate[]>({
      tool: "pricing.candidates",
      params: { input: sampleProduct },
      callerRole: "market-analyst",
      runId: "test-run-4",
    });

    expect(toolResult.ok).toBe(true);
    expect(toolResult.data).toHaveLength(3);
    const ids = toolResult.data?.map((c) => c.id);
    expect(ids).toEqual(["profit", "match", "volume"]);
  });

  test("pricing.verify returns constraint checks matching checksFor", async () => {
    const toolResult = await dispatchToolCall<readonly CheckRow[]>({
      tool: "pricing.verify",
      params: { input: sampleProduct, priceCents: testPriceCents },
      callerRole: "risk-auditor",
      runId: "test-run-5",
    });

    expect(toolResult.ok).toBe(true);
    expect(Array.isArray(toolResult.data)).toBe(true);
    expect(toolResult.data!.length).toBeGreaterThan(0);
    const checkIds = toolResult.data!.map((c) => c.id);
    expect(checkIds).toContain("margin");
    expect(checkIds).toContain("cashflow");
  });

  test("knowledge.search rejects a call that omits the required query", async () => {
    const toolResult = await dispatchToolCall({
      tool: "knowledge.search",
      params: { platform: "taobao" },
      callerRole: "growth-operator",
      runId: "test-run-6-missing-query",
    });
    expect(toolResult.ok).toBe(false);
    expect(toolResult.error ?? "").toMatch(/query/i);
  });

  test("knowledge.search searches platform fee and rules information", async () => {
    const toolResult = await dispatchToolCall<readonly { id: string; title: string; detail: string }[]>({
      tool: "knowledge.search",
      params: { query: "佣金 账期 扣点", platform: "taobao" },
      callerRole: "planner",
      runId: "test-run-6",
    });

    expect(toolResult.ok).toBe(true);
    expect(Array.isArray(toolResult.data)).toBe(true);
    expect(toolResult.data!.length).toBeGreaterThan(0);
    expect(toolResult.data![0]!.title).toContain("淘宝");
  });

  test("product.parse extracts structured facts from text input", async () => {
    const toolResult = await dispatchToolCall<IntakeResult>({
      tool: "product.parse",
      params: { text: "商品名：便携保温杯，售价 ¥49。进货价 16 元，运费 6.5 元" },
      callerRole: "link-researcher",
      runId: "test-run-7",
    });

    expect(toolResult.ok).toBe(true);
    expect(toolResult.data?.patch.name).toBe("便携保温杯");
  });

  test("rejects unauthorized tool names safely", async () => {
    const unauthorizedTool = "shell.execute" as unknown as ToolName;
    const toolResult = await dispatchToolCall({
      tool: unauthorizedTool,
      params: { command: "ls" },
      callerRole: "untrusted",
      runId: "test-run-8",
    });

    expect(toolResult.ok).toBe(false);
    expect(toolResult.error).toContain("Unauthorized tool: shell.execute");
    expect(toolResult.data).toBeUndefined();
  });

  test("zod schema validation rejects illegal/malformed parameters", async () => {
    const toolResult = await dispatchToolCall({
      tool: "pricing.unit-cost",
      params: {
        input: { ...sampleProduct, buyCents: -100 }, // illegal negative cost
        priceCents: testPriceCents,
      },
      callerRole: "cost-accountant",
      runId: "test-run-9",
    });

    expect(toolResult.ok).toBe(false);
    expect(toolResult.error).toBeDefined();
    expect(toolResult.data).toBeUndefined();
  });
});
