import { describe, expect, test, vi } from "vitest";

import type { LlmCompletion, LlmRequest } from "../src/engine/llm/client.js";
import type { LiveLlm } from "../src/templates/agentops/llm.js";
import { runAgentWorkflow, type WorkflowRunOptions } from "../src/templates/agentops/runner.js";

const CREATED = "2026-01-01T00:00:00.000Z";
const CEILING = { maxTokens: 16000, maxToolCalls: 24, timeoutMs: 60_000 } as const;
const TASK =
  "【合成场景，非真实商户】评估桌面台钟上架可行性。采购价 19 元，包材 2 元，快递 5 元，竞品价 49 元，日单量 26，目标毛利 25%，预算 16 元，周转金 3300 元。请先查阅资料目录中的补充材料，再决定是否上架。";

const EXCERPT_APPROVE_MKT = "按该口径上架与现有材料一致，可以推进。";
const EXCERPT_APPROVE_QC = "未发现与上架口径冲突的禁令，按现有日用卖点上架可行。";
const EXCERPT_REJECT_QC = "若上架方案依赖上述医用口径，应拒绝按该方案上架，不得以先批准再改文案代替。";
const FABRICATED = "FABRICATED_COUNTEREVIDENCE_NOT_IN_ANY_SOURCE_BODY";

const CONSISTENT_SOURCES = [
  { id: "marketing-brief", title: "投放与上架口径说明", kind: "marketing", body: `【合成材料，非真实商户】拟主推指针读数。${EXCERPT_APPROVE_MKT}` },
  { id: "qc-returns", title: "质检与售后口径", kind: "qc", body: `【合成材料，非真实商户】抽检合格。${EXCERPT_APPROVE_QC}` },
  { id: "warehouse-in", title: "仓储入库摘要", kind: "ops", body: "【合成材料，非真实商户】入库 500 只，外箱完好。本单不涉及宣传口径。" },
] as const;

const CONFLICT_SOURCES = [
  { id: "marketing-brief", title: "投放与上架口径说明", kind: "marketing", body: "【合成材料，非真实商户】拟把「医用级时计」写进主图标题，并作为本次上架必须保留的口径，不得改成普通日用表述。" },
  { id: "qc-returns", title: "质检与售后口径", kind: "qc", body: `【合成材料，非真实商户】卷宗内没有医疗器械备案。${EXCERPT_REJECT_QC}` },
  { id: "warehouse-in", title: "仓储入库摘要", kind: "ops", body: "【合成材料，非真实商户】入库 500 只，外箱完好。本单不涉及宣传口径。" },
] as const;

function input(id: string) {
  return { id, taskText: TASK, autoApprove: true, createdAt: CREATED };
}

function options(mode: string, sources: readonly { id: string; title: string; kind: string; body: string }[]): WorkflowRunOptions {
  return {
    collaboration: true,
    economicLoop: true,
    strictEvidence: true,
    decisionReview: mode,
    maxDecisionCompletions: 12,
    budgetCeiling: CEILING,
    ...(mode === "single-self-review" ? { singleAgent: true } : {}),
    evidenceSources: sources,
  } as WorkflowRunOptions;
}

function decisionRequests(requests: readonly LlmRequest[]): LlmRequest[] {
  return requests.filter((req) => req.nodeId !== "copy");
}

function roleOf(nodeId: string): "procurement-lead" | "pricing-lead" | "growth-operator" | "chair" | "crosscheck" | "single" | "other" {
  if (/challenge|cross-check|crosscheck|交叉核验/.test(nodeId)) return "crosscheck";
  if (nodeId.includes("procurement-lead")) return "procurement-lead";
  if (nodeId.includes("pricing-lead")) return "pricing-lead";
  if (nodeId.includes("growth-operator")) return "growth-operator";
  if (nodeId.includes("chair") || nodeId.includes("verdict")) return "chair";
  if (nodeId.includes("decision-single") || nodeId.includes("self-review")) return "single";
  return "other";
}

function isRoleProposalRequest(req: LlmRequest): boolean {
  return /procurement-lead|pricing-lead|growth-operator/.test(req.nodeId ?? "");
}

function isCrosscheckRequest(req: LlmRequest): boolean {
  return roleOf(req.nodeId ?? "") === "crosscheck";
}

type Kind = "agree-approve" | "disagree-grounded" | "disagree-ungrounded" | "single-rules";

