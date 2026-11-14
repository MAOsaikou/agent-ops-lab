import { describe, expect, test, vi } from "vitest";

import type { LlmCompletion, LlmRequest } from "../src/engine/llm/client.js";
import type { LiveLlm } from "../src/templates/agentops/llm.js";
import { runAgentWorkflow, type WorkflowRunOptions } from "../src/templates/agentops/runner.js";

const CREATED = "2026-01-01T00:00:00.000Z";
const CEILING = { maxTokens: 16000, maxToolCalls: 24, timeoutMs: 60_000 } as const;
const TASK =
  "【合成场景，非真实商户】评估桌面加湿器上架可行性。采购价 42 元，包材 3 元，快递 8 元，竞品价 99 元，日单量 22，目标毛利 25%，预算 30 元，周转金 5000 元。请先查阅资料目录中的补充材料，再决定是否上架。";
const BODY_MARKETING = "ISOLATION_BODY_TOKEN_MARKETING_ZETA";
const BODY_QC = "ISOLATION_BODY_TOKEN_QC_ETA";
const BODY_WAREHOUSE = "ISOLATION_BODY_TOKEN_WAREHOUSE_THETA";

const SOURCES = [
  {
    id: "marketing-brief",
    title: "投放与上架口径说明",
    kind: "marketing",
    body: `【合成材料，非真实商户】本上架方案必须保留指定投放口径。${BODY_MARKETING}`,
  },
  {
    id: "qc-returns",
    title: "质检与售后口径",
    kind: "qc",
    body: `【合成材料，非真实商户】质检材料对部分投放口径提出限制。${BODY_QC}`,
  },
  {
    id: "warehouse-in",
    title: "仓储入库摘要",
    kind: "ops",
    body: `【合成材料，非真实商户】外箱完好，本单不涉及口径冲突。${BODY_WAREHOUSE}`,
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

function roleOf(nodeId: string): "procurement-lead" | "pricing-lead" | "growth-operator" | "chair" | "single" | "other" {
  if (nodeId.includes("procurement-lead")) return "procurement-lead";
  if (nodeId.includes("pricing-lead")) return "pricing-lead";
  if (nodeId.includes("growth-operator")) return "growth-operator";
  if (nodeId.includes("chair") || nodeId.includes("verdict")) return "chair";
  if (nodeId.includes("decision-single") || nodeId.includes("self-review")) return "single";
  return "other";
}

function mockLive(kind: "isolated-consult" | "single-shared-context" | "no-sources"): {
  live: LiveLlm;
  requests: LlmRequest[];
} {
  const requests: LlmRequest[] = [];
  const complete = vi.fn(async (req: LlmRequest): Promise<LlmCompletion> => {
    requests.push(structuredClone(req));
    const usage =
      req.nodeId === "copy"
        ? { promptTokens: 40, completionTokens: 30 }
        : { promptTokens: Math.max(1, Math.ceil(req.prompt.length / 1.5)), completionTokens: 80 };
    let body: unknown;
    if (req.nodeId === "copy") {
      body = { titles: ["合成场景桌面加湿器日用款"], bullets: ["适合日常桌面使用", "水箱可拆洗"] };
    } else if (kind === "no-sources") {
      body = {
        action: "approve",
        candidateId: "profit",
        summary: "在可行方案中优先守住目标毛利而不是跟价内卷",
        evidenceRefs: ["task", "pricing-lead/profit"],
      };
    } else {
      const hasM = req.prompt.includes(BODY_MARKETING);
      const hasQ = req.prompt.includes(BODY_QC);
      const hasW = req.prompt.includes(BODY_WAREHOUSE);
      const role = roleOf(req.nodeId);
      if (kind === "isolated-consult" && role === "procurement-lead" && !hasM) {
        body = { action: "consult", sourceIds: ["marketing-brief"], summary: "采购角色需要先独立查阅投放口径再表态", evidenceRefs: ["task"] };
      } else if (kind === "isolated-consult" && role === "pricing-lead" && !hasQ) {
        body = { action: "consult", sourceIds: ["qc-returns"], summary: "定价角色需要先独立查阅质检限制再表态", evidenceRefs: ["task"] };
      } else if (kind === "isolated-consult" && role === "growth-operator" && !hasW) {
        body = { action: "consult", sourceIds: ["warehouse-in"], summary: "增长角色需要先独立查阅仓储摘要再表态", evidenceRefs: ["task"] };
      } else if (kind === "single-shared-context" && (!hasM || !hasQ)) {
        const sourceIds = [...(!hasM ? ["marketing-brief"] : []), ...(!hasQ ? ["qc-returns"] : [])].slice(0, 2);
        body = { action: "consult", sourceIds, summary: "需要先查阅目录中尚未打开的补充材料再做分角色自检", evidenceRefs: ["task"] };
      } else if (req.nodeId.includes("-challenge-")) {
        body = { challenges: [] };
      } else if (role === "chair" || role === "single" || kind === "single-shared-context") {
        body = {
          action: "reject",
          summary: "交叉核对后，投放强制口径与质检限制冲突，不能按该方案上架",
          evidenceRefs: ["task", "source/marketing-brief", "source/qc-returns"],
        };
      } else {
        body = {
          candidateId: "match",
          summary: "本角色已查阅自己选中的材料并给出独立判断",
          evidenceRefs: role === "other" ? ["pricing-lead/match"] : [`${role}/match`],
          concerns: ["需由主席对照其他角色独立判断"],
        };
      }
    }
    return { text: JSON.stringify(body), usage };
  });
  return { live: { client: { complete }, model: "mock-role-isolation", baseUrl: "http://localhost" }, requests };
}

describe("decisionReview: role-isolated parallel judgment vs single shared context", () => {
  test("multi-deliberation proposal follow-ups do not include source bodies another role consulted", async () => {
    const { live, requests } = mockLive("isolated-consult");
    const run = await runAgentWorkflow(input("multi-role-isolation"), live, undefined, options("multi-deliberation"));
    const decision = decisionRequests(requests);

    const procurementFollowUps = decision.filter(
      (req) => roleOf(req.nodeId) === "procurement-lead" && req.prompt.includes(BODY_MARKETING),
    );
    const pricingFollowUps = decision.filter(
      (req) => roleOf(req.nodeId) === "pricing-lead" && req.prompt.includes(BODY_QC),
    );
    const growthFollowUps = decision.filter(
      (req) => roleOf(req.nodeId) === "growth-operator" && req.prompt.includes(BODY_WAREHOUSE),
    );
    expect(procurementFollowUps.length).toBeGreaterThan(0);
    expect(pricingFollowUps.length).toBeGreaterThan(0);
    expect(growthFollowUps.length).toBeGreaterThan(0);
    for (const req of procurementFollowUps) {
      expect(req.prompt, req.nodeId).not.toContain(BODY_QC);
      expect(req.prompt, req.nodeId).not.toContain(BODY_WAREHOUSE);
    }
    for (const req of pricingFollowUps) {
      expect(req.prompt, req.nodeId).not.toContain(BODY_MARKETING);
      expect(req.prompt, req.nodeId).not.toContain(BODY_WAREHOUSE);
    }
    for (const req of growthFollowUps) {
      expect(req.prompt, req.nodeId).not.toContain(BODY_MARKETING);
      expect(req.prompt, req.nodeId).not.toContain(BODY_QC);
    }

    const firstChair = decision.find((req) => roleOf(req.nodeId) === "chair");
    expect(firstChair).toBeDefined();
    expect(firstChair!.prompt).toMatch(/procurement-lead|采购/);
    expect(firstChair!.prompt).toMatch(/pricing-lead|定价/);
    expect(run.status).not.toBe("stopped");
    expect(run.artifacts.decisionAct?.action).toBe("reject");
  });

  test("single-self-review receives the same role list in one shared context and is not given isolated role memories", async () => {
    const { live, requests } = mockLive("single-shared-context");
    const run = await runAgentWorkflow(input("single-shared-context"), live, undefined, options("single-self-review"));
    const decision = decisionRequests(requests);
    const first = decision[0];
    expect(first).toBeDefined();
    expect(first!.prompt).not.toContain(BODY_MARKETING);
    expect(first!.prompt).not.toContain(BODY_QC);
    expect(first!.prompt).toContain("采购负责人");
    expect(first!.prompt).toContain("定价参谋");
    expect(first!.prompt).toContain("推广运营");
    const later = decision.filter((req) => req.prompt.includes(BODY_MARKETING) && req.prompt.includes(BODY_QC));
    expect(later.length).toBeGreaterThan(0);
    expect(run.status).not.toBe("stopped");
    expect(run.artifacts.decisionAct?.action).toBe("reject");
  });

  test("default path without evidenceSources still completes and does not invent source refs", async () => {
    const { live, requests } = mockLive("no-sources");
    const run = await runAgentWorkflow(input("isolation-default-no-sources"), live, undefined, {
      collaboration: true,
      economicLoop: true,
      strictEvidence: true,
      decisionReview: "single-self-review",
      singleAgent: true,
      maxDecisionCompletions: 8,
      budgetCeiling: CEILING,
    });
    const first = decisionRequests(requests)[0];
    expect(first?.prompt.includes(BODY_MARKETING) ?? false).toBe(false);
    expect(run.status).not.toBe("stopped");
    expect(JSON.stringify(run.artifacts.decisionAct ?? {})).not.toContain("source/");
  });
});
