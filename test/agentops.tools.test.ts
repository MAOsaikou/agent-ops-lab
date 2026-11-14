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

  test("defines exactly 9 whitelisted tool names", () => {
    expect(TOOL_NAMES).toHaveLength(9);
    expect(TOOL_NAMES).toEqual([
      "pricing.unit-cost",
      "pricing.break-even",
      "pricing.candidates",
      "pricing.simulate",
      "pricing.verify",
      "knowledge.search",
      "product.parse",
      "sources.list",
      "sources.read",
    ]);
    expect(TOOL_WHITELIST).toHaveLength(9);
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

  test("knowledge.search filters relevant Chinese query and excludes unrelated topics", async () => {
    const toolResult = await dispatchToolCall<readonly { id: string; title: string; detail: string }[]>({
      tool: "knowledge.search",
      params: { query: "佣金", platform: "taobao" },
      callerRole: "planner",
      runId: "test-run-ks-1",
    });

    expect(toolResult.ok).toBe(true);
    expect(Array.isArray(toolResult.data)).toBe(true);
    expect(toolResult.data!.length).toBeGreaterThan(0);
    for (const card of toolResult.data!) {
      expect(card.title).toContain("淘宝");
      expect(card.title + card.detail).toMatch(/佣金|扣点|费率|费用/);
    }
  });

  test("knowledge.search returns empty hits for unrelated query", async () => {
    const toolResult = await dispatchToolCall<readonly { id: string; title: string; detail: string }[]>({
      tool: "knowledge.search",
      params: { query: "量子力学", platform: "taobao" },
      callerRole: "planner",
      runId: "test-run-ks-2",
    });

    expect(toolResult.ok).toBe(true);
    expect(toolResult.data).toEqual([]);
  });

  test("knowledge.search returns empty hits for empty-but-valid query", async () => {
    const toolResult = await dispatchToolCall<readonly { id: string; title: string; detail: string }[]>({
      tool: "knowledge.search",
      params: { query: "   ", platform: "taobao" },
      callerRole: "planner",
      runId: "test-run-ks-3",
    });

    expect(toolResult.ok).toBe(true);
    expect(toolResult.data).toEqual([]);
  });

  test("knowledge.search matches settlement Chinese query", async () => {
    const toolResult = await dispatchToolCall<readonly { id: string; title: string; detail: string }[]>({
      tool: "knowledge.search",
      params: { query: "账期", platform: "taobao" },
      callerRole: "planner",
      runId: "test-run-ks-4",
    });

    expect(toolResult.ok).toBe(true);
    expect(Array.isArray(toolResult.data)).toBe(true);
    expect(toolResult.data!.length).toBeGreaterThan(0);
    for (const card of toolResult.data!) {
      expect(card.title).toContain("淘宝");
      expect(card.title + card.detail).toMatch(/结算|账期|周期/);
    }
  });

  test("knowledge.search differentiates relevant query and unrelated query result sets", async () => {
    const relevantResult = await dispatchToolCall<readonly { id: string; title: string; detail: string }[]>({
      tool: "knowledge.search",
      params: { query: "佣金", platform: "taobao" },
      callerRole: "planner",
      runId: "test-run-ks-5a",
    });
    const unrelatedResult = await dispatchToolCall<readonly { id: string; title: string; detail: string }[]>({
      tool: "knowledge.search",
      params: { query: "量子力学", platform: "taobao" },
      callerRole: "planner",
      runId: "test-run-ks-5b",
    });

    expect(relevantResult.ok).toBe(true);
    expect(unrelatedResult.ok).toBe(true);
    expect(relevantResult.data).not.toEqual(unrelatedResult.data);
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

  test("sources.list returns catalog metadata without bodies and sources.read reads up to 2 valid ids", async () => {
    const sources = [
      { id: "doc-1", title: "对账单", kind: "procurement", body: "SECRET_BODY_1" },
      { id: "doc-2", title: "账期函", kind: "procurement", body: "SECRET_BODY_2" },
    ];
    const listResult = await dispatchToolCall<readonly { id: string; title: string; kind?: string; body?: string }[]>({
      tool: "sources.list",
      params: { sources },
      callerRole: "generalist",
      runId: "test-run-sources-list",
    });
    expect(listResult.ok).toBe(true);
    expect(listResult.data).toEqual([
      { id: "doc-1", title: "对账单", kind: "procurement" },
      { id: "doc-2", title: "账期函", kind: "procurement" },
    ]);

    const readResult = await dispatchToolCall<readonly { id: string; title: string; kind?: string; body: string }[]>({
      tool: "sources.read",
      params: { sources, sourceIds: ["doc-1", "doc-2"] },
      callerRole: "generalist",
      runId: "test-run-sources-read",
    });
    expect(readResult.ok).toBe(true);
    expect(readResult.data?.map((item) => item.body)).toEqual(["SECRET_BODY_1", "SECRET_BODY_2"]);

    const invalidRead = await dispatchToolCall({
      tool: "sources.read",
      params: { sources, sourceIds: ["missing-doc"] },
      callerRole: "generalist",
      runId: "test-run-sources-read-missing",
    });
    expect(invalidRead.ok).toBe(false);
    expect(invalidRead.error).toContain("missing-doc");
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