function mockLive(kind: Kind, sources: readonly { id: string; body: string }[]): { live: LiveLlm; requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  const complete = vi.fn(async (req: LlmRequest): Promise<LlmCompletion> => {
    requests.push(structuredClone(req));
    const usage =
      req.nodeId === "copy"
        ? { promptTokens: 40, completionTokens: 30 }
        : { promptTokens: Math.max(1, Math.ceil(req.prompt.length / 1.5)), completionTokens: 80 };
    let body: unknown;
    const role = roleOf(req.nodeId ?? "");
    const hasQc = req.prompt.includes(EXCERPT_REJECT_QC) || req.prompt.includes(EXCERPT_APPROVE_QC);
    const hasMkt = req.prompt.includes(EXCERPT_APPROVE_MKT) || req.prompt.includes("医用级时计");
    if (req.nodeId === "copy") {
      body = { titles: ["合成场景桌面台钟日用款"], bullets: ["适合日常桌面使用", "指针读数清晰"] };
    } else if (kind === "single-rules") {
      const unread = sources.filter((s) => !req.prompt.includes(s.body)).map((s) => s.id).slice(0, 2);
      if (unread.length > 0) {
        body = { action: "consult", sourceIds: unread, summary: "需要先查阅目录中尚未打开的补充材料再做分角色自检", evidenceRefs: ["task"] };
      } else {
        body = {
          action: "approve",
          candidateId: "match",
          summary: "材料口径一致可以按日用方案推进上架",
          evidenceRefs: ["task", "source/marketing-brief", "source/qc-returns"],
        };
      }
    } else if (role === "crosscheck") {
      if (kind === "disagree-ungrounded") {
        body = {
          action: "rebut",
          decision: { action: "reject", summary: "用一条不存在的摘录主张必须拒绝该上架方案", evidenceRefs: ["task", "source/qc-returns"] },
          quotes: [{ sourceId: "qc-returns", excerpt: FABRICATED }],
        };
      } else {
        body = {
          action: "rebut",
          decision: { action: "reject", summary: "质检材料否定必须保留的医用口径所以不能按原方案上架", evidenceRefs: ["task", "source/qc-returns"] },
          quotes: [{ sourceId: "qc-returns", excerpt: EXCERPT_REJECT_QC }],
        };
      }
    } else if (role === "procurement-lead" || role === "pricing-lead" || role === "growth-operator") {
      if (kind === "agree-approve") {
        if (!hasMkt && !hasQc) {
          const want = role === "pricing-lead" ? "qc-returns" : "marketing-brief";
          const unread = sources.find((s) => s.id === want && !req.prompt.includes(s.body));
          if (unread) {
            body = { action: "consult", sourceIds: [unread.id], summary: "该角色需要先独立查阅自己的资料再表态", evidenceRefs: ["task"] };
          }
        }
        if (body === undefined) {
          body = {
            action: "approve",
            candidateId: "match",
            summary: "本角色判断材料口径一致可以按日用方案推进上架",
            evidenceRefs: ["task", "source/marketing-brief", "source/qc-returns"],
          };
        }
      } else if (role === "procurement-lead") {
        if (!hasQc) {
          body = { action: "consult", sourceIds: ["qc-returns"], summary: "采购角色需要先独立查阅质检限制再表态", evidenceRefs: ["task"] };
        } else {
          body = {
            action: "reject",
            summary: "质检表明强制医用口径无法满足因此不能按该方案上架",
            evidenceRefs: ["task", "source/qc-returns"],
          };
        }
      } else if (!hasMkt) {
        body = { action: "consult", sourceIds: ["marketing-brief"], summary: "该角色需要先独立查阅投放口径再表态", evidenceRefs: ["task"] };
      } else {
        body = {
          action: "approve",
          candidateId: "match",
          summary: "只看投放口径后本角色主张按现有方案推进上架",
          evidenceRefs: ["task", "source/marketing-brief"],
        };
      }
    } else if (role === "chair") {
      body = {
        action: "approve",
        candidateId: "match",
        summary: "主席若未见到有效反证则不应单独另起一套无依据结论",
        evidenceRefs: ["task", "source/marketing-brief"],
      };
    } else {
      body = {
        action: "approve",
        candidateId: "match",
        summary: "默认按看起来可行的方案推进上架评估",
        evidenceRefs: ["task"],
      };
    }
    return { text: JSON.stringify(body), usage };
  });
  return { live: { client: { complete }, model: "mock-multi-consensus", baseUrl: "http://127.0.0.1:9" }, requests };
}

