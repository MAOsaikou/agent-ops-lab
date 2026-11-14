import { describe, expect, test, vi } from "vitest";

import type { LlmCompletion, LlmRequest } from "../src/engine/llm/client.js";
import { extractOutcome } from "../src/templates/agentops/eval/harness.js";
import type { LiveLlm } from "../src/templates/agentops/llm.js";
import { runAgentWorkflow } from "../src/templates/agentops/runner.js";
import type { WorkflowRunOptions } from "../src/templates/agentops/runner.js";

const CREATED = "2026-01-01T00:00:00.000Z";
const CEILING = { maxTokens: 16000, maxToolCalls: 24, timeoutMs: 60_000 } as const;

const TASK_MARGIN =
  "【合成场景，非真实商户】评估家居收纳盒上架可行性。采购价 28 元，包材 3 元，快递 7 元，竞品价 59 元，日单量 35，目标毛利 25%，预算 30 元，周转金 5000 元。本次运营红线是必须守住目标毛利，禁止为了跟价或冲量牺牲毛利。";

const TASK_CLAIM =
  "【合成场景，非真实商户】评估蓝牙耳机上架可行性。采购价 48 元，包材 3 元，快递 8 元，竞品价 129 元，日单量 40，目标毛利 25%，预算 40 元，周转金 8000 元。营销要求标题写零退货、质检100%通过。近30天退货率 18%，没有第三方质检报告。";

const TASK_CLARIFY =
  "【合成场景，非真实商户】评估帆布袋上架可行性。采购价 12 元，包材 1 元，快递 5 元，竞品价 29.9 元，日单量 40，目标毛利 25%，预算 20 元，周转金 4000 元。起订量还在谈，供应商口头有时说 50 件有时说 500 件，没有书面确认。";

const TASK_UNPROFITABLE =
  "智能手环上架。采购成本 85 元，包材 3 元，快递 7 元。竞品售价 49.9 元，日单量 100，预算 50 元。";

function input(id: string, taskText: string) {
  return { id, taskText, autoApprove: true, createdAt: CREATED };
}

function decisionOptions(
  decisionReview: "single-self-review" | "multi-deliberation",
  extra: WorkflowRunOptions = {},
): WorkflowRunOptions {
  return {
    collaboration: true,
    economicLoop: true,
    strictEvidence: true,
    decisionReview,
    maxDecisionCompletions: 8,
    budgetCeiling: CEILING,
    ...extra,
  };
}

function isCopy(req: LlmRequest): boolean {
  return req.nodeId === "copy";
}

function isDecision(req: LlmRequest): boolean {
  return !isCopy(req);
}

function mockLive(options: {
  readonly decisionFactory?: (req: LlmRequest, index: number) => unknown;
  readonly onRequest?: (req: LlmRequest) => void;
  readonly usageFor?: (req: LlmRequest) => { readonly promptTokens: number; readonly completionTokens: number };
}): { live: LiveLlm; requests: LlmRequest[]; complete: ReturnType<typeof vi.fn> } {
  const requests: LlmRequest[] = [];
  let decisionIndex = 0;
  const complete = vi.fn(async (req: LlmRequest): Promise<LlmCompletion> => {
    requests.push(structuredClone(req));
    options.onRequest?.(req);
    if (isCopy(req)) {
      return {
        text: JSON.stringify({
          titles: ["合成场景家居收纳盒日用款"],
          bullets: ["容量适中便于收纳", "结构稳固适合日常使用"],
        }),
        usage: { promptTokens: 11, completionTokens: 7 },
      };
    }
    const index = decisionIndex;
    decisionIndex += 1;
    const body =
      options.decisionFactory?.(req, index) ??
      (req.nodeId === "decision-chair-verdict" || req.nodeId.startsWith("decision-single")
        ? {
            action: "approve",
            candidateId: "profit",
            summary: "任务要求守住目标毛利并禁止跟价，因而在可行方案中选择稳价策略",
            evidenceRefs: ["task", "pricing-lead/profit"],
          }
        : req.nodeId.includes("-challenge-")
          ? { challenges: [] }
          : {
              candidateId: "profit",
              summary: "在可行方案中优先守住目标毛利而不是跟价内卷",
              evidenceRefs: ["pricing-lead/profit"],
              concerns: ["仍需核对渠道政策是否变化"],
            });
    const usage = options.usageFor?.(req) ?? { promptTokens: 11, completionTokens: 7 };
    return {
      text: JSON.stringify(body),
      usage,
    };
  });
  return {
    live: { client: { complete }, model: "mock-decision", baseUrl: "http://localhost" },
    requests,
    complete,
  };
}

