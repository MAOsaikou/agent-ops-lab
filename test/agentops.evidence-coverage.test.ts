import { describe, expect, test, vi } from "vitest";

import type { LlmCompletion, LlmRequest } from "../src/engine/llm/client.js";
import type { LiveLlm } from "../src/templates/agentops/llm.js";
import { runAgentWorkflow, type WorkflowRunOptions } from "../src/templates/agentops/runner.js";

const CREATED = "2026-01-01T00:00:00.000Z";
const CEILING = { maxTokens: 16000, maxToolCalls: 24, timeoutMs: 60_000 } as const;
const TASK =
  "【合成场景，非真实商户】评估桌面空气净化器上架可行性。采购价 88 元，包材 4 元，快递 10 元，竞品价 199 元，日单量 18，目标毛利 25%，预算 40 元，周转金 8000 元。请先查阅资料目录中的补充材料，再决定是否上架。";
const BODY_MARKETING = "COVERAGE_BODY_TOKEN_MARKETING_GAMMA";
const BODY_QC = "COVERAGE_BODY_TOKEN_QC_DELTA";
const BODY_WAREHOUSE = "COVERAGE_BODY_TOKEN_WAREHOUSE_EPSILON";

const SOURCES = [
  {
    id: "marketing-brief",
    title: "投放与上架口径说明",
    kind: "marketing",
    body: `【合成材料，非真实商户】本上架方案必须把“医用级过滤、可宣称临床防护”写进主图标题，不得改成普通日用表述。${BODY_MARKETING}`,
  },
  {
    id: "qc-returns",
    title: "质检与售后口径",
    kind: "qc",
    body: `【合成材料，非真实商户】无医疗器械备案，禁止医用或临床防护宣传；若方案依赖该口径则不可上架。${BODY_QC}`,
  },
  {
    id: "warehouse-in",
    title: "仓储入库摘要",
    kind: "ops",
    body: `【合成材料，非真实商户】外箱完好，本单不涉及宣传口径或质检备案。${BODY_WAREHOUSE}`,
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

function mockLive(kind: "premature-approve" | "consult-then-approve" | "covered-still-approve" | "no-sources"): {
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
      body = { titles: ["合成场景桌面净化器日用款"], bullets: ["适合日常桌面使用", "滤材可更换"] };
    } else if (kind === "no-sources") {
      body = {
        action: "approve",
        candidateId: "profit",
        summary: "在可行方案中优先守住目标毛利而不是跟价内卷",
        evidenceRefs: ["task", "pricing-lead/profit"],
      };
    } else {
      const hasMarketing = req.prompt.includes(BODY_MARKETING);
      const hasQc = req.prompt.includes(BODY_QC);
      const covered = hasMarketing && hasQc;
      if (kind === "consult-then-approve" && !covered) {
        const sourceIds = [
          ...(!hasMarketing ? ["marketing-brief"] : []),
          ...(!hasQc ? ["qc-returns"] : []),
        ].slice(0, 2);
        body = {
          action: "consult",
          sourceIds,
          summary: "需要先查阅目录中尚未打开的补充材料再裁决",
          evidenceRefs: ["task"],
        };
      } else if (kind === "premature-approve" && covered) {
        body = {
          action: "reject",
          summary: "营销强制口径与质检禁令冲突，该上架方案不可执行",
          evidenceRefs: ["task", "source/marketing-brief", "source/qc-returns"],
        };
      } else if (kind === "premature-approve") {
        const refs = ["task", "pricing-lead/match"];
        if (hasQc) refs.push("source/qc-returns");
        body = {
          action: "approve",
          candidateId: "match",
          summary: "质检提示不要写医疗口径，按普通日用改文案后可以跟价上架",
          evidenceRefs: refs,
        };
      } else if (req.nodeId.includes("-challenge-")) {
        body = { challenges: [] };
      } else if (covered || kind === "consult-then-approve" || kind === "covered-still-approve") {
        body = {
          action: "approve",
          candidateId: "profit",
          summary: "材料已齐，按目标毛利方案上架",
          evidenceRefs: ["task", "pricing-lead/profit", "source/marketing-brief", "source/qc-returns"],
        };
      } else {
        body = {
          candidateId: "profit",
          summary: "先给出数值方案",
          evidenceRefs: ["pricing-lead/profit"],
          concerns: ["还需查阅补充材料"],
        };
      }
    }
    return { text: JSON.stringify(body), usage };
  });
  return { live: { client: { complete }, model: "mock-evidence-coverage", baseUrl: "http://localhost" }, requests };
}

describe("decisionReview: optional evidence coverage gate for single and multi", () => {
  test("premature terminal approve is not accepted while unread catalog items remain and budget remains", async () => {
    for (const mode of ["single-self-review", "multi-deliberation"] as const) {
      const { live, requests } = mockLive("premature-approve");
      const run = await runAgentWorkflow(input(`coverage-defer-${mode}`), live, undefined, options(mode));
      const decision = decisionRequests(requests);
      const first = decision[0];
      expect(first, mode).toBeDefined();
      expect(first!.prompt, mode).not.toContain(BODY_MARKETING);
      expect(first!.prompt, mode).not.toContain(BODY_QC);
      expect(first!.prompt, mode).toContain("marketing-brief");
      expect(first!.prompt, mode).toContain("qc-returns");
      expect(decision.some((req) => promptHas(req, BODY_MARKETING)), mode).toBe(true);
      expect(decision.some((req) => promptHas(req, BODY_QC)), mode).toBe(true);
      expect(run.status, mode).not.toBe("stopped");
      expect(run.artifacts.decisionAct?.action, mode).toBe("reject");
      expect(run.artifacts.decisionAct?.evidenceRefs, mode).toEqual(
        expect.arrayContaining(["source/marketing-brief", "source/qc-returns"]),
      );
    }
  });

  test("once every catalog source has been consulted, a terminal approve is accepted without a further coverage loop", async () => {
    for (const mode of ["single-self-review", "multi-deliberation"] as const) {
      const { live, requests } = mockLive("consult-then-approve");
      const run = await runAgentWorkflow(input(`coverage-accept-${mode}`), live, undefined, options(mode));
      const decision = decisionRequests(requests);
      expect(decision.some((req) => promptHas(req, BODY_MARKETING)), mode).toBe(true);
      expect(decision.some((req) => promptHas(req, BODY_QC)), mode).toBe(true);
      expect(run.status, mode).not.toBe("stopped");
      expect(run.artifacts.decisionAct?.action, mode).toBe("approve");
      expect(run.artifacts.decisionAct?.candidateId, mode).toBe("profit");
    }
  });

  test("after all sources are in context, the system does not override the model act with a keyword safety reject", async () => {
    for (const mode of ["single-self-review", "multi-deliberation"] as const) {
      const { live, requests } = mockLive("covered-still-approve");
      const run = await runAgentWorkflow(input(`no-keyword-override-${mode}`), live, undefined, options(mode));
      const decision = decisionRequests(requests);
      expect(decision.some((req) => promptHas(req, BODY_MARKETING)), mode).toBe(true);
      expect(decision.some((req) => promptHas(req, BODY_QC)), mode).toBe(true);
      expect(run.status, mode).not.toBe("stopped");
      expect(run.artifacts.decisionAct?.action, mode).toBe("approve");
      expect(run.artifacts.decisionAct?.candidateId, mode).toBe("profit");
    }
  });

  test("default path without evidenceSources still completes and does not invent source refs", async () => {
    const { live, requests } = mockLive("no-sources");
    const run = await runAgentWorkflow(input("coverage-default-no-sources"), live, undefined, {
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