describe("decisionReview: multi-consensus parallel roles and grounded cross-check", () => {
  test("starts with parallel role judgments and closes without a cross-check when they agree", async () => {
    const { live, requests } = mockLive("agree-approve", CONSISTENT_SOURCES);
    const run = await runAgentWorkflow(input("mc-consistent-clock"), live, undefined, options("multi-consensus", CONSISTENT_SOURCES));
    const decision = decisionRequests(requests);
    const roles = new Set(decision.filter(isRoleProposalRequest).map((req) => roleOf(req.nodeId ?? "")));
    expect(roles.has("procurement-lead")).toBe(true);
    expect(roles.has("pricing-lead")).toBe(true);
    expect(roles.has("growth-operator")).toBe(true);
    expect(decision.some(isCrosscheckRequest)).toBe(false);
    expect(run.artifacts.decisionAct?.action).toBe("approve");
    expect(run.status).not.toBe("stopped");
    const artifacts = run.artifacts as { challengeTriggered?: boolean; challengeOutcome?: string };
    expect(artifacts.challengeTriggered ?? false).toBe(false);
    expect(artifacts.challengeOutcome === undefined || artifacts.challengeOutcome === "skipped-no-tension").toBe(true);
  });

  test("disagreement triggers a cross-check, and a verbatim source excerpt may close as reject", async () => {
    const { live, requests } = mockLive("disagree-grounded", CONFLICT_SOURCES);
    const run = await runAgentWorkflow(input("v9-disguise-consistent-approve"), live, undefined, options("multi-consensus", CONFLICT_SOURCES));
    const decision = decisionRequests(requests);
    expect(decision.some(isRoleProposalRequest)).toBe(true);
    expect(decision.some(isCrosscheckRequest)).toBe(true);
    expect(run.artifacts.decisionAct?.action).toBe("reject");
    expect(run.artifacts.decisionAct?.evidenceRefs).toContain("source/qc-returns");
    const artifacts = run.artifacts as { challengeTriggered?: boolean; challengeOutcome?: string };
    expect(artifacts.challengeTriggered).toBe(true);
    expect(artifacts.challengeOutcome).toBe("rebutted");
  });

  test("a fabricated excerpt that is not in the source body cannot decide the disagreement", async () => {
    const { live, requests } = mockLive("disagree-ungrounded", CONFLICT_SOURCES);
    const run = await runAgentWorkflow(input("mc-ungrounded"), live, undefined, options("multi-consensus", CONFLICT_SOURCES));
    const decision = decisionRequests(requests);
    expect(decision.some(isCrosscheckRequest)).toBe(true);
    expect(run.artifacts.decisionAct?.action).not.toBe("reject");
    const artifacts = run.artifacts as { challengeTriggered?: boolean; challengeOutcome?: string };
    expect(artifacts.challengeTriggered).toBe(true);
    expect(artifacts.challengeOutcome).toBe("rebuttal-ungrounded");
  });

  test("cross-check trigger does not read the run id or an oracle field", async () => {
    const { live, requests } = mockLive("disagree-grounded", CONFLICT_SOURCES);
    await runAgentWorkflow(input("holdout-v8-consistent-should-approve"), live, undefined, options("multi-consensus", CONFLICT_SOURCES));
    const decision = decisionRequests(requests);
    expect(decision.some(isCrosscheckRequest)).toBe(true);
    const joined = decision.map((req) => req.prompt).join("\n");
    expect(joined).not.toMatch(/expectedOutcome|mustCiteSourceIds|officialPass/);
  });

  test("strong single receives the same consensus and grounding rules in one shared context and has no isolated role nodes", async () => {
    const { live, requests } = mockLive("single-rules", CONSISTENT_SOURCES);
    const run = await runAgentWorkflow(input("mc-single-rules"), live, undefined, options("single-self-review", CONSISTENT_SOURCES));
    const decision = decisionRequests(requests);
    expect(decision.length).toBeGreaterThan(0);
    expect(decision.some(isRoleProposalRequest)).toBe(false);
    expect(decision.some(isCrosscheckRequest)).toBe(false);
    const joined = decision.map((req) => req.prompt).join("\n");
    expect(joined).toMatch(/可验证反证|原文摘录/);
    expect(joined).toMatch(/意见一致|一致则收口|并行/);
    expect(run.artifacts.decisionAct?.action).toBe("approve");
  });
});
