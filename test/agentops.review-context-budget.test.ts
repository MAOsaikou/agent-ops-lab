import { describe, expect, test, vi } from "vitest";

import type { LlmCompletion, LlmRequest } from "../src/engine/llm/client.js";
import { BENCHMARK_CASES, BENCHMARK_DATASET_HASH } from "../src/templates/agentops/eval/dataset.js";
import { extractOutcome } from "../src/templates/agentops/eval/harness.js";
import type { LiveLlm } from "../src/templates/agentops/llm.js";
import { runAgentWorkflow } from "../src/templates/agentops/runner.js";
import type { AgentRun } from "../src/templates/agentops/types.js";

const V1_TASK =
  "分析拼多多商品是否值得上架：https://mobile.yangkeduo.com/goods.html?goods_id=412345678901。纯棉短袖，券后价 ¥39.90，已拼 10 万+ 件。采购价 16 元，包材 1.5 元，快递 6.5 元，竞品主流价 39.90 元，日单量 50，目标毛利 25%，推广预算 30 元，可周转资金 300 元。";

const V1_FINGERPRINT = "59346b6d7ac56447cd37a72d9b31d00c20318d76005c0b48b72688c00edceaa3";
const V1_INVERSION_FINGERPRINT = "e14f14ef6056b3bb90f30f3a7b4574e91081ff6ac05f3320e34d03df090d4b64";

const ROLES = ["procurement-lead", "pricing-lead", "growth-operator"] as const;
const SUMMARY = "优先保护利润空间并兼顾当前备货能力，仍需核实商家的履约条件";

const OFFICIAL_CEILING = { maxTokens: 16000, maxToolCalls: 24, timeoutMs: 60_000 } as const;

function input(id: string, taskText = V1_TASK, autoApprove = true) {
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
} = {}): { live: LiveLlm; requests: LlmRequest[]; complete: ReturnType<typeof vi.fn> } {
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
          ? {
              challenges: [
                {
                  targetRole: "growth-operator",
                  question: "放量目标与资金承压是否冲突，请引用失败检查后说明为何仍推荐该方案",
                  evidenceRefs: ["growth-operator/volume", "pricing-lead/profit"],
                },
              ],
            }
          : req.nodeId.includes("-revision-")
            ? {
                ...proposalFor(req.nodeId),
                candidateId: "match" as const,
                evidenceRefs: [
                  `${ROLES.find((item) => req.nodeId.endsWith(item)) ?? "pricing-lead"}/match`,
                ],
                response: "我接受备货约束并修订推荐，优先选择能够兼顾订单增长与资金承压的方案",
              }
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
      model: "mock-review-context-model",
      baseUrl: "http://mock.invalid",
      client: { complete },
    },
  };
}

function reviewOptions(maxTokens: number) {
  return {
    collaboration: true,
    modelReview: true,
    strictEvidence: true,
    budgetCeiling: { maxTokens, maxToolCalls: 24, timeoutMs: 60_000 },
  } as const;
}

function checkDetailsFrom(run: AgentRun): string[] {
  const details: string[] = [];
  for (const analysis of run.artifacts.collaboration?.analyses ?? []) {
    for (const row of analysis.rows) {
      for (const check of row.checks) {
        if (typeof check.detail === "string" && check.detail.trim().length > 16) {
          details.push(check.detail);
        }
      }
    }
  }
  return details;
}

function reviewPrompts(requests: LlmRequest[]) {
  const proposals = requests.filter((req) => req.nodeId.includes("-proposal-") && req.attempt === 1);
  const chair = requests.filter((req) => req.nodeId.includes("-challenge-") && req.attempt === 1);
  const revisions = requests.filter((req) => req.nodeId.includes("-revision-"));
  return { proposals, chair, revisions };
}

