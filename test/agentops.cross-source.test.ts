import { describe, expect, test, vi } from "vitest";

import type { LlmCompletion, LlmRequest } from "../src/engine/llm/client.js";
import type { LiveLlm } from "../src/templates/agentops/llm.js";
import { runAgentWorkflow, type WorkflowRunOptions } from "../src/templates/agentops/runner.js";

const CREATED = "2026-01-01T00:00:00.000Z";
const CEILING = { maxTokens: 16000, maxToolCalls: 24, timeoutMs: 60_000 } as const;
const TASK =
  "【合成场景，非真实商户】评估瑜伽垫上架可行性。采购价 26 元，包材 2 元，快递 8 元，竞品价 62 元，日单量 30，目标毛利 25%，预算 28 元，周转金 6000 元。请先查阅资料目录中的补充材料，再决定是否上架。";
const BODY_INVOICE = "CROSS_SOURCE_BODY_TOKEN_INVOICE_ALPHA";
const BODY_TERMS = "CROSS_SOURCE_BODY_TOKEN_TERMS_BETA";

const SOURCES = [
  {
    id: "invoice-1",
    title: "采购对账单",
    kind: "procurement",
    body: `【合成材料，非真实商户】本对账单记录采购价与任务正文一致。${BODY_INVOICE} 单独阅读本单可认为进价可执行。`,
  },
  {
    id: "terms-1",
    title: "供应商账期与起订函",
    kind: "procurement",
    body: `【合成材料，非真实商户】本函要求 800 件起订，货款超过可周转资金。${BODY_TERMS} 单独阅读也必须与对账单交叉核对。`,
  },
  {
    id: "warehouse-1",
    title: "仓储入库单摘要",
    kind: "ops",
    body: "【合成材料，非真实商户】入库外箱完好，本单不涉及起订或账期。",
  },
] as const;

function input(id: string) {
  return { id, taskText: TASK, autoApprove: true, createdAt: CREATED };
}

function options(mode: "single-self-review" | "multi-deliberation"): WorkflowRunOptions {
  return {
    collaboration: true,
    economicLoop: true,
    strictEvidence: true,
    decisionReview: mode,
    maxDecisionCompletions: 8,
    budgetCeiling: CEILING,
    ...(mode === "single-self-review" ? { singleAgent: true } : {}),
    evidenceSources: SOURCES,
  } as WorkflowRunOptions;
}

function decisionRequests(requests: readonly LlmRequest[]): LlmRequest[] {
  return requests.filter((req) => req.nodeId !== "copy");
}

function promptHas(req: LlmRequest, token: string): boolean {
  return req.prompt.includes(token);
}

function mockLive(cfg: { readonly withSources?: boolean } = {}): { live: LiveLlm; requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  const complete = vi.fn(async (req: LlmRequest): Promise<LlmCompletion> => {
    requests.push(structuredClone(req));
    const usage = req.nodeId === "copy"
      ? { promptTokens: 40, completionTokens: 30 }
      : { promptTokens: Math.max(1, Math.ceil(req.prompt.length / 1.5)), completionTokens: 80 };
    let body: unknown;
    if (req.nodeId === "copy") {
      body = { titles: ["合成场景瑜伽垫日用款"], bullets: ["防滑结构适合日常训练", "厚度适中便于收纳"] };
    } else if (cfg.withSources === false) {
      body = {
        action: "approve",
        candidateId: "profit",
        summary: "在可行方案中优先守住目标毛利而不是跟价内卷",
        evidenceRefs: ["task", "pricing-lead/profit"],
      };
    } else {
      const hasInvoice = req.prompt.includes(BODY_INVOICE);
      const hasTerms = req.prompt.includes(BODY_TERMS);
      const isVerdict = req.nodeId === "decision-chair-verdict" || req.nodeId.includes("self-review") || req.nodeId.includes("decision-");
      if (!hasInvoice || !hasTerms) {
        const sourceIds = [
          ...(!hasInvoice ? ["invoice-1"] : []),
          ...(!hasTerms ? ["terms-1"] : []),
        ].slice(0, 2);
        body = {
          action: "consult",
          sourceIds,
          summary: "需要交叉核对采购对账单与起订账期函后再裁决",
          evidenceRefs: ["task"],
        };
      } else if (req.nodeId.includes("-challenge-")) {
        body = { challenges: [] };
      } else if (isVerdict || hasInvoice && hasTerms) {
        body = {
          action: "reject",
          summary: "对账单单独可执行，但账期函的起订占用超出资金，交叉核对后不可上架",
          evidenceRefs: ["task", "source/invoice-1", "source/terms-1"],
        };
      } else {
        body = {
          candidateId: "profit",
          summary: "在可行方案中先核对补充材料再决定",
          evidenceRefs: ["pricing-lead/profit"],
          concerns: ["需交叉核对应商条款"],
        };
      }
    }
    return { text: JSON.stringify(body), usage };
  });
  return { live: { client: { complete }, model: "mock-cross-source", baseUrl: "http://localhost" }, requests };
}