function decisionRequests(requests: LlmRequest[]): LlmRequest[] {
  return requests.filter((req) => isDecision(req));
}

function promptOf(req: LlmRequest): string {
  return req.prompt;
}

describe("decisionReview contract: default path unchanged", () => {
  test("omitting decisionReview does not apply a model reject or clarify on a numeric-pass case", async () => {
    const { live, requests } = mockLive({
      decisionFactory: () => ({
        action: "reject",
        summary: "即使模型想拒绝，默认路径也不应进入结构化决策",
        evidenceRefs: ["task"],
      }),
    });
    const run = await runAgentWorkflow(input("default-off", TASK_MARGIN), live, undefined, {
      collaboration: false,
      modelReview: false,
      economicLoop: true,
      strictEvidence: true,
      budgetCeiling: CEILING,
    });
    expect(extractOutcome(run)).toBe("approve");
    expect(run.status).toBe("completed");
    expect(run.artifacts.chosenId).toBe("match");
    expect(run.artifacts.decisionAct).toBeUndefined();
    expect(decisionRequests(requests)).toHaveLength(0);
  });
});

describe("decisionReview contract: shared information and tools", () => {
  test("single and multi decision prompts both contain the task text and the same candidate prices", async () => {
    const single = mockLive({});
    const multi = mockLive({});
    const [singleRun, multiRun] = await Promise.all([
      runAgentWorkflow(
        input("fair-single", TASK_MARGIN),
        single.live,
        undefined,
        decisionOptions("single-self-review"),
      ),
      runAgentWorkflow(
        input("fair-multi", TASK_MARGIN),
        multi.live,
        undefined,
        decisionOptions("multi-deliberation"),
      ),
    ]);
    const singlePack = singleRun.artifacts.decisionPack;
    const multiPack = multiRun.artifacts.decisionPack;
    expect(singlePack).toBeDefined();
    expect(multiPack).toBeDefined();
    expect(singlePack?.fingerprint).toBe(multiPack?.fingerprint);
    expect(singlePack?.taskText).toContain("禁止为了跟价或冲量牺牲毛利");
    const singleDecision = decisionRequests(single.requests);
    const multiDecision = decisionRequests(multi.requests);
    expect(singleDecision.length).toBeGreaterThan(0);
    expect(multiDecision.length).toBeGreaterThan(0);
    for (const req of [...singleDecision, ...multiDecision]) {
      const prompt = promptOf(req);
      expect(prompt).toContain("禁止为了跟价或冲量牺牲毛利");
      expect(prompt).toContain("5890");
      expect(prompt).toContain("5990");
    }
  });

  test("single-self-review may iterate more than once under the same completion envelope", async () => {
    const { live, requests } = mockLive({
      decisionFactory: (_req, index) =>
        index === 0
          ? {
              action: "approve",
              candidateId: "match",
              summary: "先给出跟价草稿，但还要对照任务红线再自检一遍",
              evidenceRefs: ["task", "pricing-lead/match"],
            }
          : {
              action: "approve",
              candidateId: "profit",
              summary: "自检后改选稳价，因为任务禁止为跟价牺牲毛利",
              evidenceRefs: ["task", "pricing-lead/profit"],
            },
    });
    const run = await runAgentWorkflow(
      input("single-iter", TASK_MARGIN),
      live,
      undefined,
      decisionOptions("single-self-review"),
    );
    expect(decisionRequests(requests).length).toBeGreaterThanOrEqual(2);
    expect(decisionRequests(requests).length).toBeLessThanOrEqual(8);
    expect(run.artifacts.decisionAct?.action).toBe("approve");
    expect(run.artifacts.decisionAct?.candidateId).toBe("profit");
    expect(run.artifacts.chosenId).toBe("profit");
  });

  test("tool results are visible in a later decision prompt", async () => {
    const { live, requests } = mockLive({});
    await runAgentWorkflow(
      input("tool-feedback", TASK_MARGIN),
      live,
      undefined,
      decisionOptions("single-self-review"),
    );
    const decision = decisionRequests(requests);
    expect(decision.length).toBeGreaterThanOrEqual(2);
    const later = promptOf(decision[1]!);
    expect(later).toMatch(/pricing\.(verify|simulate|unit-cost|break-even)|knowledge\.search|工具回执/);
  });
});