describe("会审上下文压缩与输入预算", () => {
  test("提案与主席 prompt 不重复投递 checks.detail，且总长度明显低于未压缩基线", async () => {
    const mock = mockLive();
    const run = await runAgentWorkflow(input("compact-review-prompts"), mock.live, undefined, reviewOptions(16_000));
    const { proposals, chair } = reviewPrompts(mock.requests);
    expect(proposals).toHaveLength(3);
    expect(chair.length).toBeGreaterThanOrEqual(1);

    const details = [...new Set(checkDetailsFrom(run))];
    expect(details.length).toBeGreaterThan(0);
    for (const req of [...proposals, ...chair]) {
      for (const detail of details) {
        expect(req.prompt).not.toContain(detail);
      }
    }

    for (const req of proposals) {
      expect(req.prompt.length).toBeLessThan(4000);
    }
    const proposalAndChairChars = [...proposals, ...chair].reduce((sum, req) => sum + req.prompt.length, 0);
    expect(proposalAndChairChars).toBeLessThan(14_000);
  });

  test("主席仍消费三份真实提案，并保留足以交叉质询的紧凑失败指标", async () => {
    const mock = mockLive();
    await runAgentWorkflow(input("chair-real-proposals"), mock.live, undefined, reviewOptions(16_000));
    const chair = mock.requests.find((req) => req.nodeId.includes("-challenge-"));
    expect(chair).toBeDefined();
    expect(chair!.prompt).toContain("实际提案");
    expect(chair!.prompt).toContain(SUMMARY);
    expect(chair!.prompt).toContain('"role":"procurement-lead"');
    expect(chair!.prompt).toContain('"role":"pricing-lead"');
    expect(chair!.prompt).toContain('"role":"growth-operator"');
    const hasFailSignal =
      chair!.prompt.includes("failCheckIds") ||
      chair!.prompt.includes("failCount") ||
      chair!.prompt.includes("cashflow") ||
      chair!.prompt.includes("失败");
    expect(hasFailSignal).toBe(true);
  });

  test("官方 16000 预算下，按保守字数估计入账的会审可以完成而不是中途停止", async () => {
    const mock = mockLive({
      usageFor: (req) => ({
        promptTokens: Math.max(1, Math.ceil(req.prompt.length / 1.5)),
        completionTokens: 40,
      }),
    });
    const run = await runAgentWorkflow(
      input("completable-16000-billed-like"),
      mock.live,
      undefined,
      reviewOptions(16_000),
    );
    expect(run.status).toBe("completed");
    expect(run.stopReason).toBeUndefined();
    expect(extractOutcome(run)).not.toBe("incomplete");
    expect(mock.requests.some((req) => req.nodeId.includes("-proposal-"))).toBe(true);
    expect(mock.requests.some((req) => req.nodeId.includes("-challenge-"))).toBe(true);
    expect((run.usageAccounting?.actualTokens ?? 0)).toBeLessThanOrEqual(16_000);
    expect(run.usageAccounting?.unknown).not.toBe(true);
  });

  test("残余不足以覆盖估计输入时拒绝启动会审调用，官方计分为 incomplete 而非 approve", async () => {
    const mock = mockLive();
    const run = await runAgentWorkflow(input("refuse-tight-800"), mock.live, undefined, reviewOptions(800));
    expect(mock.requests.filter((req) => req.nodeId.includes("-proposal-"))).toHaveLength(0);
    expect(mock.requests.some((req) => req.nodeId.includes("-challenge-"))).toBe(false);
    expect(run.status).toBe("stopped");
    expect(run.stopReason).toBe("budget.tokens");
    expect(extractOutcome(run)).toBe("incomplete");
    expect(extractOutcome(run)).not.toBe("approve");
  });

  test("结构化短输出：提案、主席与修订的 intended completion cap 不超过 800", async () => {
    const mock = mockLive();
    await runAgentWorkflow(input("short-output-caps"), mock.live, undefined, reviewOptions(60_000));
    const reviewReqs = mock.requests.filter(
      (req) =>
        req.nodeId.includes("-proposal-") ||
        req.nodeId.includes("-challenge-") ||
        req.nodeId.includes("-revision-"),
    );
    expect(reviewReqs.length).toBeGreaterThanOrEqual(4);
    for (const req of reviewReqs) {
      expect(req.maxTokens).toBeGreaterThanOrEqual(1);
      expect(req.maxTokens).toBeLessThanOrEqual(800);
      expect(req.responseFormat).toBe("json_object");
    }
  });

  test("并发波请求的 completion cap 之和不超过剩余预算，未知 usage 不得记为 0", async () => {
    const mock = mockLive({
      usageFor: () => ({ promptTokens: 20, completionTokens: 10 }),
    });
    const ceiling = 16_000;
    const run = await runAgentWorkflow(input("wave-caps-within-ceiling"), mock.live, undefined, reviewOptions(ceiling));
    const proposals = mock.requests.filter((req) => req.nodeId.includes("-proposal-") && req.attempt === 1);
    expect(proposals.length).toBe(3);
    const requested = proposals.reduce((sum, req) => sum + req.maxTokens, 0);
    expect(requested).toBeLessThanOrEqual(ceiling);
    for (const req of mock.requests) {
      expect(req.maxTokens).toBeGreaterThanOrEqual(1);
      expect(req.maxTokens).toBeLessThanOrEqual(ceiling);
    }
    expect(run.usageAccounting?.unknown === true ? run.usageAccounting.source : "actual").not.toBe(
      "forbidden-zero-unknown",
    );
  });

  test("未知 usage 仍阻止后续模型调用，且不得把实际用量记为 0", async () => {
    const mock = mockLive({
      usageFor: (req) =>
        req.nodeId.includes("-proposal-") && req.nodeId.endsWith("procurement-lead")
          ? undefined
          : { promptTokens: 20, completionTokens: 10 },
    });
    const run = await runAgentWorkflow(input("unknown-usage-not-zero"), mock.live, undefined, reviewOptions(16_000));
    expect(run.status).toBe("stopped");
    expect(run.stopReason).toBe("budget.tokens");
    expect(run.usageAccounting?.unknown).toBe(true);
    expect(run.usageAccounting?.source).toBe("unknown");
    expect(run.usageAccounting).not.toMatchObject({ actualTokens: 0, unknown: false });
    expect(mock.requests.some((req) => req.nodeId.includes("-challenge-"))).toBe(false);
    expect(mock.requests.some((req) => req.nodeId === "copy")).toBe(false);
    expect(mock.requests.some((req) => req.nodeId.includes("-proposal-"))).toBe(true);
  });

  test("冻结 v1 指纹与数据集哈希不变，负毛利在会审前系统拒绝", async () => {
    const omitted = await runAgentWorkflow(input("test-run-v1"), null, undefined, { collaboration: false });
    expect(omitted.fingerprint).toBe(V1_FINGERPRINT);
    expect(BENCHMARK_DATASET_HASH).toBe(
      "2a2710aadef149fc2fa050c49088a5ec996a28223415b13e64498550d10ab892",
    );

    const inversion = caseById("conflict-price-inversion");
    const inv = await runAgentWorkflow(input("v1-inversion", inversion.taskText), null, undefined, {
      collaboration: false,
    });
    expect(inv.fingerprint).toBe(V1_INVERSION_FINGERPRINT);

    const negative = caseById("reject-negative-margin");
    const mock = mockLive();
    const run = await runAgentWorkflow(input("reject-before-review", negative.taskText), mock.live, undefined, {
      collaboration: true,
      modelReview: true,
      strictEvidence: true,
      budgetCeiling: OFFICIAL_CEILING,
    });
    expect(run.status).toBe("rejected");
    expect(extractOutcome(run)).toBe("reject");
    expect(mock.requests.filter((req) => req.nodeId.includes("-proposal-"))).toHaveLength(0);
    expect(mock.requests.filter((req) => req.nodeId === "copy")).toHaveLength(0);
  });
});