describe("decisionReview: fair cross-source consult for single and multi", () => {
  test("single and multi first prompts include the source catalog but not source bodies", async () => {
    for (const mode of ["single-self-review", "multi-deliberation"] as const) {
      const { live, requests } = mockLive();
      await runAgentWorkflow(input(`catalog-only-${mode}`), live, undefined, options(mode));
      const first = decisionRequests(requests)[0];
      expect(first, mode).toBeDefined();
      const firstPrompt = first!.prompt;
      expect(firstPrompt, mode).toContain("invoice-1");
      expect(firstPrompt, mode).toContain("采购对账单");
      expect(firstPrompt, mode).toContain("terms-1");
      expect(firstPrompt, mode).not.toContain(BODY_INVOICE);
      expect(firstPrompt, mode).not.toContain(BODY_TERMS);
    }
  });

  test("single-self-review can consult any source and later decide using the returned bodies", async () => {
    const { live, requests } = mockLive();
    const run = await runAgentWorkflow(input("single-consult-then-reject"), live, undefined, options("single-self-review"));
    const decision = decisionRequests(requests);
    expect(decision.some((req) => promptHas(req, BODY_INVOICE))).toBe(true);
    expect(decision.some((req) => promptHas(req, BODY_TERMS))).toBe(true);
    expect(decision[0]?.prompt.includes(BODY_INVOICE) ?? false).toBe(false);
    expect(run.status).not.toBe("stopped");
    expect(run.artifacts.decisionAct?.action).toBe("reject");
    expect(run.artifacts.decisionAct?.evidenceRefs).toEqual(expect.arrayContaining(["source/invoice-1", "source/terms-1"]));
  });

  test("multi-deliberation can consult different sources in one wave and cite them in the verdict", async () => {
    const { live, requests } = mockLive();
    const run = await runAgentWorkflow(input("multi-parallel-consult"), live, undefined, options("multi-deliberation"));
    const decision = decisionRequests(requests);
    expect(decision.some((req) => promptHas(req, BODY_INVOICE))).toBe(true);
    expect(decision.some((req) => promptHas(req, BODY_TERMS))).toBe(true);
    expect(run.status).not.toBe("stopped");
    expect(run.artifacts.decisionAct?.action).toBe("reject");
    expect(run.artifacts.decisionAct?.evidenceRefs).toEqual(expect.arrayContaining(["source/invoice-1", "source/terms-1"]));
    const consultTurns = decision.filter((req) => !promptHas(req, BODY_INVOICE) && !promptHas(req, BODY_TERMS));
    expect(consultTurns.length).toBeGreaterThan(0);
  });

  test("default path without evidenceSources still completes and does not invent source refs", async () => {
    const { live, requests } = mockLive({ withSources: false });
    const run = await runAgentWorkflow(input("default-no-sources"), live, undefined, {
      collaboration: true,
      economicLoop: true,
      strictEvidence: true,
      decisionReview: "single-self-review",
      singleAgent: true,
      maxDecisionCompletions: 8,
      budgetCeiling: CEILING,
    });
    const first = decisionRequests(requests)[0];
    expect(first?.prompt.includes(BODY_INVOICE) ?? false).toBe(false);
    expect(run.status).not.toBe("stopped");
  });
});