describe("decisionReview contract: acts actually change the outcome", () => {
  test("model reject is applied on a numerically feasible listing", async () => {
    const { live } = mockLive({
      decisionFactory: (req) =>
        req.nodeId === "decision-chair-verdict" || req.nodeId.startsWith("decision-single")
          ? {
              action: "reject",
              summary: "宣传零退货与已披露退货率及缺失质检报告冲突，不能上架",
              evidenceRefs: ["task"],
            }
          : req.nodeId.includes("-challenge-")
            ? { challenges: [] }
            : {
                candidateId: "match",
                summary: "数值上看似可行，但仍需核对宣传证据是否充分",
                evidenceRefs: ["pricing-lead/match"],
                concerns: ["零退货宣传缺少证据"],
              },
    });
    const run = await runAgentWorkflow(
      input("act-reject", TASK_CLAIM),
      live,
      undefined,
      decisionOptions("single-self-review"),
    );
    expect(run.artifacts.decisionAct?.action).toBe("reject");
    expect(run.status).toBe("rejected");
    expect(run.gateDecision).toBe("reject");
    expect(extractOutcome(run)).toBe("reject");
  });

  test("model clarify is recorded and does not count as approve", async () => {
    const { live } = mockLive({
      decisionFactory: () => ({
        action: "clarify",
        fields: ["moq"],
        summary: "起订量口头说法互相冲突，必须先拿到书面确认才能核算备货",
        evidenceRefs: ["task"],
      }),
    });
    const run = await runAgentWorkflow(
      input("act-clarify", TASK_CLARIFY),
      live,
      undefined,
      decisionOptions("single-self-review"),
    );
    expect(run.artifacts.decisionAct?.action).toBe("clarify");
    expect(run.artifacts.decisionAct?.fields).toEqual(["moq"]);
    expect(run.artifacts.clarifiedFields ?? []).toEqual(expect.arrayContaining(["moq"]));
    expect(extractOutcome(run)).not.toBe("approve");
    expect(run.status).not.toBe("rejected");
  });

  test("multi-deliberation verdict can approve a min-fail policy candidate", async () => {
    const { live } = mockLive({});
    const run = await runAgentWorkflow(
      input("act-multi-approve", TASK_MARGIN),
      live,
      undefined,
      decisionOptions("multi-deliberation"),
    );
    expect(run.artifacts.decisionAct?.action).toBe("approve");
    expect(run.artifacts.chosenId).toBe("profit");
    expect(extractOutcome(run)).toBe("approve");
  });
});

