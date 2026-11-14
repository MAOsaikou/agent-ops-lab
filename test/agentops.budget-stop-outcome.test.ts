import { describe, expect, test, vi } from "vitest";

import type { LlmCompletion, LlmRequest } from "../src/engine/llm/client.js";
import { BENCHMARK_CASES, BENCHMARK_DATASET_HASH } from "../src/templates/agentops/eval/dataset.js";
import {
  extractOutcome,
  extractOutcomeLegacy,
  runEvaluationSuite,
  scoreCase,
  type CaseObservation,
} from "../src/templates/agentops/eval/harness.js";
import type { LiveLlm } from "../src/templates/agentops/llm.js";
import { runAgentWorkflow } from "../src/templates/agentops/runner.js";
import type { AgentRun } from "../src/templates/agentops/types.js";

const V1_TASK =
  "分析拼多多商品是否值得上架：https://mobile.yangkeduo.com/goods.html?goods_id=412345678901。纯棉短袖，券后价 ¥39.90，已拼 10 万+ 件。采购价 16 元，包材 1.5 元，快递 6.5 元，竞品主流价 39.90 元，日单量 50，目标毛利 25%，推广预算 30 元，可周转资金 300 元。";

const V1_FINGERPRINT = "59346b6d7ac56447cd37a72d9b31d00c20318d76005c0b48b72688c00edceaa3";
const V1_INVERSION_FINGERPRINT = "e14f14ef6056b3bb90f30f3a7b4574e91081ff6ac05f3320e34d03df090d4b64";

const ROLES = ["procurement-lead", "pricing-lead", "growth-operator"] as const;
const SUMMARY = "优先保护利润空间并兼顾当前备货能力，仍需核实商家的履约条件";

function input(id: string, taskText: string, autoApprove = true) {
  return { id, taskText, autoApprove, createdAt: "2026-01-01T00:00:00.000Z" };
}

function caseById(id: string) {
  const found = BENCHMARK_CASES.find((item) => item.id === id);
  if (found === undefined) throw new Error(`missing benchmark case: ${id}`);
  return found;
}

function proposalFor(nodeId: string) {
  const role = ROLES.find((item) => nodeId.endsWith(item)) ?? "pricing-lead";
  return {
    candidateId: "profit" as const,
    summary: SUMMARY,
    evidenceRefs: [`${role}/profit`],
    concerns: ["仍需核实商家备货能力"],
  };
}

function mockLive(options: {
  readonly usageFor?: (
    req: LlmRequest,
  ) => { readonly promptTokens: number; readonly completionTokens: number } | undefined;
  readonly onRequest?: (req: LlmRequest) => void;
}): { live: LiveLlm; requests: LlmRequest[]; complete: ReturnType<typeof vi.fn> } {
  const requests: LlmRequest[] = [];
  const complete = vi.fn(async (req: LlmRequest): Promise<LlmCompletion> => {
    requests.push(structuredClone(req));
    options.onRequest?.(req);
    const usage = options.usageFor
      ? options.usageFor(req)
      : { promptTokens: 11, completionTokens: 7 };
    const body =
      req.nodeId === "copy"
        ? { titles: ["纯棉短袖女夏季宽松百搭款"], bullets: ["纯棉面料透气舒适", "宽松版型日常百搭"] }
        : req.nodeId.includes("-challenge-")
          ? { challenges: [] }
          : proposalFor(req.nodeId);
    return {
      text: JSON.stringify(body),
      usage: usage as LlmCompletion["usage"],
    };
  });
  return {
    requests,
    complete,
    live: {
      model: "mock-stop-outcome-model",
      baseUrl: "http://mock.invalid",
      client: { complete },
    },
  };
}

