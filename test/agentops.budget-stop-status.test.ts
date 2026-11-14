import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, test, vi } from "vitest";

import type { LlmCompletion, LlmRequest } from "../src/engine/llm/client.js";
import { memoryAgentRunStore } from "../src/server/agent-runs.js";
import { openLlmSettingsStore } from "../src/server/llm-settings.js";
import { openPlanStore } from "../src/server/plans.js";
import { createPricingApp } from "../src/server/pricing-app.js";
import { BENCHMARK_CASES } from "../src/templates/agentops/eval/dataset.js";
import { BUDGET_CEILING } from "../src/templates/agentops/eval/harness.js";
import type { LiveLlm } from "../src/templates/agentops/llm.js";
import {
  createProductOrchestrator,
  DecisionConflictError,
} from "../src/templates/agentops/orchestrator.js";
import { runAgentWorkflow } from "../src/templates/agentops/runner.js";
import type { AgentRun } from "../src/templates/agentops/types.js";

const V1_TASK =
  "分析拼多多商品是否值得上架：https://mobile.yangkeduo.com/goods.html?goods_id=412345678901。纯棉短袖，券后价 ¥39.90，已拼 10 万+ 件。采购价 16 元，包材 1.5 元，快递 6.5 元，竞品主流价 39.90 元，日单量 50，目标毛利 25%，推广预算 30 元，可周转资金 300 元。";

const V1_FINGERPRINT = "59346b6d7ac56447cd37a72d9b31d00c20318d76005c0b48b72688c00edceaa3";
const V1_INVERSION_FINGERPRINT = "e14f14ef6056b3bb90f30f3a7b4574e91081ff6ac05f3320e34d03df090d4b64";

function input(id: string, taskText = V1_TASK, autoApprove = true) {
  return { id, taskText, autoApprove, createdAt: "2026-01-01T00:00:00.000Z" };
}

function mockLive(options: {
  readonly complete: (req: LlmRequest) => Promise<unknown> | unknown;
  readonly delayMs?: number;
  readonly usageFor?: (
    req: LlmRequest,
  ) => { readonly promptTokens: number; readonly completionTokens: number } | undefined;
}): { live: LiveLlm; requests: LlmRequest[]; complete: ReturnType<typeof vi.fn> } {
  const requests: LlmRequest[] = [];
  const complete = vi.fn(async (req: LlmRequest): Promise<LlmCompletion> => {
    requests.push(structuredClone(req));
    if (options.delayMs !== undefined) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    }
    const res = await options.complete(req);
    const usage = options.usageFor
      ? options.usageFor(req)
      : { promptTokens: 11, completionTokens: 7 };
    return {
      text: typeof res === "string" ? res : JSON.stringify(res),
      usage: usage as LlmCompletion["usage"],
    };
  });
  return {
    requests,
    complete,
    live: {
      model: "mock-budget-stop-model",
      baseUrl: "http://mock.invalid",
      client: { complete },
    },
  };
}

const VALID_COPY = {
  titles: ["纯棉短袖女夏季宽松百搭款"],
  bullets: ["纯棉面料透气舒适", "宽松版型日常百搭"],
};

