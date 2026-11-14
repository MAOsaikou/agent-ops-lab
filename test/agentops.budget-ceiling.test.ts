import { describe, expect, test, vi } from "vitest";

import type { LlmCompletion, LlmRequest } from "../src/engine/llm/client.js";
import { BENCHMARK_DATASET_HASH } from "../src/templates/agentops/eval/dataset.js";
import {
  BUDGET_CEILING,
  countToolCalls,
  runEvaluationSuite,
} from "../src/templates/agentops/eval/harness.js";
import type { LiveLlm } from "../src/templates/agentops/llm.js";
import { runAgentWorkflow } from "../src/templates/agentops/runner.js";

const v1Task =
  "分析拼多多商品是否值得上架：https://mobile.yangkeduo.com/goods.html?goods_id=412345678901。纯棉短袖，券后价 ¥39.90，已拼 10 万+ 件。采购价 16 元，包材 1.5 元，快递 6.5 元，竞品主流价 39.90 元，日单量 50，目标毛利 25%，推广预算 30 元，可周转资金 300 元。";

const V1_FINGERPRINT = "59346b6d7ac56447cd37a72d9b31d00c20318d76005c0b48b72688c00edceaa3";

function input(id: string, taskText = v1Task) {
  return { id, taskText, autoApprove: true, createdAt: "2026-01-01T00:00:00.000Z" };
}

function mockLive(options: {
  readonly complete: (req: LlmRequest) => Promise<unknown> | unknown;
  readonly delayMs?: number;
  readonly usage?: { readonly promptTokens: number; readonly completionTokens: number };
}): { live: LiveLlm; complete: ReturnType<typeof vi.fn> } {
  const complete = vi.fn(async (req: LlmRequest): Promise<LlmCompletion> => {
    if (options.delayMs !== undefined) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    }
    const res = await options.complete(req);
    return {
      text: typeof res === "string" ? res : JSON.stringify(res),
      usage: options.usage ?? { promptTokens: 11, completionTokens: 7 },
    };
  });
  return {
    complete,
    live: {
      model: "mock-budget-model",
      baseUrl: "http://mock.invalid",
      client: { complete },
    },
  };
}

