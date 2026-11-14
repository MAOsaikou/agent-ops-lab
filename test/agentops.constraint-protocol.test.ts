import { describe, expect, test, vi } from "vitest";

import type { LlmCompletion, LlmRequest } from "../src/engine/llm/client.js";
import { estimatePromptTokens } from "../src/templates/agentops/deliberation.js";
import type { LiveLlm } from "../src/templates/agentops/llm.js";
import { runAgentWorkflow, type WorkflowRunOptions } from "../src/templates/agentops/runner.js";

const CREATED = "2026-01-01T00:00:00.000Z";
const CEILING = { maxTokens: 16000, maxToolCalls: 24, timeoutMs: 60_000 } as const;
const TASK =
  "【合成场景，非真实商户】评估瑜伽垫上架可行性。采购价 26 元，包材 2 元，快递 8 元，竞品价 62 元，日单量 30，目标毛利 25%，预算 28 元，周转金 6000 元。公司政策要求必须守住目标毛利，禁止为了跟价或冲量牺牲毛利。";
const SUMMARY = "在可行方案中优先守住目标毛利而不是跟价内卷";

function input(id: string) {
  return { id, taskText: TASK, autoApprove: true, createdAt: CREATED };
}

function options(overrides: Partial<WorkflowRunOptions> = {}): WorkflowRunOptions {
  return {
    collaboration: true,
    economicLoop: true,
    strictEvidence: true,
    decisionReview: "multi-deliberation",
    maxDecisionCompletions: 8,
    budgetCeiling: CEILING,
    ...overrides,
  };
}

function usageRealistic(req: LlmRequest): { promptTokens: number; completionTokens: number } {
  return { promptTokens: Math.max(1, estimatePromptTokens(req.prompt)), completionTokens: 80 };
}

function isVerdict(req: LlmRequest): boolean {
  return req.nodeId === "decision-chair-verdict";
}

function isChallenge(req: LlmRequest): boolean {
  return req.nodeId.includes("-challenge-");
}

function isRevision(req: LlmRequest): boolean {
  return req.nodeId.includes("-revision-");
}

function isProposal(req: LlmRequest): boolean {
  return req.nodeId.includes("deliberation-proposal-");
}

function decisionRequests(requests: readonly LlmRequest[]): LlmRequest[] {
  return requests.filter((req) => req.nodeId !== "copy");
}

function mockLive(cfg: {
  readonly challenges?: 0 | 1 | 2;
  readonly proposalFirstFail?: 0 | 1 | 2 | 3;
  readonly failFirstVerdict?: boolean;
  readonly usageFor?: (req: LlmRequest) => { promptTokens: number; completionTokens: number };
}): { live: LiveLlm; requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  let proposalFailsLeft = cfg.proposalFirstFail ?? 0;
  let verdictFailsLeft = cfg.failFirstVerdict ? 1 : 0;
  const complete = vi.fn(async (req: LlmRequest): Promise<LlmCompletion> => {
    requests.push(structuredClone(req));
    const usage = cfg.usageFor?.(req) ?? (req.nodeId === "copy"
      ? { promptTokens: 40, completionTokens: 30 }
      : usageRealistic(req));
    let body: unknown;
    if (req.nodeId === "copy") {
      body = { titles: ["合成场景瑜伽垫日用款"], bullets: ["防滑结构适合日常训练", "厚度适中便于收纳"] };
    } else if (isVerdict(req)) {
      if (req.attempt === 1 && verdictFailsLeft > 0) {
        verdictFailsLeft -= 1;
        body = { invalid: true };
      } else {
        body = {
          action: "approve",
          candidateId: "profit",
          summary: "任务要求守住目标毛利并禁止跟价，因而在可行方案中选择稳价策略",
          evidenceRefs: ["task", "pricing-lead/profit"],
        };
      }
    } else if (isChallenge(req)) {
      const all = [
        {
          targetRole: "growth-operator",
          question: "冲量方案是否与必须守住目标毛利的红线冲突，请引用失败检查后说明",
          evidenceRefs: ["growth-operator/volume", "pricing-lead/profit"],
        },
        {
          targetRole: "pricing-lead",
          question: "跟价方案是否已经牺牲了任务要求守住的目标毛利，请说明权衡",
          evidenceRefs: ["pricing-lead/match", "pricing-lead/profit"],
        },
      ];
      body = { challenges: all.slice(0, cfg.challenges ?? 2) };
    } else if (isProposal(req) && req.attempt === 1 && proposalFailsLeft > 0) {
      proposalFailsLeft -= 1;
      body = { invalid: true };
    } else {
      const role = req.nodeId.includes("pricing-lead")
        ? "pricing-lead"
        : req.nodeId.includes("procurement-lead")
          ? "procurement-lead"
          : "growth-operator";
      body = {
        candidateId: "profit",
        summary: SUMMARY,
        evidenceRefs: [`${role}/profit`],
        concerns: ["仍需核对渠道政策是否变化"],
        ...(isRevision(req) ? { response: "我接受主席质询并维持守住目标毛利的稳价推荐" } : {}),
      };
    }
    return { text: JSON.stringify(body), usage };
  });
  return { live: { client: { complete }, model: "mock-constraint-protocol", baseUrl: "http://localhost" }, requests };
}

describe("decisionReview: reserved chair retry and conflict-only optional debate", () => {
  test("three proposal retries plus a failed first verdict still yield a chair DecisionAct under 16000/8", async () => {
    const { live, requests } = mockLive({ challenges: 2, proposalFirstFail: 3, failFirstVerdict: true });
    const run = await runAgentWorkflow(input("verdict-retry-after-proposal-retries"), live, undefined, options());
    const decision = decisionRequests(requests);
    const verdictAttempts = decision.filter((req) => isVerdict(req));
    expect(run.status).not.toBe("stopped");
    expect(verdictAttempts.length).toBeGreaterThanOrEqual(2);
    expect(run.artifacts.decisionAct).toBeDefined();
    expect(run.artifacts.decisionAct?.action).toBe("approve");
  });

  test("when only five completions remain, optional challenges must leave two slots for verdict plus parse retry", async () => {
    const { live, requests } = mockLive({ challenges: 2, proposalFirstFail: 0, failFirstVerdict: true });
    const run = await runAgentWorkflow(input("reserve-two-verdict-slots"), live, undefined, options({
      maxDecisionCompletions: 5,
    }));
    const decision = decisionRequests(requests);
    expect(decision.some((req) => isVerdict(req))).toBe(true);
    expect(decision.filter((req) => isVerdict(req)).length).toBeGreaterThanOrEqual(2);
    expect(decision.filter((req) => isRevision(req)).length).toBe(0);
    expect(run.status).not.toBe("stopped");
    expect(run.artifacts.decisionAct).toBeDefined();
  });

  test("when parallel proposals already agree, skip challenge and revision calls and still produce a verdict", async () => {
    const { live, requests } = mockLive({ challenges: 2, proposalFirstFail: 0, failFirstVerdict: false });
    const run = await runAgentWorkflow(input("fast-exit-when-proposals-agree"), live, undefined, options());
    const decision = decisionRequests(requests);
    expect(decision.filter((req) => isProposal(req)).length).toBe(3);
    expect(decision.filter((req) => isChallenge(req)).length).toBe(0);
    expect(decision.filter((req) => isRevision(req)).length).toBe(0);
    expect(decision.some((req) => isVerdict(req))).toBe(true);
    expect(run.status).not.toBe("stopped");
    expect(run.artifacts.decisionAct).toBeDefined();
    expect(decision.length).toBeLessThanOrEqual(5);
  });
});