function observationFrom(run: AgentRun, outcome: CaseObservation["outcome"]): CaseObservation {
  return {
    outcome,
    detectedRiskIds: (run.artifacts.risk?.rows ?? []).map((row) => row.id ?? row.title),
    claimTexts: [
      ...run.artifacts.bullets,
      ...(run.artifacts.copy === null ? [] : run.artifacts.copy.titles.map((title) => title.text)),
      ...run.artifacts.report,
      ...run.artifacts.assumptions,
    ],
    chosenId: run.artifacts.chosenId,
    clarifiedFields: [],
  };
}

describe("Budget-stop must not masquerade as approve; market reject must not be skipped", () => {
  test("dataset hash and default-path fingerprints stay frozen", async () => {
    expect(BENCHMARK_DATASET_HASH).toBe(
      "2a2710aadef149fc2fa050c49088a5ec996a28223415b13e64498550d10ab892",
    );
    const v1 = await runAgentWorkflow(input("test-run-v1", V1_TASK), null, undefined, {
      collaboration: false,
    });
    expect(v1.status).toBe("completed");
    expect(v1.fingerprint).toBe(V1_FINGERPRINT);

    const inversion = caseById("conflict-price-inversion");
    const inv = await runAgentWorkflow(input("v1-inversion", inversion.taskText), null, undefined, {
      collaboration: false,
    });
    expect(inv.status).toBe("completed");
    expect(inv.fingerprint).toBe(V1_INVERSION_FINGERPRINT);
  });

  test("extractOutcomeLegacy keeps the old stopped-with-product-is-approve rule for baseline comparison", () => {
    const stoppedApproveShaped = {
      status: "stopped",
      gateDecision: null,
      artifacts: { product: { name: "x" }, chosenId: "profit" },
    } as unknown as AgentRun;
    expect(extractOutcomeLegacy(stoppedApproveShaped)).toBe("approve");
    expect(extractOutcome(stoppedApproveShaped)).toBe("incomplete");
  });

  test("a budget-stopped profitable review is incomplete, not an approve pass", async () => {
    const benchmark = caseById("fail-timeout-recovery");
    const mock = mockLive({
      usageFor: () => ({ promptTokens: 8000, completionTokens: 2000 }),
    });
    const run = await runAgentWorkflow(
      input("stop-profitable-review", benchmark.taskText),
      mock.live,
      undefined,
      {
        collaboration: true,
        modelReview: true,
        strictEvidence: true,
        budgetCeiling: { maxTokens: 16000, maxToolCalls: 24, timeoutMs: 60_000 },
      },
    );

    expect(run.status).toBe("stopped");
    expect(run.gateDecision).not.toBe("reject");
    expect(run.artifacts.product).not.toBeNull();
    expect(extractOutcomeLegacy(run)).toBe("approve");
    expect(extractOutcome(run)).toBe("incomplete");
    expect(extractOutcome(run)).not.toBe("approve");

    const official = scoreCase(benchmark.expectations, observationFrom(run, extractOutcome(run)));
    expect(official.pass).toBe(false);
    expect(official.unmatched.some((item) => /未完成|stopped|incomplete/i.test(item))).toBe(true);

    const legacy = scoreCase(benchmark.expectations, observationFrom(run, extractOutcomeLegacy(run)));
    expect(legacy.pass).toBe(true);
  });

  test("unprofitable product still system-rejects when model-review hits the token ceiling", async () => {
    const benchmark = caseById("reject-negative-margin");
    const mock = mockLive({
      usageFor: () => ({ promptTokens: 8000, completionTokens: 2000 }),
    });
    const run = await runAgentWorkflow(
      input("stop-unprofitable-review", benchmark.taskText),
      mock.live,
      undefined,
      {
        collaboration: true,
        modelReview: true,
        strictEvidence: true,
        economicLoop: true,
        budgetCeiling: { maxTokens: 16000, maxToolCalls: 24, timeoutMs: 60_000 },
      },
    );

    expect(run.status).toBe("rejected");
    expect(run.gateDecision).toBe("reject");
    expect(run.status).not.toBe("stopped");
    expect(extractOutcome(run)).toBe("reject");
    expect(extractOutcomeLegacy(run)).toBe("reject");
    const official = scoreCase(benchmark.expectations, observationFrom(run, extractOutcome(run)));
    expect(official.pass).toBe(true);
    expect(official.refusalCorrect).toBe(true);
    expect(run.events.some((event) => event.type === "gate.decided")).toBe(true);
  });

  test("official eval suite scores a stopped profitable review as incomplete, not a pass", async () => {
    const benchmark = caseById("fail-timeout-recovery");
    const mock = mockLive({
      usageFor: () => ({ promptTokens: 8000, completionTokens: 2000 }),
    });
    const result = await runEvaluationSuite({
      topologies: ["collab-with-review"],
      cases: [benchmark],
      live: mock.live,
    });
    expect(result.datasetHash).toBe(BENCHMARK_DATASET_HASH);
    expect(result.caseDetails).toHaveLength(1);
    const row = result.caseDetails[0]!;
    expect(row.outcome).toBe("incomplete");
    expect(row.pass).toBe(false);
    expect(row.unmatched.some((item) => /未完成|stopped|incomplete/i.test(item))).toBe(true);
  });

  test("concurrent deliberation wave requested maxTokens sum is within remaining headroom", async () => {
    const mock = mockLive({
      usageFor: () => ({ promptTokens: 20, completionTokens: 10 }),
    });
    const ceiling = 16_000;
    const run = await runAgentWorkflow(input("wave-reserve-16000", V1_TASK), mock.live, undefined, {
      collaboration: true,
      modelReview: true,
      strictEvidence: true,
      budgetCeiling: { maxTokens: ceiling, maxToolCalls: 24, timeoutMs: 60_000 },
    });

    const proposals = mock.requests.filter((req) => req.nodeId.includes("-proposal-"));
    expect(proposals.length).toBeGreaterThan(0);
    const requested = proposals.reduce((sum, req) => sum + req.maxTokens, 0);
    expect(requested).toBeLessThanOrEqual(ceiling);
    for (const req of mock.requests) {
      expect(req.maxTokens).toBeGreaterThanOrEqual(1);
      expect(req.maxTokens).toBeLessThanOrEqual(ceiling);
    }
    if (run.usageAccounting?.predictedTokens !== undefined) {
      // Predicted is cumulative requested caps; a correctly reserved first wave must itself stay within the ceiling.
      expect(requested).toBeLessThanOrEqual(ceiling);
    }
    expect(run.usageAccounting?.unknown === true ? run.usageAccounting.source : "actual").not.toBe(
      "forbidden-zero-unknown",
    );
  });

  test("unknown usage is not recorded as zero actual and blocks further model calls", async () => {
    const mock = mockLive({
      usageFor: (req) =>
        req.nodeId.includes("-proposal-") && req.nodeId.endsWith("procurement-lead")
          ? undefined
          : { promptTokens: 20, completionTokens: 10 },
    });
    const run = await runAgentWorkflow(input("unknown-usage-not-zero", V1_TASK), mock.live, undefined, {
      collaboration: true,
      modelReview: true,
      strictEvidence: true,
      budgetCeiling: { maxTokens: 16_000, maxToolCalls: 24, timeoutMs: 60_000 },
    });
    expect(run.status).toBe("stopped");
    expect(run.stopReason).toBe("budget.tokens");
    expect(run.usageAccounting?.unknown).toBe(true);
    expect(run.usageAccounting?.source).toBe("unknown");
    expect(run.usageAccounting).not.toMatchObject({ actualTokens: 0, unknown: false });
    expect(mock.requests.some((req) => req.nodeId.includes("-proposal-"))).toBe(true);
    expect(mock.requests.some((req) => req.nodeId.includes("-challenge-"))).toBe(false);
    expect(mock.requests.some((req) => req.nodeId === "copy")).toBe(false);
  });
});