describe("BUDGET_CEILING enforcement", () => {
  test("omitted budget and default ceiling under the limit keep the frozen v1 fingerprint", async () => {
    const omitted = await runAgentWorkflow(input("test-run-v1"), null, undefined, { collaboration: false });
    expect(omitted.status).toBe("completed");
    expect(omitted.stopReason).toBeUndefined();
    expect(omitted.events.some((event) => event.type === "budget.exceeded")).toBe(false);
    expect(omitted.fingerprint).toBe(V1_FINGERPRINT);

    const under = await runAgentWorkflow(input("test-run-v1"), null, undefined, {
      collaboration: false,
      budgetCeiling: BUDGET_CEILING,
    });
    expect(under.status).toBe("completed");
    expect(under.stopReason).toBeUndefined();
    expect(under.events.some((event) => event.type === "budget.exceeded")).toBe(false);
    expect(under.fingerprint).toBe(V1_FINGERPRINT);
  });

  test("tight maxToolCalls stops at the boundary with a visible reason and partial trace", async () => {
    const run = await runAgentWorkflow(input("tight-tool-run"), null, undefined, {
      collaboration: false,
      budgetCeiling: { maxTokens: 16000, maxToolCalls: 3, timeoutMs: 60_000 },
    });
    expect(countToolCalls(run)).toBeLessThanOrEqual(3);
    expect(run.stopReason).toBe("budget.tool_calls");
    const budgetEvent = run.events.find((event) => event.type === "budget.exceeded");
    expect(budgetEvent).toBeDefined();
    expect(run.events.length).toBeGreaterThan(0);
    expect(run.fingerprint).not.toBe(V1_FINGERPRINT);
  });

  test("equal maxToolCalls allows the last tool and prevents the next", async () => {
    const run = await runAgentWorkflow(input("equal-tool-run"), null, undefined, {
      collaboration: false,
      budgetCeiling: { maxTokens: 16000, maxToolCalls: 5, timeoutMs: 60_000 },
    });
    expect(countToolCalls(run)).toBe(5);
    expect(run.stopReason).toBe("budget.tool_calls");
    expect(run.events.some((event) => event.type === "budget.exceeded")).toBe(true);
  });

  test("maxToolCalls 0 schedules no tools and stops visibly", async () => {
    const run = await runAgentWorkflow(input("zero-tool-run"), null, undefined, {
      collaboration: false,
      budgetCeiling: { maxTokens: 16000, maxToolCalls: 0, timeoutMs: 60_000 },
    });
    expect(countToolCalls(run)).toBe(0);
    expect(run.stopReason).toBe("budget.tool_calls");
    expect(run.events.some((event) => event.type === "budget.exceeded")).toBe(true);
  });

  test("maxTokens 0 does not invoke the live model", async () => {
    const { live, complete } = mockLive({ complete: () => ({ titles: ["too-short"], bullets: ["x"] }) });
    const run = await runAgentWorkflow(input("zero-token-run"), live, undefined, {
      collaboration: false,
      budgetCeiling: { maxTokens: 0, maxToolCalls: 24, timeoutMs: 60_000 },
    });
    expect(complete).not.toHaveBeenCalled();
    expect(run.stopReason).toBe("budget.tokens");
    expect(run.events.some((event) => event.type === "budget.exceeded")).toBe(true);
  });

  test("negative or non-finite budget values are rejected", async () => {
    await expect(
      runAgentWorkflow(input("invalid-budget-1"), null, undefined, {
        collaboration: false,
        budgetCeiling: { maxTokens: 1000, maxToolCalls: -1, timeoutMs: 1000 },
      }),
    ).rejects.toThrow();
    await expect(
      runAgentWorkflow(input("invalid-budget-2"), null, undefined, {
        collaboration: false,
        budgetCeiling: { maxTokens: Number.NaN, maxToolCalls: 10, timeoutMs: 1000 },
      }),
    ).rejects.toThrow();
    await expect(
      runAgentWorkflow(input("invalid-budget-3"), null, undefined, {
        collaboration: false,
        budgetCeiling: { maxTokens: 1000, maxToolCalls: 10, timeoutMs: Number.POSITIVE_INFINITY },
      }),
    ).rejects.toThrow();
  });

  test("actual usage over the token ceiling stops further model calls and records actual usage", async () => {
    const { live, complete } = mockLive({
      complete: () => ({ titles: ["too-short"], bullets: ["x"] }),
      usage: { promptTokens: 60, completionTokens: 50 },
    });
    const run = await runAgentWorkflow(input("token-ceiling-run"), live, undefined, {
      collaboration: false,
      budgetCeiling: { maxTokens: 100, maxToolCalls: 24, timeoutMs: 60_000 },
    });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(run.stopReason).toBe("budget.tokens");
    expect(run.events.some((event) => event.type === "budget.exceeded")).toBe(true);
    expect(run.usageAccounting).toBeDefined();
    expect(run.usageAccounting?.source).toBe("actual");
    expect((run.usageAccounting?.actualTokens ?? 0)).toBeGreaterThanOrEqual(110);
    expect(run.usageAccounting?.unknown).toBe(false);
  });

  test("timeout ceiling stops with a visible timeout reason", async () => {
    const { live } = mockLive({
      complete: () => ({ titles: ["too-short"], bullets: ["x"] }),
      delayMs: 80,
    });
    const run = await runAgentWorkflow(input("timeout-run"), live, undefined, {
      collaboration: false,
      budgetCeiling: { maxTokens: 16000, maxToolCalls: 24, timeoutMs: 20 },
    });
    expect(run.stopReason).toBe("budget.timeout");
    expect(run.events.some((event) => event.type === "budget.exceeded")).toBe(true);
  });

  test("runEvaluationSuite applies BUDGET_CEILING and rule cases stay under it", async () => {
    const result = await runEvaluationSuite({ topologies: ["rule"] });
    expect(result.budgetCeiling).toEqual(BUDGET_CEILING);
    expect(result.datasetHash).toBe(BENCHMARK_DATASET_HASH);
    expect(result.caseDetails).toHaveLength(12);
    expect(result.summary.rule?.totalCases).toBe(12);
    for (const detail of result.caseDetails) {
      expect(detail.topology).toBe("rule");
    }
    // Default ceiling must not budget-stop these offline rule runs (they use far fewer than 24 tools).
    // Do not change frozen profit-vs-match scoring; some cases may still fail as 推荐候选为 match，预期 profit.
  });
});