describe("Terminal budget-stop status and truthful requested-token bounding", () => {
  test("budget and timeout stops end in terminal 'stopped' status (never 'running')", async () => {
    const toolStop = await runAgentWorkflow(input("stop-tool-3"), null, undefined, {
      collaboration: false,
      budgetCeiling: { maxTokens: 16000, maxToolCalls: 3, timeoutMs: 60_000 },
    });
    expect(toolStop.status).toBe("stopped");
    expect(toolStop.status).not.toBe("running");
    expect(toolStop.stopReason).toBe("budget.tool_calls");
    expect(toolStop.events.some((e) => e.type === "budget.exceeded")).toBe(true);
    expect(toolStop.events.some((e) => e.type === "run.completed")).toBe(false);

    const zeroToolStop = await runAgentWorkflow(input("stop-tool-0"), null, undefined, {
      collaboration: false,
      budgetCeiling: { maxTokens: 16000, maxToolCalls: 0, timeoutMs: 60_000 },
    });
    expect(zeroToolStop.status).toBe("stopped");
    expect(zeroToolStop.stopReason).toBe("budget.tool_calls");

    const zeroTokenMock = mockLive({ complete: () => VALID_COPY });
    const zeroTokenStop = await runAgentWorkflow(
      input("stop-token-0"),
      zeroTokenMock.live,
      undefined,
      {
        collaboration: false,
        budgetCeiling: { maxTokens: 0, maxToolCalls: 24, timeoutMs: 60_000 },
      },
    );
    expect(zeroTokenStop.status).toBe("stopped");
    expect(zeroTokenStop.stopReason).toBe("budget.tokens");
    expect(zeroTokenMock.complete).not.toHaveBeenCalled();

    const overTokenMock = mockLive({
      complete: () => VALID_COPY,
      usageFor: () => ({ promptTokens: 60, completionTokens: 50 }),
    });
    const overTokenStop = await runAgentWorkflow(
      input("stop-token-over"),
      overTokenMock.live,
      undefined,
      {
        collaboration: false,
        budgetCeiling: { maxTokens: 100, maxToolCalls: 24, timeoutMs: 60_000 },
      },
    );
    expect(overTokenStop.status).toBe("stopped");
    expect(overTokenStop.stopReason).toBe("budget.tokens");

    const timeoutMock = mockLive({
      complete: () => VALID_COPY,
      delayMs: 80,
    });
    const timeoutStop = await runAgentWorkflow(input("stop-timeout"), timeoutMock.live, undefined, {
      collaboration: false,
      budgetCeiling: { maxTokens: 16000, maxToolCalls: 24, timeoutMs: 20 },
    });
    expect(timeoutStop.status).toBe("stopped");
    expect(timeoutStop.stopReason).toBe("budget.timeout");
  });

  test("under-ceiling and omitted-budget runs retain completed/awaiting-approval/rejected and frozen fingerprints", async () => {
    const v1 = await runAgentWorkflow(input("test-run-v1"), null, undefined, {
      collaboration: false,
      budgetCeiling: BUDGET_CEILING,
    });
    expect(v1.status).toBe("completed");
    expect(v1.stopReason).toBeUndefined();
    expect(v1.fingerprint).toBe(V1_FINGERPRINT);

    const inversionCase = BENCHMARK_CASES.find((c) => c.id === "conflict-price-inversion")!;
    const inv = await runAgentWorkflow(
      input("v1-inversion", inversionCase.taskText, true),
      null,
      undefined,
      { collaboration: false },
    );
    expect(inv.status).toBe("completed");
    expect(inv.fingerprint).toBe(V1_INVERSION_FINGERPRINT);

    const paused = await runAgentWorkflow(input("under-pause", V1_TASK, false), null, undefined, {
      collaboration: false,
      budgetCeiling: BUDGET_CEILING,
    });
    expect(paused.status).toBe("awaiting-approval");
    expect(paused.stopReason).toBeUndefined();

    const rejected = await runAgentWorkflow(
      input("under-reject", inversionCase.taskText, true),
      null,
      undefined,
      { strictEvidence: true, budgetCeiling: BUDGET_CEILING },
    );
    expect(rejected.status).toBe("rejected");
    expect(rejected.stopReason).toBeUndefined();
  });

  test("orchestrator and server GET endpoints expose stopped status and block resume", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "agentops-stop-api-"));
    const agentRuns = memoryAgentRunStore();
    const orchestrator = createProductOrchestrator({ store: agentRuns });
    const app = createPricingApp({
      store: openPlanStore(path.join(dir, "plans")),
      agentRuns,
      llmSettings: openLlmSettingsStore(null, {}),
      now: () => new Date("2026-11-13T00:00:00.000Z"),
    });

    const stopped = await orchestrator.start(input("orch-stopped-1"), {
      options: {
        collaboration: false,
        budgetCeiling: { maxTokens: 16000, maxToolCalls: 2, timeoutMs: 60_000 },
      },
    });
    expect(stopped.status).toBe("stopped");
    expect(stopped.stopReason).toBe("budget.tool_calls");

    await expect(
      orchestrator.resume("orch-stopped-1", { action: "approve" }),
    ).rejects.toThrow(DecisionConflictError);

    const listRes = await app.request("/api/agentops/runs");
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as { runs: readonly { id: string; status: string }[] };
    expect(listBody.runs.find((r) => r.id === "orch-stopped-1")?.status).toBe("stopped");

    const getRes = await app.request("/api/agentops/runs/orch-stopped-1");
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as AgentRun;
    expect(getBody.status).toBe("stopped");
    expect(getBody.stopReason).toBe("budget.tool_calls");
  });

  test("executeCopy bounds requested maxTokens to min(intended, remaining - estPrompt) and records predictedTokens", async () => {
    const mock = mockLive({
      complete: (req) => (req.attempt === 1 ? "not-json" : VALID_COPY),
      usageFor: (req) =>
        req.attempt === 1
          ? { promptTokens: 40, completionTokens: 30 }
          : { promptTokens: 15, completionTokens: 10 },
    });

    const run = await runAgentWorkflow(input("copy-cap-remaining"), mock.live, undefined, {
      collaboration: false,
      budgetCeiling: { maxTokens: 200, maxToolCalls: 24, timeoutMs: 60_000 },
    });

    expect(mock.requests).toHaveLength(2);
    expect(mock.requests[0]!.maxTokens).toBeGreaterThanOrEqual(1);
    expect(mock.requests[0]!.maxTokens).toBeLessThan(200);
    expect(mock.requests[1]!.maxTokens).toBeGreaterThanOrEqual(1);
    expect(mock.requests[1]!.maxTokens).toBeLessThanOrEqual(200 - 70);
    expect(run.status).toBe("completed");
    expect(run.usageAccounting).toEqual({
      source: "actual",
      actualTokens: 95,
      predictedTokens: mock.requests[0]!.maxTokens + mock.requests[1]!.maxTokens,
      unknown: false,
    });
  });

  test("executeCopy does not start retry when remaining budget hits 0", async () => {
    const mock = mockLive({
      complete: () => "not-json",
      usageFor: () => ({ promptTokens: 60, completionTokens: 40 }),
    });

    const run = await runAgentWorkflow(input("copy-exhaust-exact"), mock.live, undefined, {
      collaboration: false,
      budgetCeiling: { maxTokens: 100, maxToolCalls: 24, timeoutMs: 60_000 },
    });

    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0]!.maxTokens).toBeGreaterThanOrEqual(1);
    expect(mock.requests[0]!.maxTokens).toBeLessThanOrEqual(100);
    expect(run.status).toBe("stopped");
    expect(run.stopReason).toBe("budget.tokens");
    expect(run.usageAccounting?.actualTokens).toBe(100);
    expect(run.usageAccounting?.predictedTokens).toBe(mock.requests[0]!.maxTokens);
  });

  test("missing or non-finite usage marks usageAccounting unknown and blocks further model calls", async () => {
    const missingMock = mockLive({
      complete: () => "not-json",
      usageFor: () => undefined,
    });

    const runMissing = await runAgentWorkflow(
      input("copy-missing-usage"),
      missingMock.live,
      undefined,
      {
        collaboration: false,
        budgetCeiling: { maxTokens: 500, maxToolCalls: 24, timeoutMs: 60_000 },
      },
    );

    expect(missingMock.requests).toHaveLength(1);
    expect(missingMock.requests[0]!.maxTokens).toBeGreaterThanOrEqual(1);
    expect(missingMock.requests[0]!.maxTokens).toBeLessThanOrEqual(500);
    expect(runMissing.status).toBe("stopped");
    expect(runMissing.stopReason).toBe("budget.tokens");
    expect(runMissing.usageAccounting?.source).toBe("unknown");
    expect(runMissing.usageAccounting?.unknown).toBe(true);
    expect(runMissing.usageAccounting?.predictedTokens).toBe(missingMock.requests[0]!.maxTokens);

    const nanMock = mockLive({
      complete: () => "not-json",
      usageFor: () => ({ promptTokens: Number.NaN, completionTokens: 10 }),
    });
    const runNan = await runAgentWorkflow(input("copy-nan-usage"), nanMock.live, undefined, {
      collaboration: false,
      budgetCeiling: { maxTokens: 500, maxToolCalls: 24, timeoutMs: 60_000 },
    });
    expect(nanMock.requests).toHaveLength(1);
    expect(runNan.status).toBe("stopped");
    expect(runNan.stopReason).toBe("budget.tokens");
    expect(runNan.usageAccounting?.source).toBe("unknown");
    expect(runNan.usageAccounting?.unknown).toBe(true);
  });

  test("deliberation refuses 250 ceiling on estimated input and stops on unknown usage", async () => {
    const roles = ["procurement-lead", "pricing-lead", "growth-operator"] as const;
    const summary = "优先保护利润空间并兼顾当前备货能力，仍需核实商家的履约条件";
    const mock = mockLive({
      complete: (req) => {
        if (req.nodeId === "copy") return VALID_COPY;
        if (req.nodeId.includes("-challenge-")) {
          return { challenges: [] };
        }
        const role = roles.find((r) => req.nodeId.endsWith(r)) ?? "pricing-lead";
        return {
          candidateId: "profit",
          summary,
          evidenceRefs: [`${role}/profit`],
          concerns: ["仍需核实商家备货能力"],
        };
      },
      usageFor: () => ({ promptTokens: 20, completionTokens: 10 }),
    });

    const run = await runAgentWorkflow(input("delib-cap-250"), mock.live, undefined, {
      collaboration: true,
      modelReview: true,
      budgetCeiling: { maxTokens: 250, maxToolCalls: 24, timeoutMs: 60_000 },
    });

    expect(run.status).toBe("stopped");
    expect(run.status).not.toBe("completed");
    expect(run.stopReason).toBe("budget.tokens");
    expect(mock.requests.filter((r) => r.nodeId.includes("-proposal-"))).toHaveLength(0);
    expect(mock.requests.some((r) => r.nodeId.includes("-challenge-"))).toBe(false);
    expect(mock.requests.some((r) => r.nodeId === "copy")).toBe(false);

    const unknownDelibMock = mockLive({
      complete: (req) => {
        if (req.nodeId === "copy") return VALID_COPY;
        if (req.nodeId.includes("-challenge-")) return { challenges: [] };
        const role = roles.find((r) => req.nodeId.endsWith(r)) ?? "pricing-lead";
        return {
          candidateId: "profit",
          summary,
          evidenceRefs: [`${role}/profit`],
          concerns: ["仍需核实商家备货能力"],
        };
      },
      usageFor: (req) =>
        req.nodeId.endsWith("procurement-lead")
          ? undefined
          : { promptTokens: 20, completionTokens: 10 },
    });

    const stoppedUnknown = await runAgentWorkflow(
      input("delib-unknown-usage"),
      unknownDelibMock.live,
      undefined,
      {
        collaboration: true,
        modelReview: true,
        budgetCeiling: { maxTokens: 16_000, maxToolCalls: 24, timeoutMs: 60_000 },
      },
    );

    expect(stoppedUnknown.status).toBe("stopped");
    expect(stoppedUnknown.stopReason).toBe("budget.tokens");
    expect(stoppedUnknown.usageAccounting?.source).toBe("unknown");
    expect(stoppedUnknown.usageAccounting?.unknown).toBe(true);
    expect(stoppedUnknown.usageAccounting).not.toMatchObject({ actualTokens: 0, unknown: false });
    expect(unknownDelibMock.requests.some((r) => r.nodeId.includes("-proposal-"))).toBe(true);
    expect(unknownDelibMock.requests.some((r) => r.nodeId.includes("-challenge-"))).toBe(false);
    expect(unknownDelibMock.requests.some((r) => r.nodeId === "copy")).toBe(false);
  });
});