describe("decisionReview contract: safety doors", () => {
  test("system unprofitable reject still wins and skips the decision episode", async () => {
    const { live, requests } = mockLive({
      decisionFactory: () => ({
        action: "approve",
        candidateId: "profit",
        summary: "模型试图批准一个市场倒挂方案，必须被系统拒绝挡住",
        evidenceRefs: ["task"],
      }),
    });
    const run = await runAgentWorkflow(
      input("safety-unprofitable", TASK_UNPROFITABLE),
      live,
      undefined,
      decisionOptions("single-self-review"),
    );
    expect(run.status).toBe("rejected");
    expect(extractOutcome(run)).toBe("reject");
    expect(decisionRequests(requests)).toHaveLength(0);
    expect(run.artifacts.decisionAct).toBeUndefined();
  });

  test("approve outside the min-fail set is not applied", async () => {
    const { live } = mockLive({
      decisionFactory: () => ({
        action: "approve",
        candidateId: "volume",
        summary: "试图批准失败质询更多的冲量方案，应用门必须拒绝该批准",
        evidenceRefs: ["task", "growth-operator/volume"],
      }),
    });
    const run = await runAgentWorkflow(
      input("safety-minfail", TASK_MARGIN),
      live,
      undefined,
      decisionOptions("single-self-review"),
    );
    expect(run.artifacts.decisionAct?.action === "approve" && run.artifacts.chosenId === "volume").toBe(
      false,
    );
    expect(run.artifacts.chosenId).not.toBe("volume");
    expect(run.status).not.toBe("rejected");
  });
});


describe("decisionReview contract: serialization safety", () => {
  test("multi-deliberation must not crash finalize when the chair verdict has not been produced", async () => {
    const { live } = mockLive({
      decisionFactory: (req) =>
        req.nodeId.includes("-challenge-")
          ? { challenges: [] }
          : {
              candidateId: "profit",
              summary: "在可行方案中优先守住目标毛利而不是跟价内卷",
              evidenceRefs: ["pricing-lead/profit"],
              concerns: ["仍需核对渠道政策是否变化"],
            },
    });
    const run = await runAgentWorkflow(
      input("safe-serialize", TASK_MARGIN),
      live,
      undefined,
      decisionOptions("multi-deliberation", { maxDecisionCompletions: 3 }),
    );
    expect(run.status === "stopped" || run.status === "completed" || run.status === "rejected").toBe(true);
    expect(run.artifacts.deliberation).toBeDefined();
  });
});


describe("decisionReview contract: official ceiling completability", () => {
  test("multi-deliberation completes a verdict under the official 16000 token ceiling when usage matches prompt size", async () => {
    const { live, requests } = mockLive({
      usageFor: (req) => ({
        promptTokens: Math.max(1, Math.ceil(req.prompt.length / 1.5)),
        completionTokens: 20,
      }),
    });
    const run = await runAgentWorkflow(
      input("fit-ceiling", TASK_MARGIN),
      live,
      undefined,
      decisionOptions("multi-deliberation"),
    );
    expect(run.status).not.toBe("stopped");
    expect(run.stopReason ?? null).not.toBe("budget.tokens");
    expect(run.artifacts.decisionAct).toBeDefined();
    const decision = requests.filter((req) => req.nodeId !== "copy");
    expect(decision.some((req) => req.nodeId === "decision-chair-verdict")).toBe(true);
  });

  test("multi-deliberation skips optional revisions under CJK-heavy token inflation to reach chair verdict", async () => {
    const { live, requests } = mockLive({
      usageFor: (req) => ({
        promptTokens: Math.max(1, Math.ceil(req.prompt.length / 1.05) + 80),
        completionTokens: 180,
      }),
    });
    const run = await runAgentWorkflow(
      input("cjk-heavy-verdict", TASK_MARGIN),
      live,
      undefined,
      decisionOptions("multi-deliberation"),
    );
    expect(run.status).not.toBe("stopped");
    expect(run.artifacts.decisionAct).toBeDefined();
    const decision = requests.filter((req) => req.nodeId !== "copy");
    expect(decision.some((req) => req.nodeId === "decision-chair-verdict")).toBe(true);
    expect(decision.filter((req) => req.nodeId.includes("-revision-")).length).toBe(0);
  });
});
